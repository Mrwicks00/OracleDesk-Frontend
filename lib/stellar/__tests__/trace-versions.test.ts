/**
 * Tests for the version-aware trace schema registry (#308).
 *
 * Tests:
 * - Detection for each format fixture
 * - schemaVersion: 3 → unknown
 * - backend-v1 missing probabilityEstimate → estimate null with issue
 * - agents-v2 buy maps fairValue.bps, reserves snapshot, and order as bigint
 * - agents-v2 priceYesBps inconsistency recorded as issue
 * - agents-v1 marketId above 2^53 flagged
 * - Unknown fields listed, not adopted
 * - __proto__ keys ignored
 * - Text content → reasoning only
 */

import { describe, it, expect } from "vitest";
import { parseTrace } from "../trace-versions";
import type { TraceView } from "../trace-versions";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function view(content: unknown): TraceView {
  return parseTrace(content);
}

// ─── backend-v1 ──────────────────────────────────────────────────────────────

describe("backend-v1 detection", () => {
  it("detects backend-v1 by schemaVersion=1 and kind", () => {
    const v = view({ schemaVersion: 1, kind: "oracledesk.trace", probabilityEstimate: 0.64, createdAt: "2026-01-01T00:00:00Z" });
    expect(v.format).toBe("backend-v1");
  });

  it("maps probabilityEstimate [0,1] to yesBps correctly", () => {
    const v = view({ schemaVersion: 1, kind: "oracledesk.trace", probabilityEstimate: 0.64 });
    expect(v.estimate?.yesBps).toBe(6400n);
    expect(v.estimate?.source).toBe("probabilityEstimate");
  });

  it("maps confidenceInterval to interval in bps", () => {
    const v = view({
      schemaVersion: 1,
      kind: "oracledesk.trace",
      probabilityEstimate: 0.64,
      confidenceInterval: { lower: 0.58, upper: 0.70 },
    });
    expect(v.estimate?.interval?.loBps).toBe(5800n);
    expect(v.estimate?.interval?.hiBps).toBe(7000n);
  });

  it("sets estimate null and adds issue when probabilityEstimate missing", () => {
    const v = view({ schemaVersion: 1, kind: "oracledesk.trace" });
    expect(v.estimate).toBeNull();
    expect(v.issues.some((i) => i.includes("probabilityEstimate"))).toBe(true);
  });

  it("rejects probabilityEstimate out of [0,1] — no cross-format percent heuristic", () => {
    const v = view({ schemaVersion: 1, kind: "oracledesk.trace", probabilityEstimate: 62 });
    expect(v.estimate).toBeNull();
    expect(v.issues.some((i) => i.includes("out of [0,1]"))).toBe(true);
  });

  it("maps decisionType to decision", () => {
    const v = view({ schemaVersion: 1, kind: "oracledesk.trace", decisionType: "buy" });
    expect(v.decision).toBe("buy");
  });

  it("maps sourcesUsed to sources", () => {
    const v = view({
      schemaVersion: 1,
      kind: "oracledesk.trace",
      sourcesUsed: [{ name: "Reuters", weight: 0.6, signal: "bullish", url: "https://reuters.com" }],
    });
    expect(v.sources).toHaveLength(1);
    expect(v.sources[0].name).toBe("Reuters");
    expect(v.sources[0].weight).toBeCloseTo(0.6);
  });

  it("createdAt ISO string → timestamp in unix seconds", () => {
    const v = view({ schemaVersion: 1, kind: "oracledesk.trace", createdAt: "2026-11-15T10:30:00Z" });
    expect(typeof v.timestamp).toBe("number");
    expect(v.timestamp).toBeGreaterThan(0);
  });

  it("reports unknown fields without adopting them", () => {
    const v = view({ schemaVersion: 1, kind: "oracledesk.trace", myCustomField: "secret" });
    expect(v.unknownFields).toContain("myCustomField");
    expect((v as unknown as Record<string, unknown>)["myCustomField"]).toBeUndefined();
  });
});

// ─── agents-v2 ───────────────────────────────────────────────────────────────

describe("agents-v2 detection", () => {
  const baseV2 = {
    schemaVersion: 2,
    agent: "trader",
    marketId: "42",
    action: "buy",
    inputs: {
      reserveYes: "5000000000",
      reserveNo: "5000000000",
      feeBps: 200,
      priceYesBps: 5000,
      fairValue: { bps: 6400, source: "model", observedAt: "2026-01-01T00:00:00Z" },
      order: { collateralIn: "1000000000", minSharesOut: "1050000000" },
      ledgerSequence: 54000000,
      ledgerCloseTime: 1731667800,
    },
    ledgerSequence: 54000000,
    ledgerCloseTime: 1731667800,
    timestamp: 1731667800,
  };

  it("detects agents-v2 by schemaVersion=2 and agent", () => {
    expect(view(baseV2).format).toBe("agents-v2");
  });

  it("maps inputs.fairValue.bps to estimate as bigint", () => {
    const v = view(baseV2);
    expect(v.estimate?.yesBps).toBe(6400n);
    expect(v.estimate?.source).toBe("fairValue.bps");
  });

  it("maps market snapshot from string reserves to bigints", () => {
    const v = view(baseV2);
    expect(v.marketSnapshot?.reserveYes).toBe(5_000_000_000n);
    expect(v.marketSnapshot?.reserveNo).toBe(5_000_000_000n);
    expect(v.marketSnapshot?.feeBps).toBe(200);
    expect(v.marketSnapshot?.ledger).toBe(54000000);
  });

  it("maps order strings to bigints", () => {
    const v = view(baseV2);
    expect(v.order?.collateralIn).toBe(1_000_000_000n);
    expect(v.order?.minSharesOut).toBe(1_050_000_000n);
  });

  it("records priceYesBps inconsistency as issue (not error)", () => {
    const v = view({
      ...baseV2,
      inputs: { ...baseV2.inputs, priceYesBps: 9999 }, // wrong
    });
    expect(v.estimate?.yesBps).toBe(6400n); // estimate still present
    expect(v.issues.some((i) => i.includes("priceYesBps"))).toBe(true);
  });

  it("estimate null for buy when fairValue missing, with issue", () => {
    const v = view({
      ...baseV2,
      inputs: { ...baseV2.inputs, fairValue: undefined },
    });
    expect(v.estimate).toBeNull();
    expect(v.issues.some((i) => i.includes("fairValue"))).toBe(true);
  });

  it("reports extensions fields in unknownFields", () => {
    const v = view({ ...baseV2, extensions: { extraData: "foo" }, unknownTopLevel: true });
    expect(v.unknownFields).toContain("unknownTopLevel");
  });
});

// ─── agents-v1 ───────────────────────────────────────────────────────────────

describe("agents-v1 detection", () => {
  const baseV1 = {
    agent: "trader",
    marketId: 42,
    action: "buy:yes",
    reasoning: "Analysis complete.",
    inputs: { fairValueBps: 6400, signal: "bullish" },
    timestamp: 1731667800,
  };

  it("detects agents-v1 by agent field and inputs object (no schemaVersion)", () => {
    expect(view(baseV1).format).toBe("agents-v1");
  });

  it("maps action string to decision and side", () => {
    const v = view(baseV1);
    expect(v.decision).toBe("buy");
    expect(v.side).toBe("Yes");
  });

  it("maps inputs.fairValueBps to estimate", () => {
    const v = view(baseV1);
    expect(v.estimate?.yesBps).toBe(6400n);
  });

  it("gives null estimate for maker traces (no fairValueBps)", () => {
    const v = view({ ...baseV1, inputs: { signal: "maker", decision: "provide-liquidity", dueDiligence: "ok" } });
    expect(v.estimate).toBeNull();
  });

  it("flags marketId above Number.MAX_SAFE_INTEGER", () => {
    const v = view({ ...baseV1, marketId: 9007199254740993 });
    expect(v.issues.some((i) => i.includes("MAX_SAFE_INTEGER"))).toBe(true);
  });

  it("normalizes numeric marketId to string", () => {
    const v = view({ ...baseV1, marketId: 42 });
    expect(v.marketId).toBe("42");
  });
});

// ─── text format ─────────────────────────────────────────────────────────────

describe("text format", () => {
  it("maps raw string to reasoning only", () => {
    const v = view("This market will resolve YES because of economic factors.");
    expect(v.format).toBe("text");
    expect(v.reasoning).toContain("economic factors");
    expect(v.estimate).toBeNull();
    expect(v.sources).toHaveLength(0);
  });

  it("maps non-JSON string to text", () => {
    const v = view("not { valid json");
    expect(v.format).toBe("text");
    expect(v.reasoning).toContain("not { valid json");
  });
});

// ─── unknown format ───────────────────────────────────────────────────────────

describe("unknown format", () => {
  it("schemaVersion 3 → unknown", () => {
    const v = view({ schemaVersion: 3, someField: "data" });
    expect(v.format).toBe("unknown");
    expect(v.issues).toContain("Unrecognized trace format");
    expect(v.estimate).toBeNull();
  });

  it("lists unknown fields but exposes no numbers to callers", () => {
    const v = view({ schemaVersion: 3, probability: 0.9 });
    expect(v.format).toBe("unknown");
    expect(v.estimate).toBeNull();
    expect(v.unknownFields).toContain("probability");
  });
});

// ─── Prototype pollution ──────────────────────────────────────────────────────

describe("prototype pollution protection", () => {
  it("ignores __proto__ keys", () => {
    // JSON.parse with __proto__ creates a tainted object in some engines.
    const raw = '{"schemaVersion":1,"kind":"oracledesk.trace","__proto__":{"polluted":true}}';
    const parsed = JSON.parse(raw);
    const v = view(parsed);
    // Should not throw and should not expose polluted keys
    expect((({}) as unknown as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(v.format).toBe("backend-v1");
  });
});

// ─── Fixture integrity: formats detected correctly ────────────────────────────

describe("fixture format detection", () => {
  it("detects backend-v1 fixture", async () => {
    const fixture = await import("./fixtures/traces/backend-v1.json");
    expect(view(fixture.default ?? fixture).format).toBe("backend-v1");
  });

  it("detects agents-v2-buy fixture", async () => {
    const fixture = await import("./fixtures/traces/agents-v2-buy.json");
    expect(view(fixture.default ?? fixture).format).toBe("agents-v2");
  });

  it("detects agents-v1-trade fixture", async () => {
    const fixture = await import("./fixtures/traces/agents-v1-trade.json");
    expect(view(fixture.default ?? fixture).format).toBe("agents-v1");
  });
});
