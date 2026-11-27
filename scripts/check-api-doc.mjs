#!/usr/bin/env node
/**
 * CI staleness check (issue #262): regenerates the generated sections of
 * `docs/api.md` and fails with a readable diff if `docs/api.md` is stale.
 *
 * Run: node scripts/check-api-doc.mjs [--backend /path/to/OracleDesk-Backend]
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractBackendRoutes,
  extractFrontendCalls,
  renderGeneratedSection,
  updateApiDocContent,
} from "./gen-api-docs.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export function checkApiDoc({ rootDir = ROOT, backendDir = null } = {}) {
  const backendRef = JSON.parse(readFileSync(join(rootDir, "docs/backend-ref.json"), "utf8"));
  const frontendCalls = extractFrontendCalls(rootDir);
  const backendRoutes = backendDir ? extractBackendRoutes(backendDir) : null;
  const generated = renderGeneratedSection({ backendRef, backendRoutes, frontendCalls });
  const current = readFileSync(join(rootDir, "docs/api.md"), "utf8");
  const expected = updateApiDocContent(current, generated);
  return { stale: current !== expected, current, expected };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let backendDir = null;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--backend" && args[i + 1]) {
      backendDir = resolve(args[++i]);
    }
  }
  const { stale, current, expected } = checkApiDoc({ rootDir: ROOT, backendDir });
  if (stale) {
    console.error("docs/api.md generated section is stale (issue #262).");
    console.error("Run: node scripts/gen-api-docs.mjs --write" + (backendDir ? ` --backend ${backendDir}` : ""));
    const curLines = current.split("\n");
    const expLines = expected.split("\n");
    const max = Math.max(curLines.length, expLines.length);
    let shown = 0;
    for (let i = 0; i < max && shown < 25; i++) {
      if (curLines[i] !== expLines[i]) {
        console.error(`  L${i + 1}:`);
        if (curLines[i] !== undefined) console.error(`  - ${curLines[i]}`);
        if (expLines[i] !== undefined) console.error(`  + ${expLines[i]}`);
        shown++;
      }
    }
    process.exit(1);
  }
  console.log("OK: docs/api.md generated call map is up to date.");
}
