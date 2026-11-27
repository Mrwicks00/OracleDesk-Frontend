import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  KIT_VERSION,
  LEARNED_TTL_MS,
  effectiveCaps,
  isKitUnsupported,
  modulesSupporting,
  recordOutcome,
} from "../wallet-capabilities";

const NOW = 1_700_000_000_000;

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});

describe("static capability table", () => {
  it("marks Lobstr as unable to sign auth entries", () => {
    expect(effectiveCaps("lobstr", { now: NOW }).signAuthEntry).toBe("no");
  });

  it("lists Freighter as supporting auth entries", () => {
    expect(modulesSupporting("signAuthEntry")).toContain("freighter");
    expect(modulesSupporting("signAuthEntry")).not.toContain("lobstr");
  });

  it("treats unlisted modules as unknown", () => {
    expect(effectiveCaps("some-new-module", { now: NOW }).signAuthEntry).toBe("unknown");
    expect(effectiveCaps(null, { now: NOW }).getNetwork).toBe("unknown");
  });

  it("is pinned to the kit version it was checked against", () => {
    expect(KIT_VERSION).toBe("2.5.0");
  });
});

describe("learned outcomes", () => {
  it("a learned unsupported result overrides a static yes", () => {
    recordOutcome("freighter", "signAuthEntry", "unsupported", { now: NOW });
    expect(effectiveCaps("freighter", { now: NOW }).signAuthEntry).toBe("no");
  });

  it("a learned ok fills in an unknown entry only", () => {
    recordOutcome("newwallet", "signAuthEntry", "ok", { now: NOW });
    expect(effectiveCaps("newwallet", { now: NOW }).signAuthEntry).toBe("yes");
    recordOutcome("lobstr", "signAuthEntry", "ok", { now: NOW });
    expect(effectiveCaps("lobstr", { now: NOW }).signAuthEntry).toBe("no");
  });

  it("ignores learned entries after an extension version change", () => {
    recordOutcome("freighter", "signAuthEntry", "unsupported", { now: NOW, extensionVersion: "1.0" });
    expect(effectiveCaps("freighter", { now: NOW, extensionVersion: "2.0" }).signAuthEntry).toBe("yes");
  });

  it("expires learned negatives after 30 days", () => {
    recordOutcome("freighter", "signAuthEntry", "unsupported", { now: NOW });
    expect(effectiveCaps("freighter", { now: NOW + LEARNED_TTL_MS + 1 }).signAuthEntry).toBe("yes");
  });
});

describe("isKitUnsupported", () => {
  it("recognises kit code -3 and its message", () => {
    expect(isKitUnsupported({ code: -3, message: 'Lobstr does not support the "signAuthEntry" function' })).toBe(true);
    expect(isKitUnsupported(new Error('Ledger do not support the "signAuthEntry" function'))).toBe(true);
  });

  it("does not treat a user rejection as unsupported", () => {
    expect(isKitUnsupported({ code: -4, message: "User declined" })).toBe(false);
  });
});
