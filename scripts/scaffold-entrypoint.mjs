import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseBindingSignatures } from "./lib/binding-signatures.mjs";

const [, , contract, method, ...flags] = process.argv;
if (!contract || !method) {
  console.error("Usage: node scripts/scaffold-entrypoint.mjs <contract> <method> [--kind read|write] [--dry-run]");
  process.exit(2);
}
const kind = flags.includes("--kind") ? flags[flags.indexOf("--kind") + 1] : "read";
const dryRun = flags.includes("--dry-run");

const files = {
  marketCore: "lib/stellar/generated/market-core.ts",
  treasury: "lib/stellar/generated/treasury.ts",
  resolver: "lib/stellar/generated/resolver.ts",
  reasoningRegistry: "lib/stellar/generated/reasoning-registry.ts",
};
const fileName = path.resolve(files[contract] ?? "");
if (!fs.existsSync(fileName)) throw new Error(`Unknown contract: ${contract}`);
const signatures = parseBindingSignatures(fileName);
const signature = signatures.get(method);
if (!signature) throw new Error(`Method ${method} not found in ${files[contract]}`);

const pascal = method.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
const marker = kind === "read" ? "// scaffold:hooks" : "// scaffold:prepare-functions";
let generated;
if (kind === "read") {
  generated = `
// Generated read scaffold for ${contract}.${method}
export function use${pascal}ReadPlaceholder(/* ids: never[] */): never {
  throw new Error("TODO: implement use${pascal}");
}
`;
} else {
  generated = `
// Generated write scaffold for ${contract}.${method}
export interface Preflight${pascal}Input {}
export async function prepare${pascal}Placeholder(
  signer: Signer,
): Promise<never> {
  void signer;
  throw new Error("TODO: implement prepare${pascal}. Arguments: ${signature.args.map((a) => `${a.name}: ${a.type}`).join(", ")}");
}
export function use${pascal}Placeholder(): never {
  throw new Error("TODO: implement use${pascal}");
}
`;
}

const target = kind === "read" ? "lib/hooks/useStellar.ts" : "lib/hooks/useStellar.ts";
const absoluteTarget = path.resolve(target);
const targetText = fs.readFileSync(absoluteTarget, "utf8");
if (!targetText.includes(marker)) throw new Error(`Missing scaffold marker ${marker} in ${target}`);

if (dryRun) {
  console.log(`--- ${target}`);
  console.log(`+++ ${target} (${pascal} scaffold)`);
  console.log(generated);
  process.exit(0);
}

fs.writeFileSync(absoluteTarget, targetText.replace(marker, `${marker}\n${generated}`));
console.log(`Scaffolded ${contract}.${method} (${kind})`);

try {
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], {
    stdio: "inherit",
  });
} catch {
  console.error("Generated scaffold did not typecheck.");
  process.exit(1);
}
