import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkRouteLinks,
  discoverAppRoutes,
  routeMatchesApp,
} from "../check-route-links.mjs";
import {
  checkRouteParams,
  extractRouteContracts,
  fileToRoutePath,
  findSearchParamReads,
} from "../check-route-params.mjs";

test("extractRouteContracts parses declared params from ROUTE_CONTRACTS", () => {
  const src = `
    export const ROUTE_CONTRACTS = {
      "/": [] as const,
      "/markets/quick-view": ["marketId", "onChainId", "from", "side"] as const,
    } as const;
  `;
  const contracts = extractRouteContracts(src);
  assert.deepEqual([...contracts.get("/")], []);
  assert.deepEqual([...contracts.get("/markets/quick-view")], [
    "marketId",
    "onChainId",
    "from",
    "side",
  ]);
});

test("findSearchParamReads detects searchParams.get and useSearchParams() aliases", () => {
  const src = `
    import { useSearchParams } from "next/navigation";
    export function Page() {
      const sp = useSearchParams();
      return sp.get("foo") ?? searchParams.get("bar");
    }
  `;
  const reads = findSearchParamReads(src, "app/test/page.tsx");
  assert.deepEqual(
    reads.map((r) => r.param),
    ["foo", "bar"],
  );
  assert.equal(fileToRoutePath("app/test/page.tsx"), "/test");
});

test("checkRouteParams fails on undeclared searchParams.get", () => {
  const dir = mkdtempSync(join(tmpdir(), "route-params-"));
  try {
    mkdirSync(join(dir, "lib"), { recursive: true });
    mkdirSync(join(dir, "app/demo"), { recursive: true });
    mkdirSync(join(dir, "components"), { recursive: true });
    writeFileSync(
      join(dir, "lib/routes.ts"),
      `export const ROUTE_CONTRACTS = { "/demo": ["allowed"] as const } as const;\n`,
    );
    writeFileSync(
      join(dir, "app/demo/page.tsx"),
      `import { useSearchParams } from "next/navigation";
       export default function Demo() {
         const sp = useSearchParams();
         return sp.get("secret");
       }\n`,
    );
    const errors = checkRouteParams(dir);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].param, "secret");
    assert.equal(errors[0].file, "app/demo/page.tsx");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discoverAppRoutes & checkRouteLinks validate static and dynamic routes", () => {
  const dir = mkdtempSync(join(tmpdir(), "route-links-"));
  try {
    mkdirSync(join(dir, "app/markets"), { recursive: true });
    mkdirSync(join(dir, "app/agent/[address]"), { recursive: true });
    mkdirSync(join(dir, "components"), { recursive: true });
    mkdirSync(join(dir, "lib"), { recursive: true });
    writeFileSync(join(dir, "app/page.tsx"), "export default function Home() { return null; }\n");
    writeFileSync(join(dir, "app/markets/page.tsx"), "export default function Markets() { return null; }\n");
    writeFileSync(join(dir, "app/agent/[address]/page.tsx"), "export default function Agent() { return null; }\n");
    writeFileSync(
      join(dir, "components/nav.tsx"),
      `import Link from "next/link";
       export function Nav() {
         return (
           <>
             <Link href="/markets">ok</Link>
             <Link href="/agent/GABC">ok</Link>
             <Link href="/does-not-exist">broken</Link>
           </>
         );
       }\n`,
    );

    const discovered = discoverAppRoutes(join(dir, "app"));
    assert.equal(routeMatchesApp("/agent/G123", discovered), true);
    const { errors } = checkRouteLinks(dir);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].target, "/does-not-exist");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
