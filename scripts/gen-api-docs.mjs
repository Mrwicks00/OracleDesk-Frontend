#!/usr/bin/env node
/**
 * Generates the Frontend call map and backend route coverage table in
 * `docs/api.md` between `<!-- BEGIN GENERATED:API_CALL_MAP -->` and
 * `<!-- END GENERATED:API_CALL_MAP -->` markers (issue #262).
 *
 * Uses the TypeScript compiler API (no regexes on source) to parse:
 * 1. Backend mounted routes from `--backend <path>` (`src/routes/index.ts` + route files)
 * 2. Frontend `apiClient` call sites in `lib/`, `app/`, `components/`
 *
 * Usage:
 *   node scripts/gen-api-docs.mjs [--backend /path/to/OracleDesk-Backend] [--write]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const BEGIN_MARKER = "<!-- BEGIN GENERATED:API_CALL_MAP -->";
const END_MARKER = "<!-- END GENERATED:API_CALL_MAP -->";
export { END_MARKER };

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

function walkTs(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules" || entry.name === "generated") continue;
      out.push(...walkTs(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test(?:-d)?\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Normalizes template expressions like `/markets/${id}/confirm` -> `/markets/:param/confirm`. */
export function normalizePathExpr(expr) {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text.split("?")[0];
  }
  if (ts.isTemplateExpression(expr)) {
    let out = expr.head.text;
    for (const span of expr.templateSpans) {
      out += ":param" + span.literal.text;
    }
    return out.split("?")[0];
  }
  if (ts.isTaggedTemplateExpression(expr)) {
    return normalizePathExpr(expr.template);
  }
  return null;
}

/** Canonicalizes `:foo` param names to `:param` for route matching. */
export function canonicalRouteKey(method, path) {
  const normPath = path
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .replace(/:[^/]+/g, ":param") || "/";
  return `${method.toUpperCase()} ${normPath}`;
}

function enclosingFunctionName(node) {
  let cur = node.parent;
  while (cur) {
    if ((ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur)) && cur.name) {
      return cur.name.getText();
    }
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) {
      return cur.name.text;
    }
    cur = cur.parent;
  }
  return "<module>";
}

/** Extracts all `apiClient.<method>(path, ...)` call sites from the frontend. */
export function extractFrontendCalls(rootDir = ROOT) {
  const dirs = ["lib", "app", "components"].map((d) => join(rootDir, d));
  const files = dirs.flatMap((d) => walkTs(d));
  const calls = [];

  for (const file of files) {
    const relPath = relative(rootDir, file).split(sep).join("/");
    const text = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(
      relPath,
      text,
      ts.ScriptTarget.Latest,
      true,
      relPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    // Track local string variables like `const path = ...`
    const stringVars = new Map();
    function collectStrings(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const p = normalizePathExpr(node.initializer);
        if (p) stringVars.set(node.name.text, p);
      }
      ts.forEachChild(node, collectStrings);
    }
    collectStrings(sf);

    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "apiClient" &&
        HTTP_METHODS.has(node.expression.name.text) &&
        node.arguments.length >= 1
      ) {
        const method = node.expression.name.text.toUpperCase();
        const arg0 = node.arguments[0];
        let path = normalizePathExpr(arg0);
        if (!path && ts.isIdentifier(arg0)) {
          path = stringVars.get(arg0.text) ?? null;
        }
        if (path && path.startsWith("/")) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          calls.push({
            fn: enclosingFunctionName(node),
            file: relPath,
            line: line + 1,
            method,
            path,
          });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }

  return calls.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function summarizeMiddleware(expr, sf) {
  const text = expr.getText(sf).trim();
  if (
    text.startsWith("requireAuth") ||
    text.startsWith("requirePermission") ||
    text.startsWith("requireStepUp") ||
    text.startsWith("idempotent") ||
    text.toLowerCase().includes("ratelimit") ||
    text.toLowerCase().includes("limiter")
  ) {
    return text;
  }
  return null;
}

/**
 * Extracts mounted Express routes from a backend checkout's `src/routes/index.ts`
 * and its imported route modules using the TypeScript compiler API.
 */
export function extractBackendRoutes(backendDir) {
  const indexFile = join(backendDir, "src/routes/index.ts");
  if (!existsSync(indexFile)) {
    throw new Error(`Backend routes index not found at ${indexFile}`);
  }
  const indexText = readFileSync(indexFile, "utf8");
  const indexSf = ts.createSourceFile("src/routes/index.ts", indexText, ts.ScriptTarget.Latest, true);

  // Map imported identifier -> resolved file path
  const imports = new Map();
  for (const stmt of indexSf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier) && stmt.importClause) {
      const spec = stmt.moduleSpecifier.text;
      if (!spec.startsWith(".")) continue;
      const base = resolve(dirname(indexFile), spec);
      const candidates = [base, `${base}.ts`, join(base, "index.ts")];
      const target = candidates.find((c) => existsSync(c));
      if (!target) continue;
      if (stmt.importClause.name) {
        imports.set(stmt.importClause.name.text, target);
      }
      if (stmt.importClause.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
        for (const el of stmt.importClause.namedBindings.elements) {
          imports.set(el.name.text, target);
        }
      }
    }
  }

  // Find `router.use("/prefix", ...middlewares, groupRouter)`
  const mounts = [];
  function visitIndex(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "use" &&
      node.arguments.length >= 2
    ) {
      const prefix = normalizePathExpr(node.arguments[0]);
      if (prefix && prefix.startsWith("/")) {
        const lastArg = node.arguments[node.arguments.length - 1];
        if (ts.isIdentifier(lastArg) && imports.has(lastArg.text)) {
          const mountMiddlewares = node.arguments
            .slice(1, -1)
            .map((a) => summarizeMiddleware(a, indexSf))
            .filter(Boolean);
          mounts.push({ prefix, file: imports.get(lastArg.text), middlewares: mountMiddlewares });
        }
      }
    }
    ts.forEachChild(node, visitIndex);
  }
  visitIndex(indexSf);

  const routes = [];
  for (const mount of mounts) {
    const modText = readFileSync(mount.file, "utf8");
    const modSf = ts.createSourceFile(mount.file, modText, ts.ScriptTarget.Latest, true);
    function visitMod(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        HTTP_METHODS.has(node.expression.name.text) &&
        node.arguments.length >= 2
      ) {
        const method = node.expression.name.text.toUpperCase();
        const subPath = normalizePathExpr(node.arguments[0]);
        if (subPath !== null) {
          const fullPath = `${mount.prefix === "/" ? "" : mount.prefix}${subPath === "/" ? "" : subPath}` || "/";
          const localMiddlewares = node.arguments
            .slice(1, -1)
            .map((a) => summarizeMiddleware(a, modSf))
            .filter(Boolean);
          routes.push({
            method,
            path: fullPath,
            middlewares: [...mount.middlewares, ...localMiddlewares],
          });
        }
      }
      ts.forEachChild(node, visitMod);
    }
    visitMod(modSf);
  }

  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

export function classifyCoverage(backendRoutes, frontendCalls) {
  const backendMap = new Map();
  for (const r of backendRoutes) {
    backendMap.set(canonicalRouteKey(r.method, r.path), r);
  }

  const frontendMap = new Map();
  for (const c of frontendCalls) {
    const key = canonicalRouteKey(c.method, c.path);
    if (!frontendMap.has(key)) frontendMap.set(key, []);
    frontendMap.get(key).push(c);
  }

  const used = [];
  const availableButUnused = [];
  const calledButMissing = [];

  for (const [key, r] of backendMap) {
    if (frontendMap.has(key)) {
      used.push({ route: r, calls: frontendMap.get(key) });
    } else {
      availableButUnused.push(r);
    }
  }

  for (const [key, calls] of frontendMap) {
    if (!backendMap.has(key)) {
      calledButMissing.push({ key, calls });
    }
  }

  return { used, availableButUnused, calledButMissing };
}

export function renderGeneratedSection({ backendRef, backendRoutes, frontendCalls }) {
  const lines = [
    BEGIN_MARKER,
    "",
    "Every call in the frontend (`lib/api/*.ts` and `app/`/`components/`), extracted by `scripts/gen-api-docs.mjs`:",
    "",
    "| Frontend function | File | Endpoint |",
    "|---|---|---|",
  ];

  for (const c of frontendCalls) {
    lines.push(`| \`${c.fn}\` | \`${c.file}:${c.line}\` | \`${c.method} ${c.path}\` |`);
  }

  lines.push("");
  if (backendRoutes === null) {
    lines.push(
      `> **Backend route coverage:** pending generation against the pinned checkout (\`${backendRef.repository}\` @ \`${backendRef.commit}\`). Run \`node scripts/gen-api-docs.mjs --backend /path/to/OracleDesk-Backend --write\` to populate the mounted-route coverage table.`,
    );
  } else {
    const cov = classifyCoverage(backendRoutes, frontendCalls);
    lines.push(`### Backend route coverage (\`${backendRef.repository}\` @ \`${backendRef.commit}\`)`);
    lines.push("");
    lines.push(
      `- **Used:** ${cov.used.length} · **Available but unused:** ${cov.availableButUnused.length} · **Called but missing:** ${cov.calledButMissing.length}`,
    );
    lines.push("");
    lines.push("| Status | Method & Path | Middleware | Frontend call sites |");
    lines.push("|---|---|---|---|");
    for (const item of cov.used) {
      const mw = item.route.middlewares.length ? item.route.middlewares.map((m) => `\`${m}\``).join(", ") : "—";
      const callers = item.calls.map((c) => `\`${c.fn}\``).join(", ");
      lines.push(`| used | \`${item.route.method} ${item.route.path}\` | ${mw} | ${callers} |`);
    }
    for (const r of cov.availableButUnused) {
      const mw = r.middlewares.length ? r.middlewares.map((m) => `\`${m}\``).join(", ") : "—";
      lines.push(`| available-but-unused | \`${r.method} ${r.path}\` | ${mw} | — |`);
    }
    for (const m of cov.calledButMissing) {
      const callers = m.calls.map((c) => `\`${c.fn}\` (\`${c.file}:${c.line}\`)`).join(", ");
      lines.push(`| called-but-missing | \`${m.key}\` | — | ${callers} |`);
    }
  }

  lines.push("");
  lines.push(END_MARKER);
  return lines.join("\n");
}

export function updateApiDocContent(existingDoc, generatedSection) {
  const startIdx = existingDoc.indexOf(BEGIN_MARKER);
  const endIdx = existingDoc.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`docs/api.md is missing ${BEGIN_MARKER} / ${END_MARKER} markers.`);
  }
  return (
    existingDoc.slice(0, startIdx) +
    generatedSection +
    existingDoc.slice(endIdx + END_MARKER.length)
  );
}

function parseCliArgs(argv) {
  let backendDir = null;
  let write = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--backend" && argv[i + 1]) {
      backendDir = resolve(argv[++i]);
    } else if (argv[i] === "--write") {
      write = true;
    }
  }
  return { backendDir, write };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { backendDir, write } = parseCliArgs(process.argv.slice(2));
  const backendRef = JSON.parse(readFileSync(join(ROOT, "docs/backend-ref.json"), "utf8"));
  const frontendCalls = extractFrontendCalls(ROOT);
  const backendRoutes = backendDir ? extractBackendRoutes(backendDir) : null;
  const generated = renderGeneratedSection({ backendRef, backendRoutes, frontendCalls });
  const apiDocPath = join(ROOT, "docs/api.md");
  const current = readFileSync(apiDocPath, "utf8");
  const next = updateApiDocContent(current, generated);

  if (write) {
    writeFileSync(apiDocPath, next, "utf8");
    console.log(`Updated docs/api.md (${frontendCalls.length} frontend calls${backendRoutes ? `, ${backendRoutes.length} backend routes` : ", frontend-only mode"}).`);
  } else {
    process.stdout.write(generated + "\n");
  }
}
