import { describe, expect, it } from "vitest";
import type { ReasoningTrace } from "@/lib/api/traces";
import { matches, serverParams } from "../feed-filters";
import { parseTraceFilters, serializeTraceFilters } from "../feed-params";
import { parseSavedViews } from "../saved-views";

function trace(overrides: Partial<ReasoningTrace> = {}): ReasoningTrace {
  return {
    id: "t1",
    marketId: "m1",
    agentType: "TRADER",
    decisionType: "buy",
    edge: 0.1,
    probabilityEstimate: 0.6,
    marketProbability: 0.5,
    confidenceInterval: { lower: 0.4, upper: 0.7 },
    verified: false,
    ipfsCid: null,
    previewSources: null,
    market: { question: "Q?", category: "POLITICS", settlementCurrency: "USDC", onChainMarketId: "42" },
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as ReasoningTrace;
}

describe("serverParams", () => {
  it("sends only the server-side filters", () => {
    expect(serverParams({ agentType: "MARKET_MAKER", marketId: "abc", onChain: "yes", held: true })).toEqual({
      agentType: "MARKET_MAKER",
      marketId: "abc",
    });
  });
});

describe("matches", () => {
  it("applies the on-chain predicate both ways", () => {
    expect(matches(trace({ onChainTraceId: "7" }), { onChain: "yes" }, null)).toBe(true);
    expect(matches(trace({ onChainTraceId: null }), { onChain: "yes" }, null)).toBe(false);
    expect(matches(trace({ onChainTraceId: null }), { onChain: "no" }, null)).toBe(true);
  });

  it("matches verification states from the backend flag", () => {
    expect(matches(trace({ verified: true }), { verification: ["verified"] }, null)).toBe(true);
    expect(matches(trace({ verified: false }), { verification: ["verified"] }, null)).toBe(false);
    expect(matches(trace({ verified: false }), { verification: ["unchecked"] }, null)).toBe(true);
  });

  it("keeps only traces on held markets, and ignores held without a wallet", () => {
    const held = new Set(["42"]);
    expect(matches(trace(), { held: true }, held)).toBe(true);
    expect(matches(trace({ market: { question: "x", category: "POLITICS", settlementCurrency: "USDC", onChainMarketId: "9" } }), { held: true }, held)).toBe(false);
    expect(matches(trace({ market: { question: "x", category: "POLITICS", settlementCurrency: "USDC" } }), { held: true }, held)).toBe(false);
    expect(matches(trace(), { held: true }, null)).toBe(true);
  });
});

describe("URL round-trip", () => {
  it("serializes and parses back to the same filters", () => {
    const filters = { agentType: "TRADER" as const, marketId: "abc-1", onChain: "no" as const, verification: ["verified" as const, "unchecked" as const], held: true };
    const query = serializeTraceFilters(filters);
    expect(parseTraceFilters(new URLSearchParams(query))).toEqual(filters);
  });

  it("drops invalid values instead of trusting them", () => {
    const parsed = parseTraceFilters(new URLSearchParams("type=ADMIN&market=../../x&onchain=maybe&v=bogus,verified&held=0"));
    expect(parsed).toEqual({ verification: ["verified"] });
  });
});

describe("parseSavedViews", () => {
  it("drops malformed entries and canonicalises queries", () => {
    const views = parseSavedViews([
      { id: "a", name: " Mine ", query: "onchain=yes&type=TRADER&junk=1", createdAt: 1 },
      { id: "", name: "bad", query: "", createdAt: 2 },
      "not an object",
    ]);
    expect(views).toEqual([{ id: "a", name: "Mine", query: "type=TRADER&onchain=yes", createdAt: 1 }]);
  });
});
