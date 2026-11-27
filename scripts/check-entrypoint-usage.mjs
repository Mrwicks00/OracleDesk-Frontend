import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const config = JSON.parse(fs.readFileSync(path.join(root, "scripts/entrypoints.config.json"), "utf8"));
const pinFile = path.join(root, "lib/stellar/__tests__/typed-call.test-d.ts");
const pins = fs.existsSync(pinFile) ? fs.readFileSync(pinFile, "utf8") : "";

const contractNames = {
  marketCore: "MarketCoreClient",
  treasury: "TreasuryClient",
  resolver: "ResolverClient",
  reasoningRegistry: "ReasoningRegistryClient",
};

function listFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "generated" || entry.name === "__tests__" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = [...listFiles(path.join(root, "lib")), ...listFiles(path.join(root, "app")), ...listFiles(path.join(root, "components"))];
const program = ts.createProgram(files, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  jsx: ts.JsxEmit.ReactJSX,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: false,
});
const checker = program.getTypeChecker();
const used = new Map();

for (const file of files) {
  const source = program.getSourceFile(file);
  if (!source) continue;

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const receiverType = checker.getTypeAtLocation(node.expression.expression);
      const typeName = checker.typeToString(receiverType);
      let contract = null;
      for (const [name, clientName] of Object.entries(contractNames)) {
        if (typeName.includes(clientName)) contract = name;
      }
      if (!contract) {
        const text = node.expression.expression.getText(source);
        if (/marketCore\(|treasury\(|resolver\(|reasoningRegistry\(/.test(text)) {
          contract = text.match(/marketCore|treasury|resolver|reasoningRegistry/)?.[0] ?? null;
        }
      }
      if (contract) {
        const key = `${contract}.${method}`;
        if (!used.has(key)) used.set(key, []);
        used.get(key).push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

const rows = [];
let failed = false;
for (const [key, locations] of [...used].sort()) {
  const pin = pins.includes(`"${key.split(".")[1]}"`) || pins.includes(`'${key.split(".")[1]}'`);
  const entry = config.methods[key];
  let review = true;
  if (entry?.kind === "write" && !entry.allowUnreviewed) {
    review = false;
    const method = key.split(".")[1];
    for (const loc of locations) {
      const text = fs.readFileSync(loc.file, "utf8");
      if (text.includes("runQueuedWrite") && text.includes("reviewPreparedWrite")) review = true;
    }
  }
  rows.push([key, `${locations.length} call(s)`, pin ? "pin" : "MISSING PIN", review ? "review" : "MISSING REVIEW"]);
  if (!pin || !review) failed = true;
}

console.log("Entrypoint usage");
console.log(["method", "uses", "type pin", "write review"].join(" | "));
console.log(["-".repeat(20), "-".repeat(8), "-".repeat(12), "-".repeat(12)].join("-+-"));
for (const row of rows) console.log(row.join(" | "));
if (!rows.length) console.log("(no generated binding calls detected)");
if (failed) process.exitCode = 1;
