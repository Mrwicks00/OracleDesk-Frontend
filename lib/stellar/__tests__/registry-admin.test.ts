import { describe, it, expect } from "vitest";
import { xdr } from "@stellar/stellar-sdk";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMapEntry(key: xdr.ScVal, val: xdr.ScVal): xdr.ScMapEntry {
  return new xdr.ScMapEntry({ key, val });
}

/** Bare symbol key: scvSymbol("Admin") */
function bareSymbolEntry(name: string, value: string): xdr.ScMapEntry {
  return makeMapEntry(xdr.ScVal.scvSymbol(name), xdr.ScVal.scvString(value));
}

/** Enum unit variant: scvVec([scvSymbol("Admin")]) */
function vecSymbolEntry(name: string, value: string): xdr.ScMapEntry {
  return makeMapEntry(
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]),
    xdr.ScVal.scvString(value),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("readInstanceValue encoding variants", () => {
  function parseStorage(
    storage: xdr.ScMapEntry[],
    keyName: string,
  ): unknown | null {
    const { scValToNative } = require("@stellar/stellar-sdk");
    for (const item of storage) {
      const itemKey = item.key();
      if (itemKey.switch().name === "scvSymbol" && itemKey.sym().toString() === keyName) {
        return scValToNative(item.val());
      }
      if (itemKey.switch().name === "scvVec") {
        const vec = itemKey.vec();
        if (
          vec &&
          vec.length === 1 &&
          vec[0].switch().name === "scvSymbol" &&
          vec[0].sym().toString() === keyName
        ) {
          return scValToNative(item.val());
        }
      }
    }
    return null;
  }

  it("finds admin encoded as bare scvSymbol('Admin')", () => {
    const storage = [bareSymbolEntry("Admin", "GADMIN123456")];
    const result = parseStorage(storage, "Admin");
    expect(result).toBe("GADMIN123456");
  });

  it("finds admin encoded as scvVec([scvSymbol('Admin')]) (DataKey::Admin pattern)", () => {
    const storage = [vecSymbolEntry("Admin", "GADMIN654321")];
    const result = parseStorage(storage, "Admin");
    expect(result).toBe("GADMIN654321");
  });

  it("returns null when key is absent", () => {
    const storage = [bareSymbolEntry("SomethingElse", "value")];
    const result = parseStorage(storage, "Admin");
    expect(result).toBeNull();
  });

  it("returns null for empty storage", () => {
    const result = parseStorage([], "Admin");
    expect(result).toBeNull();
  });

  it("prefers bare scvSymbol over vec when both are present", () => {
    const storage = [
      bareSymbolEntry("Admin", "G_bare"),
      vecSymbolEntry("Admin", "G_vec"),
    ];
    const result = parseStorage(storage, "Admin");
    expect(result).toBe("G_bare");
  });
});
