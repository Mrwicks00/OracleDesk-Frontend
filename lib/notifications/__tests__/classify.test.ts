import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { classifyTrade, classifyTrace, classifyResolved, classifyRedeemed, classifyDeadline, classifyStorageExpiring } from "../classify";
import { RESOLUTION_GRACE_SECS } from "@/lib/stellar/resolution-deadline";
import { isTradeEvent, type TradeEvent } from "@/lib/realtime/types";
import { socketTrade } from "@/lib/hooks/useMarketTrades";

const owner = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const other = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
const payload: TradeEvent = { eventId: "event-1", onChainMarketId: "7", trader: owner, direction: "YES", isBuy: true,
  collateralRaw: "10000000", sharesRaw: "15873015", feeRaw: "200000", priceYesBps: 5000, txHash: "a".repeat(64), ledger: 100, marketQuestion: null };
const event = { id: "id", name: "MarketResolved", ledger: 100, closedAt: "2026-10-18T12:00:00Z", txHash: "b".repeat(64), data: { market_id: 7n, outcome: undefined } };
describe("wallet-only classification", () => {
  it("ignores other traders and preserves deterministic ids", () => {
    expect(classifyTrade(payload, other)).toBeNull();
    expect(classifyTrade(payload, owner)?.id).toBe(classifyTrade(payload, owner)?.id);
    expect(socketTrade(payload, "other")).toBeNull();
  });
  it.each(["-1", "1.5", "NaN", "1e7", "", "0x10"])("rejects malformed raw collateral %s", collateralRaw => {
    expect(classifyTrade({ ...payload, collateralRaw }, owner)).toBeNull();
  });
  it("validates all socket fields before bigint conversion", () => {
    expect(isTradeEvent({ ...payload, sharesRaw: null })).toBe(false);
    expect(isTradeEvent({ ...payload, txHash: "not-a-hash" })).toBe(false);
    expect(isTradeEvent({ ...payload, ledger: NaN })).toBe(false);
    expect(isTradeEvent(payload)).toBe(true);
  });
  it("publishes reasoning only for a held market", () => {
    const trace = { onChainTraceId: "1", onChainMarketId: "7", agent: owner, action: "buy", traceId: null, ledger: 100, txHash: "a".repeat(64) };
    expect(classifyTrace(trace, new Set(), owner)).toBeNull();
    expect(classifyTrace(trace, new Set(["7"]), owner)?.kind).toBe("trace");
  });
  it("void is redeemable when shares remain, including a losing-side payout of zero", () => {
    expect(classifyResolved(event, owner, { yes: 1n, no: 0n })).toMatchObject({ kind: "redeemable", data: { outcome: "Void" } });
    expect(classifyResolved(event, owner, { yes: 0n, no: 0n })).toBeNull();
  });
  it("redemption belongs only to its holder", () => {
    const redeemed = { ...event, name: "Redeemed", data: { market_id: 7n, holder: owner, payout: 0n } };
    expect(classifyRedeemed(redeemed, other)).toBeNull();
    expect(classifyRedeemed(redeemed, owner)?.data.payoutRaw).toBe("0");
  });
  it("emits deduplicated deadline-near and deadline-passed items for held open markets", () => {
    const closeTime = 1_000_000n;
    const deadline = closeTime + RESOLUTION_GRACE_SECS;
    const nearItem = classifyDeadline("7", closeTime, deadline - 100n, owner, { yes: 10n, no: 0n });
    expect(nearItem).toMatchObject({ kind: "deadline-near", id: "deadline:deadline-near:7", marketId: "7" });
    const passedItem = classifyDeadline("7", closeTime, deadline + 10n, owner, { yes: 10n, no: 0n });
    expect(passedItem).toMatchObject({ kind: "deadline-passed", id: "deadline:deadline-passed:7", marketId: "7" });
    expect(classifyDeadline("7", closeTime, deadline + 10n, owner, { yes: 0n, no: 0n })).toBeNull();
  });
  it("emits deduplicated storage-expiring notifications per threshold", () => {
    const item30 = classifyStorageExpiring("7", "position", 25, 30, owner, 1000);
    expect(item30).toMatchObject({
      kind: "storage-expiring",
      id: "storage-expiring:30:7",
      marketId: "7",
      data: {
        entryKind: "position",
        ttlDays: "25",
        thresholdDays: "30",
      },
    });

    const item7 = classifyStorageExpiring("7", "market", 5, 7, owner, 1000);
    expect(item7).toMatchObject({
      kind: "storage-expiring",
      id: "storage-expiring:7:7",
      marketId: "7",
    });
  });
});
