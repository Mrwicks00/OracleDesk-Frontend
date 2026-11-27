#!/usr/bin/env node
/**
 * CI check (issue #261): every `searchParams.get(x)` (and `useSearchParams`
 * read) must correspond to a parameter declared in `ROUTE_CONTRACTS` in
 * `lib/routes.ts`. Uses the TypeScript compiler API (no regexes on source).
 *
 * Run: node scripts/check-route-params.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_EXT = /\.(ts|tsx)$/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...walk(full));
    } else if (SOURCE_EXT.test(entry.name) && !/\.test(?:-d)?\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function rel(file) {
  return relative(ROOT, file).split(sep).join("/");
}

/**
 * Extracts `ROUTE_CONTRACTS` from `lib/routes.ts` using the TS compiler API.
 * Returns Map<string, Set<string>>.
 */
export function extractRouteContracts(routesSource, fileName = "lib/routes.ts") {
  const sf = ts.createSourceFile(fileName, routesSource, ts.ScriptTarget.Latest, true);
  const contracts = new Map();

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "ROUTE_CONTRACTS" &&
      node.initializer
    ) {
      let obj = node.initializer;
      while (ts.isAsExpression(obj) || ts.isSatisfiesExpression(obj)) {
        obj = obj.expression;
      }
      if (ts.isObjectLiteralExpression(obj)) {
        for (const prop of obj.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const key = ts.isStringLiteral(prop.name)
            ? prop.name.text
            : ts.isIdentifier(prop.name)
              ? prop.name.text
              : null;
          if (!key) continue;
          let arr = prop.initializer;
          while (ts.isAsExpression(arr) || ts.isSatisfiesExpression(arr)) {
            arr = arr.expression;
          }
          const params = new Set();
          if (ts.isArrayLiteralExpression(arr)) {
            for (const elem of arr.elements) {
              if (ts.isStringLiteral(elem)) params.add(elem.text);
            }
          }
          contracts.set(key, params);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return contracts;
}

/** Maps a file path like `app/markets/quick-view/page.tsx` -> `/markets/quick-view`. */
export function fileToRoutePath(relPath) {
  if (!relPath.startsWith("app/")) return null;
  const parts = relPath.slice("app/".length).split("/");
  const fileName = parts.pop();
  if (!fileName || !/^(?:page|page-client)\.tsx?$/.test(fileName)) return null;
  if (parts.length === 0) return "/";
  return `/${parts.join("/")}`;
}

/**
 * Scans a TypeScript source file for `searchParams.get("...")` or calls on a
 * variable initialized with `useSearchParams()`.
 */
export function findSearchParamReads(sourceText, fileName) {
  const sf = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const searchParamVars = new Set(["searchParams"]);
  const reads = [];

  function collectVars(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === "useSearchParams"
    ) {
      searchParamVars.add(node.name.text);
    }
    ts.forEachChild(node, collectVars);
  }

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "get" &&
      ts.isIdentifier(node.expression.expression) &&
      searchParamVars.has(node.expression.expression.text) &&
      node.arguments.length >= 1
    ) {
      const arg = node.arguments[0];
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
        reads.push({ line: line + 1, param: arg.text });
      } else {
        reads.push({ line: line + 1, param: "<dynamic>" });
      }
    }
    ts.forEachChild(node, visit);
  }

  collectVars(sf);
  visit(sf);
  return reads;
}

export function checkRouteParams(rootDir = ROOT) {
  const routesText = readFileSync(join(rootDir, "lib/routes.ts"), "utf8");
  const contracts = extractRouteContracts(routesText, "lib/routes.ts");
  const files = ["app", "components", "lib"].flatMap((d) => walk(join(rootDir, d)));
  const errors = [];

  for (const file of files) {
    const relPath = relative(rootDir, file).split(sep).join("/");
    if (relPath === "lib/routes.ts") continue;
    const text = readFileSync(file, "utf8");
    const reads = findSearchParamReads(text, relPath);
    if (reads.length === 0) continue;

    const routePath = fileToRoutePath(relPath);
    const allowed = routePath ? contracts.get(routePath) : null;
    for (const r of reads) {
      if (!routePath || !allowed) {
        errors.push({
          file: relPath,
          line: r.line,
          param: r.param,
          reason: routePath ? `route "${routePath}" has no entry in ROUTE_CONTRACTS` : "read outside a route page",
        });
      } else if (!allowed.has(r.param)) {
        errors.push({
          file: relPath,
          line: r.line,
          param: r.param,
          reason: `param "${r.param}" is not declared in ROUTE_CONTRACTS["${routePath}"]`,
        });
      }
    }
  }
  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const errors = checkRouteParams(ROOT);
  if (errors.length > 0) {
    console.error("Undeclared searchParams reads found (issue #261):");
    for (const err of errors) {
      console.error(`  ${err.file}:${err.line} (${err.param}): ${err.reason}`);
    }
    process.exit(1);
  }
  console.log("OK: all searchParams reads match ROUTE_CONTRACTS in lib/routes.ts.");
}
