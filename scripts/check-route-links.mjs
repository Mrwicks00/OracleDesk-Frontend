#!/usr/bin/env node
/**
 * CI check (issue #261): every internal link in the codebase must resolve to a
 * real route in the `app/` directory (including dynamic segments).
 * Uses the TypeScript compiler API (no regexes on source).
 *
 * Run: node scripts/check-route-links.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_EXT = /\.(ts|tsx)$/;

function walkFiles(dir, { includeTests = false } = {}) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!includeTests && (entry.name === "__tests__" || entry.name === "node_modules")) continue;
      out.push(...walkFiles(full, { includeTests }));
    } else if (SOURCE_EXT.test(entry.name)) {
      if (!includeTests && /\.test(?:-d)?\.tsx?$/.test(entry.name)) continue;
      out.push(full);
    }
  }
  return out;
}

/** Discovers all Next.js App Router page routes under `app/`. */
export function discoverAppRoutes(appDir) {
  const routes = new Set();
  for (const file of walkFiles(appDir)) {
    const rel = relative(appDir, file).split(sep).join("/");
    const parts = rel.split("/");
    const fileName = parts.pop();
    if (!fileName || !/^page\.(?:tsx?|jsx?)$/.test(fileName)) continue;
    const segments = parts.filter((seg) => !(seg.startsWith("(") && seg.endsWith(")")));
    routes.add(segments.length === 0 ? "/" : `/${segments.join("/")}`);
  }
  return routes;
}

/** Checks whether a concrete or pattern path matches any discovered app route. */
export function routeMatchesApp(target, appRoutes) {
  const clean = target.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (appRoutes.has(clean)) return true;

  const targetSegs = clean === "/" ? [] : clean.slice(1).split("/");
  for (const route of appRoutes) {
    const routeSegs = route === "/" ? [] : route.slice(1).split("/");
    if (routeSegs.length !== targetSegs.length) continue;
    let ok = true;
    for (let i = 0; i < routeSegs.length; i++) {
      const r = routeSegs[i];
      const t = targetSegs[i];
      if (r.startsWith("[") && r.endsWith("]")) {
        if (!t) {
          ok = false;
          break;
        }
      } else if (r !== t) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** Extracts static internal link strings from JSX `href`, `router.push/replace`, and `ROUTE_CONTRACTS`. */
export function findInternalLinks(sourceText, fileName) {
  const sf = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const links = [];

  function record(value, node) {
    if (!value.startsWith("/") || value.startsWith("//")) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    links.push({ line: line + 1, target: value });
  }

  function extractFromExpr(expr) {
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      record(expr.text, expr);
    } else if (ts.isTemplateExpression(expr)) {
      // Build placeholder segments for template expressions so `/agent/${x}` -> `/agent/_param_`
      let built = expr.head.text;
      for (const span of expr.templateSpans) {
        built += "_param_" + span.literal.text;
      }
      record(built, expr);
    }
  }

  function visit(node) {
    // <Link href="/..."> or <a href="/...">
    if (ts.isJsxAttribute(node) && node.name.text === "href" && node.initializer) {
      if (ts.isStringLiteral(node.initializer)) {
        record(node.initializer.text, node.initializer);
      } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        extractFromExpr(node.initializer.expression);
      }
    }
    // router.push("/...") or router.replace("/...")
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === "push" || node.expression.name.text === "replace") &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "router" &&
      node.arguments.length >= 1
    ) {
      extractFromExpr(node.arguments[0]);
    }
    // NAV_ITEMS / object literal `href: "/..."`
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "href"
    ) {
      extractFromExpr(node.initializer);
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return links;
}

export function checkRouteLinks(rootDir = ROOT) {
  const appRoutes = discoverAppRoutes(join(rootDir, "app"));
  const files = ["app", "components", "lib"].flatMap((d) => walkFiles(join(rootDir, d)));
  const errors = [];

  for (const file of files) {
    const relPath = relative(rootDir, file).split(sep).join("/");
    if (relPath.startsWith("lib/demo/") || relPath.startsWith("app/dev/gallery/")) continue;
    const text = readFileSync(file, "utf8");
    const links = findInternalLinks(text, relPath);
    for (const link of links) {
      if (!routeMatchesApp(link.target, appRoutes)) {
        errors.push({ file: relPath, line: link.line, target: link.target });
      }
    }
  }

  return { errors, routeCount: appRoutes.size };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { errors, routeCount } = checkRouteLinks(ROOT);
  if (errors.length > 0) {
    console.error("Broken internal route links found (issue #261):");
    for (const err of errors) {
      console.error(`  ${err.file}:${err.line} -> "${err.target}" does not match any route in app/`);
    }
    process.exit(1);
  }
  console.log(`OK: all internal links resolve to a real route in app/ (${routeCount} routes discovered).`);
}
