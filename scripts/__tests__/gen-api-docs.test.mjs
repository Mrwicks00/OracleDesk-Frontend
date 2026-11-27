import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BEGIN_MARKER,
  END_MARKER,
  classifyCoverage,
  extractBackendRoutes,
  extractFrontendCalls,
  renderGeneratedSection,
  updateApiDocContent,
} from "../gen-api-docs.mjs";

test("extractBackendRoutes parses mounted routes and middlewares via TS compiler API", () => {
  const dir = mkdtempSync(join(tmpdir(), "backend-fixture-"));
  try {
    mkdirSync(join(dir, "src/routes"), { recursive: true });
    writeFileSync(
      join(dir, "src/routes/index.ts"),
      `import { Router } from "express";
       import authRouter from "./auth";
       import tradeRouter from "./trade";
       import adminRouter from "./admin";
       const router = Router();
       router.use("/auth", authRouter);
       router.use("/trade", requireAuth, tradeRouter);
       router.use("/admin", requireAuth, requirePermission("admin.read"), adminRouter);
       export default router;\n`,
    );
    writeFileSync(
      join(dir, "src/routes/auth.ts"),
      `import { Router } from "express";
       const r = Router();
       r.get("/challenge/pow", authLimiter, handler);
       r.post("/refresh", handler);
       export default r;\n`,
    );
    writeFileSync(
      join(dir, "src/routes/trade.ts"),
      `import { Router } from "express";
       const r = Router();
       r.post("/copy", idempotent({ required: true }), handler);
       export default r;\n`,
    );
    writeFileSync(
      join(dir, "src/routes/admin.ts"),
      `import { Router } from "express";
       const r = Router();
       r.post("/admins/grant", requireStepUp, handler);
       export default r;\n`,
    );

    const routes = extractBackendRoutes(dir);
    assert.deepEqual(
      routes.map((r) => `${r.method} ${r.path}`),
      [
        "POST /admin/admins/grant",
        "GET /auth/challenge/pow",
        "POST /auth/refresh",
        "POST /trade/copy",
      ],
    );
    const copyRoute = routes.find((r) => r.path === "/trade/copy");
    assert.ok(copyRoute.middlewares.includes("requireAuth"));
    assert.ok(copyRoute.middlewares.includes("idempotent({ required: true })"));
    const grantRoute = routes.find((r) => r.path === "/admin/admins/grant");
    assert.ok(grantRoute.middlewares.includes("requireStepUp"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("classifyCoverage separates used, available-but-unused, and called-but-missing", () => {
  const backend = [
    { method: "POST", path: "/trade/copy", middlewares: ["requireAuth", "idempotent({ required: true })"] },
    { method: "GET", path: "/reports", middlewares: ["requireAuth"] },
  ];
  const frontend = [
    { fn: "initiateCopyTrade", file: "lib/api/trade.ts", line: 35, method: "POST", path: "/trade/copy" },
    { fn: "getVapidKey", file: "lib/api/notifications.ts", line: 57, method: "GET", path: "/notifications/vapid-key" },
  ];

  const cov = classifyCoverage(backend, frontend);
  assert.equal(cov.used.length, 1);
  assert.equal(cov.availableButUnused.length, 1);
  assert.equal(cov.calledButMissing.length, 1);
  assert.equal(cov.calledButMissing[0].key, "GET /notifications/vapid-key");
});

test("extractFrontendCalls finds real frontend apiClient calls and updateApiDocContent preserves narrative", () => {
  const frontendCalls = extractFrontendCalls();
  assert.ok(frontendCalls.some((c) => c.method === "POST" && c.path === "/trade/copy"));
  assert.ok(frontendCalls.some((c) => c.method === "GET" && c.path === "/notifications/vapid-key"));

  const doc = `# Header\n\nNarrative stays.\n\n${BEGIN_MARKER}\nold\n${END_MARKER}\n\nFooter.\n`;
  const section = renderGeneratedSection({
    backendRef: { repository: "OracleDesk/OracleDesk-Backend", commit: "abc123" },
    backendRoutes: null,
    frontendCalls: frontendCalls.slice(0, 2),
  });
  const updated = updateApiDocContent(doc, section);
  assert.ok(updated.includes("Narrative stays."));
  assert.ok(updated.includes("Footer."));
  assert.ok(!updated.includes("\nold\n"));
});
