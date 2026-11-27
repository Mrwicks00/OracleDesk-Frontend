import { describe, expect, it } from "vitest";
import {
  asDemoId,
  parseAgentAddress,
  parseBackendMarketId,
  parseCopyTradeParams,
  parseFpmmParams,
  parseMarketPageParams,
  parseOnChainMarketId,
  parseOnChainTraceId,
  parsePremiumTraceParams,
  parseQuickViewParams,
  parseReasoningDetailParams,
  parseRouteTxHash,
  parseTraceId,
  parseVerifyTraceParams,
  routes,
} from "../routes";

const VALID_UUID = "8c1f0a2b-1111-4222-8333-444455556666";
const VALID_SLUG = "e2e-market-1";
const VALID_HASH = "a".repeat(64);
const VALID_G = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

describe("typed route builders", () => {
  it("builds static routes", () => {
    expect(routes.home()).toBe("/");
    expect(routes.markets()).toBe("/markets");
    expect(routes.marketsTerminal()).toBe("/markets/terminal");
    expect(routes.premium()).toBe("/premium");
    expect(routes.reasoning()).toBe("/reasoning");
    expect(routes.portfolio()).toBe("/portfolio");
    expect(routes.portfolioAnalytics()).toBe("/portfolio/analytics");
    expect(routes.portfolioWallets()).toBe("/portfolio/wallets");
    expect(routes.notifications()).toBe("/notifications");
    expect(routes.settings()).toBe("/settings");
    expect(routes.stats()).toBe("/stats");
    expect(routes.privacy()).toBe("/privacy");
    expect(routes.offline()).toBe("/offline");
    expect(routes.admin()).toBe("/admin");
    expect(routes.adminAgents()).toBe("/admin/agents");
    expect(routes.adminContracts()).toBe("/admin/contracts");
    expect(routes.adminCreate()).toBe("/admin/create");
    expect(routes.adminReconciliation()).toBe("/admin/reconciliation");
    expect(routes.adminRoles()).toBe("/admin/roles");
    expect(routes.adminTreasury()).toBe("/admin/treasury");
  });

  it("builds dynamic and query-parameterized routes", () => {
    const mId = parseBackendMarketId(VALID_UUID)!;
    const cId = parseOnChainMarketId("42")!;
    const tId = parseTraceId(VALID_UUID)!;
    const ctId = parseOnChainTraceId("7")!;
    const hash = parseRouteTxHash(VALID_HASH)!;
    const agent = parseAgentAddress(VALID_G)!;

    expect(routes.marketsQuickView({ marketId: mId, from: "markets", side: "YES" })).toBe(
      `/markets/quick-view?marketId=${VALID_UUID}&from=markets&side=YES`,
    );
    expect(routes.marketsQuickView({ onChainId: cId, from: "push" })).toBe(
      "/markets/quick-view?onChainId=42&from=push",
    );
    expect(routes.market({ onChainId: cId })).toBe("/market?onChainId=42");
    expect(routes.marketTrades(mId)).toBe(`/market/${VALID_UUID}/trades`);
    expect(routes.marketTraceHistory(cId)).toBe("/market/42/trace-history");
    expect(routes.copyTrade({ traceId: tId, marketId: mId })).toBe(
      `/copy-trade?traceId=${VALID_UUID}&marketId=${VALID_UUID}`,
    );
    expect(
      routes.learnFpmm({ market: cId, side: "No", amount: "10000000", slippage: 50 }),
    ).toBe("/learn/fpmm?market=42&side=No&amount=10000000&slippage=50");
    expect(routes.premiumTrace(tId)).toBe(`/premium/trace?traceId=${VALID_UUID}`);
    expect(routes.reasoningDetail({ traceId: tId })).toBe(
      `/reasoning/detail?traceId=${VALID_UUID}`,
    );
    expect(routes.reasoningDetail({ onChainTraceId: ctId })).toBe(
      "/reasoning/detail?onChainTraceId=7",
    );
    expect(
      routes.reasoningVerify({ traceId: tId, onChainTraceId: ctId, marketId: mId, onChainMarketId: cId }),
    ).toBe(
      `/reasoning/verify?traceId=${VALID_UUID}&onChainTraceId=7&marketId=${VALID_UUID}&onChainMarketId=42`,
    );
    expect(routes.tx(hash)).toBe(`/tx?hash=${VALID_HASH}`);
    expect(routes.agent(agent)).toBe(`/agent/${VALID_G}`);
  });

  it("encodes special characters in demo or slug ids", () => {
    const slug = parseBackendMarketId(VALID_SLUG)!;
    expect(routes.marketTrades(slug)).toBe(`/market/${VALID_SLUG}/trades`);
    expect(routes.copyTrade({ traceId: asDemoId("TRD-7724"), marketId: asDemoId("MKT-9204") })).toBe(
      "/copy-trade?traceId=TRD-7724&marketId=MKT-9204",
    );
  });
});

describe("branded id parsers", () => {
  it("parses valid ids and rejects malformed or wrong kinds", () => {
    expect(parseBackendMarketId(VALID_UUID)).toBe(VALID_UUID);
    expect(parseBackendMarketId(VALID_SLUG)).toBe(VALID_SLUG);
    expect(parseBackendMarketId("not valid!")).toBeNull();

    expect(parseOnChainMarketId("0")).toBe("0");
    expect(parseOnChainMarketId(18446744073709551615n)).toBe("18446744073709551615");
    expect(parseOnChainMarketId("-1")).toBeNull();
    expect(parseOnChainMarketId(VALID_UUID)).toBeNull();

    expect(parseTraceId(VALID_UUID)).toBe(VALID_UUID);
    expect(parseOnChainTraceId("12")).toBe("12");
    expect(parseOnChainTraceId("abc")).toBeNull();

    expect(parseRouteTxHash(VALID_HASH.toUpperCase())).toBe(VALID_HASH);
    expect(parseRouteTxHash("short")).toBeNull();

    expect(parseAgentAddress(VALID_G)).toBe(VALID_G);
    expect(parseAgentAddress("bad")).toBeNull();
  });
});

describe("receiving-side searchParams parsers", () => {
  it("parseQuickViewParams handles valid, missing, and invalid values", () => {
    expect(parseQuickViewParams(new URLSearchParams())).toEqual({
      ok: true,
      marketId: null,
      onChainId: null,
      from: null,
      side: null,
    });
    expect(
      parseQuickViewParams(new URLSearchParams(`marketId=${VALID_UUID}&onChainId=9&from=push&side=no`)),
    ).toEqual({
      ok: true,
      marketId: VALID_UUID,
      onChainId: "9",
      from: "push",
      side: "NO",
    });
    expect(
      parseQuickViewParams(new URLSearchParams("marketId=bad!&side=MAYBE&from=evil")),
    ).toEqual({
      ok: false,
      invalid: ["marketId", "from", "side"],
    });
  });

  it("parseMarketPageParams supports onChainId and legacy id", () => {
    expect(parseMarketPageParams(new URLSearchParams("onChainId=15"))).toEqual({
      ok: true,
      onChainId: "15",
    });
    expect(parseMarketPageParams(new URLSearchParams("id=15"))).toEqual({
      ok: true,
      onChainId: "15",
    });
    expect(parseMarketPageParams(new URLSearchParams("onChainId=nope"))).toEqual({
      ok: false,
      invalid: ["onChainId"],
    });
  });

  it("parseCopyTradeParams, parseVerifyTraceParams, parseReasoningDetailParams, parsePremiumTraceParams, parseTxParams, parseFpmmParams", () => {
    expect(parseCopyTradeParams(new URLSearchParams(`traceId=${VALID_UUID}&marketId=${VALID_SLUG}`))).toEqual({
      ok: true,
      traceId: VALID_UUID,
      marketId: VALID_SLUG,
    });
    expect(parseCopyTradeParams(new URLSearchParams("traceId=bad"))).toEqual({
      ok: false,
      invalid: ["traceId"],
    });

    expect(parseVerifyTraceParams(new URLSearchParams("onChainTraceId=5&onChainMarketId=2"))).toEqual({
      ok: true,
      traceId: null,
      onChainTraceId: "5",
      marketId: null,
      onChainMarketId: "2",
    });
    expect(parseVerifyTraceParams(new URLSearchParams("onChainTraceId=xyz"))).toEqual({
      ok: false,
      invalid: ["onChainTraceId"],
    });

    expect(parseReasoningDetailParams(new URLSearchParams("onChainTraceId=3"))).toEqual({
      ok: true,
      traceId: null,
      onChainTraceId: "3",
    });

    expect(parsePremiumTraceParams(new URLSearchParams(`traceId=${VALID_UUID}`))).toEqual({
      ok: true,
      traceId: VALID_UUID,
    });
    expect(parsePremiumTraceParams(new URLSearchParams("traceId=bad!"))).toEqual({
      ok: false,
      invalid: ["traceId"],
    });

    expect(parseTxParams(new URLSearchParams(`hash=${VALID_HASH}`))).toEqual({
      ok: true,
      hash: VALID_HASH,
    });
    expect(parseTxParams(new URLSearchParams("hash=0x123"))).toEqual({
      ok: false,
      invalid: ["hash"],
    });

    expect(parseFpmmParams(new URLSearchParams("market=3&side=No&amount=100&slippage=50"))).toEqual({
      ok: true,
      market: "3",
      side: "No",
      amount: "100",
      slippage: 50,
    });
    expect(parseFpmmParams(new URLSearchParams("slippage=99999"))).toEqual({
      ok: false,
      invalid: ["slippage"],
    });
  });
});
