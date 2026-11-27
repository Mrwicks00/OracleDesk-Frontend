import ts from "typescript";

export function parseBindingSignatures(fileName) {
  const program = ts.createProgram([fileName], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  });
  const source = program.getSourceFile(fileName);
  const checker = program.getTypeChecker();
  const methods = new Map();
  if (!source) return methods;

  function visit(node) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === "Client") {
      for (const member of node.members) {
        if (!ts.isPropertySignature(member) || !member.name || !member.type) continue;
        const name = member.name.getText(source).replaceAll('"', "").replaceAll("'", "");
        const type = checker.getTypeAtLocation(member.type);
        const calls = type.getCallSignatures();
        if (!calls.length) continue;
        const call = calls[0];
        const parameters = call.getParameters();
        const argsType = parameters[0] ? checker.getTypeOfSymbolAtLocation(parameters[0], member.type) : null;
        const args = argsType ? argsType.getProperties().map((p) => ({
          name: p.name,
          type: checker.typeToString(checker.getTypeOfSymbolAtLocation(p, member.type)),
        })) : [];
        const result = checker.typeToString(call.getReturnType(), member.type);
        methods.set(name, { name, args, result });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return methods;
}
