import { describe, expect, it } from "vitest";
import { parseStrictToml, TomlParseError } from "../toml";

describe("parseStrictToml", () => {
  it("parses tables, arrays of tables, strings, integers, and booleans", () => {
    const doc = parseStrictToml(`
      # SEP-1 example
      VERSION = "2.0.0"
      ACCOUNTS = 'GABC'

      [DOCUMENTATION]
      ORG_NAME = "Circle Internet Financial"
      ORG_OFFICIAL_EMAIL = "support@circle.com"

      [[CURRENCIES]]
      code = "USDC"
      issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
      display_decimals = 7
      is_asset_anchored = true
    `);

    expect(doc.VERSION).toBe("2.0.0");
    expect(doc.ACCOUNTS).toBe("GABC");
    expect((doc.DOCUMENTATION as Record<string, unknown>).ORG_NAME).toBe("Circle Internet Financial");
    expect(Array.isArray(doc.CURRENCIES)).toBe(true);
    const currencies = doc.CURRENCIES as Record<string, unknown>[];
    expect(currencies[0]).toEqual({
      code: "USDC",
      issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      display_decimals: 7,
      is_asset_anchored: true,
    });
  });

  it("rejects unsupported constructs, duplicate keys, and control chars", () => {
    expect(() => parseStrictToml('a = """multi"""')).toThrow(TomlParseError);
    expect(() => parseStrictToml("a = [1, 2]")).toThrow(TomlParseError);
    expect(() => parseStrictToml("a = { k = 1 }")).toThrow(TomlParseError);
    expect(() => parseStrictToml('a = "1"\na = "2"')).toThrow(TomlParseError);
    expect(() => parseStrictToml("[A]\nk = 1\n[A]\nk = 2")).toThrow(TomlParseError);
    expect(() => parseStrictToml('a = "bad\x00char"')).toThrow(TomlParseError);
    expect(() => parseStrictToml("not a key value")).toThrow(TomlParseError);
  });
});
