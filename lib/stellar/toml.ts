/**
 * Strict, minimal TOML parser for SEP-1 `stellar.toml` files (issue #263).
 *
 * Supports only the subset needed for SEP-1 issuer verification:
 * - `[TABLE]` headers
 * - `[[ARRAY_OF_TABLES]]` headers
 * - `key = value` pairs with basic strings (`"..."`), literal strings (`'...'`),
 *   integers, and booleans (`true` / `false`)
 * - `#` comments and blank lines
 *
 * Anything outside this subset (multiline strings, inline tables/arrays,
 * dates, floats, duplicate keys, control characters) is rejected with
 * `TomlParseError`.
 */

export type TomlScalar = string | number | boolean;
export type TomlTable = Record<string, unknown>;

export class TomlParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(`TOML parse error on line ${line}: ${message}`);
    this.name = "TomlParseError";
  }
}

const BARE_KEY_RE = /^[A-Za-z0-9_-]+$/;
const INT_RE = /^[+-]?(?:0|[1-9](?:_?\d)*)$/;
const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

function stripComment(line: string, lineNum: number): string {
  let inDouble = false;
  let inSingle = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inDouble) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inDouble = false;
      }
    } else if (inSingle) {
      if (ch === "'") inSingle = false;
    } else {
      if (ch === '"') inDouble = true;
      else if (ch === "'") inSingle = true;
      else if (ch === "#") return line.slice(0, i);
    }
  }
  if (inDouble || inSingle) {
    throw new TomlParseError("unterminated string literal", lineNum);
  }
  return line;
}

function parseKey(raw: string, lineNum: number): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new TomlParseError("empty key", lineNum);
  if (BARE_KEY_RE.test(trimmed)) return trimmed;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1);
    if (!inner || inner.includes('"') || inner.includes("'")) {
      throw new TomlParseError("invalid quoted key", lineNum);
    }
    return inner;
  }
  throw new TomlParseError(`unsupported key syntax "${trimmed}"`, lineNum);
}

function parseBasicString(raw: string, lineNum: number): string {
  // Reject multiline basic strings (""")
  if (raw.startsWith('"""')) {
    throw new TomlParseError("multiline strings are not supported", lineNum);
  }
  let out = "";
  let i = 1;
  while (i < raw.length - 1) {
    const ch = raw[i];
    if (ch === "\\") {
      i++;
      if (i >= raw.length - 1) {
        throw new TomlParseError("trailing backslash in string", lineNum);
      }
      const esc = raw[i];
      switch (esc) {
        case '"':
          out += '"';
          break;
        case "\\":
          out += "\\";
          break;
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        default:
          throw new TomlParseError(`unsupported escape \\${esc}`, lineNum);
      }
    } else if (ch === '"') {
      throw new TomlParseError("unexpected unescaped quote in string", lineNum);
    } else {
      out += ch;
    }
    i++;
  }
  return out;
}

function parseValue(raw: string, lineNum: number): TomlScalar {
  const v = raw.trim();
  if (!v) throw new TomlParseError("missing value", lineNum);

  if (v.startsWith('"')) {
    if (!v.endsWith('"') || v.length < 2) {
      throw new TomlParseError("unterminated basic string", lineNum);
    }
    return parseBasicString(v, lineNum);
  }

  if (v.startsWith("'")) {
    if (v.startsWith("'''")) {
      throw new TomlParseError("multiline literal strings are not supported", lineNum);
    }
    if (!v.endsWith("'") || v.length < 2) {
      throw new TomlParseError("unterminated literal string", lineNum);
    }
    const inner = v.slice(1, -1);
    if (inner.includes("'")) {
      throw new TomlParseError("unexpected quote in literal string", lineNum);
    }
    return inner;
  }

  if (v === "true") return true;
  if (v === "false") return false;

  if (INT_RE.test(v)) {
    const num = Number(v.replaceAll("_", ""));
    if (!Number.isSafeInteger(num)) {
      throw new TomlParseError("integer out of safe range", lineNum);
    }
    return num;
  }

  throw new TomlParseError(`unsupported value "${v}"`, lineNum);
}

function findEqualsOutsideQuotes(line: string): number {
  let inDouble = false;
  let inSingle = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inDouble) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inDouble = false;
    } else if (inSingle) {
      if (ch === "'") inSingle = false;
    } else {
      if (ch === '"') inDouble = true;
      else if (ch === "'") inSingle = true;
      else if (ch === "=") return i;
    }
  }
  return -1;
}

function ensureTablePath(root: TomlTable, segments: string[], lineNum: number): TomlTable {
  let current: TomlTable = root;
  for (const seg of segments) {
    const existing = current[seg];
    if (existing === undefined) {
      const next: TomlTable = {};
      current[seg] = next;
      current = next;
    } else if (Array.isArray(existing)) {
      const last = existing[existing.length - 1];
      if (!last || typeof last !== "object") {
        throw new TomlParseError(`invalid array-of-tables path "${seg}"`, lineNum);
      }
      current = last as TomlTable;
    } else if (typeof existing === "object" && existing !== null) {
      current = existing as TomlTable;
    } else {
      throw new TomlParseError(`key "${seg}" is already defined as a scalar`, lineNum);
    }
  }
  return current;
}

export function parseStrictToml(input: string): TomlTable {
  if (typeof input !== "string") {
    throw new TomlParseError("input must be a string", 1);
  }
  const root: TomlTable = {};
  let currentTable: TomlTable = root;
  const definedTables = new Set<string>();

  const lines = input.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    const rawLine = lines[idx];
    if (CONTROL_CHAR_RE.test(rawLine)) {
      throw new TomlParseError("control character in input", lineNum);
    }
    const stripped = stripComment(rawLine, lineNum).trim();
    if (!stripped) continue;

    if (stripped.startsWith("[[") && stripped.endsWith("]]")) {
      const inner = stripped.slice(2, -2).trim();
      const segments = inner.split(".").map((s) => parseKey(s, lineNum));
      if (segments.length === 0) throw new TomlParseError("empty array-of-tables header", lineNum);
      const parent = ensureTablePath(root, segments.slice(0, -1), lineNum);
      const leaf = segments[segments.length - 1];
      const existing = parent[leaf];
      let arr: TomlTable[];
      if (existing === undefined) {
        arr = [];
        parent[leaf] = arr;
      } else if (Array.isArray(existing)) {
        arr = existing as TomlTable[];
      } else {
        throw new TomlParseError(`"${leaf}" is not an array of tables`, lineNum);
      }
      const nextTable: TomlTable = {};
      arr.push(nextTable);
      currentTable = nextTable;
      continue;
    }

    if (stripped.startsWith("[") && stripped.endsWith("]")) {
      const inner = stripped.slice(1, -1).trim();
      const segments = inner.split(".").map((s) => parseKey(s, lineNum));
      if (segments.length === 0) throw new TomlParseError("empty table header", lineNum);
      const pathKey = segments.join(".");
      if (definedTables.has(pathKey)) {
        throw new TomlParseError(`duplicate table [${pathKey}]`, lineNum);
      }
      definedTables.add(pathKey);
      currentTable = ensureTablePath(root, segments, lineNum);
      continue;
    }

    const eqIdx = findEqualsOutsideQuotes(stripped);
    if (eqIdx <= 0) {
      throw new TomlParseError("expected key = value", lineNum);
    }
    const key = parseKey(stripped.slice(0, eqIdx), lineNum);
    const val = parseValue(stripped.slice(eqIdx + 1), lineNum);
    if (Object.prototype.hasOwnProperty.call(currentTable, key)) {
      throw new TomlParseError(`duplicate key "${key}"`, lineNum);
    }
    currentTable[key] = val;
  }

  return root;
}
