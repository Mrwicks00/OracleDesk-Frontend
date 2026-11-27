import { describe, expect, it } from "vitest";
import type { ChainEvent } from "../events";
import type { TradeEvent as SocketTradeEvent } from "../../realtime/types";
import {
  ACTIVITY_WINDOW_SECONDS,
  MarketEventCache,
  aggregateMarketActivity,
  chainEventToActivityTrade,
  socketEventToActivityTrade,
} from "../market-activity";

const TRADER_A = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const TRADER_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const NOW = 1_700_100_000;

function makeChainTrade(
  id: string,
  tsSec: number,
  trader: string,
  isBuy: boolean,
  collateral: bigint,
  fee: bigint,
  marketId = 1n,
): ChainEvent {
  return {
    id,
    ledger: 100,
    closedAt: new Date(tsSec * 1000).toISOString(),
    txHash: "a".repeat(64),
    name: "Trade",
    data: {
      market_id: marketId,
      trader,
      is_buy: isBuy,
      collateral,
      fee,
    },
  };
}

function makeSocketTrade(
  eventId: string,
  tsSec: number,
  trader: string,
  collateralRaw: string,
  feeRaw: string,
): SocketTradeEvent {
  return {
    eventId,
    onChainMarketId: "1",
    trader,
    direction: "YES",
    isBuy: true,
    collateralRaw,
    sharesRaw: "10000000",
    feeRaw,
    priceYesBps: 5000,
    txHash: "a".repeat(64),
    ledger: 100,
    marketQuestion: null,
    closedAt: new Date(tsSec * 1000).toISOString(),
  };
}

describe("aggregateMarketActivity", () => {
  it("returns zeros for empty trades", () => {
    const res = aggregateMarketActivity([], { nowSec: NOW });
    expect(res).toMatchObject({
      status: "ready",
      volume24h: 0n,
      fees24h: 0n,
      uniqueTraders: 0,
      tradeCount: 0,
      partial: false,
    });
  });

  it("sums buys and sells, fees with >2^53 bigint values, and unique traders", () => {
    const bigCollateral = 9_007_199_254_740_993n; // > Number.MAX_SAFE_INTEGER
    const bigFee = 9_007_199_254_740_995n;
    const events = [
      makeChainTrade("ev-1", NOW - 100, TRADER_A, true, bigCollateral, bigFee),
      makeChainTrade("ev-2", NOW - 50, TRADER_A, false, 10_000_000n, 30_000n),
      makeChainTrade("ev-3", NOW - 10, TRADER_B, true, 25_000_000n, 75_000n),
    ].map((e) => chainEventToActivityTrade(e)!);

    const res = aggregateMarketActivity(events, { nowSec: NOW });
    expect(res.volume24h).toBe(bigCollateral + 10_000_000n + 25_000_000n);
    expect(res.fees24h).toBe(bigFee + 30_000n + 75_000n);
    expect(res.uniqueTraders).toBe(2);
    expect(res.tradeCount).toBe(3);
  });

  it("enforces exact 24h window edges", () => {
    const atBoundary = makeChainTrade("ev-edge", NOW - ACTIVITY_WINDOW_SECONDS, TRADER_A, true, 100n, 1n);
    const tooOld = makeChainTrade("ev-old", NOW - ACTIVITY_WINDOW_SECONDS - 1, TRADER_B, true, 999n, 9n);
    const records = [atBoundary, tooOld].map((e) => chainEventToActivityTrade(e)!);

    const res = aggregateMarketActivity(records, { nowSec: NOW });
    expect(res.volume24h).toBe(100n);
    expect(res.fees24h).toBe(1n);
    expect(res.tradeCount).toBe(1);
    expect(res.uniqueTraders).toBe(1);
  });

  it("reports truncated/partial windows explicitly and handles unavailable state", () => {
    const ev = chainEventToActivityTrade(makeChainTrade("ev-1", NOW - 3600, TRADER_A, true, 500n, 5n))!;
    const partial = aggregateMarketActivity([ev], {
      nowSec: NOW,
      truncated: true,
      oldestAvailableSec: NOW - 6 * 3600,
    });
    expect(partial.partial).toBe(true);
    expect(partial.coveredHours).toBe(6);

    const unavailable = aggregateMarketActivity([], { nowSec: NOW, unavailable: true });
    expect(unavailable.status).toBe("unavailable");
  });

  it("excludes FeesSwept events from fees and volume", () => {
    const swept: ChainEvent = {
      id: "sweep-1",
      ledger: 101,
      closedAt: new Date((NOW - 10) * 1000).toISOString(),
      txHash: "b".repeat(64),
      name: "FeesSwept",
      data: { market_id: 1n, recipient: TRADER_A, amount: 50_000_000n },
    };
    expect(chainEventToActivityTrade(swept)).toBeNull();
  });

  it("de-duplicates socket + chain events (chain wins) and handles out-of-order input", () => {
    const sock = socketEventToActivityTrade(makeSocketTrade("ev-1", NOW - 20, TRADER_A, "100", "2"))!;
    const chain = chainEventToActivityTrade(makeChainTrade("ev-1", NOW - 20, TRADER_A, true, 150n, 3n))!;
    const outOfOrder = chainEventToActivityTrade(makeChainTrade("ev-0", NOW - 200, TRADER_B, true, 50n, 1n))!;

    const res = aggregateMarketActivity([sock, chain, outOfOrder], { nowSec: NOW });
    expect(res.volume24h).toBe(200n);
    expect(res.fees24h).toBe(4n);
    expect(res.tradeCount).toBe(2);
  });
});

describe("MarketEventCache", () => {
  it("bounds cached markets, caps events per market, and expires old events", () => {
    const cache = new MarketEventCache(2, 2);
    cache.ingestChainEvents("1", [
      makeChainTrade("a", NOW - 100, TRADER_A, true, 10n, 1n, 1n),
      makeChainTrade("b", NOW - 50, TRADER_A, true, 20n, 2n, 1n),
      makeChainTrade("c", NOW - 10, TRADER_A, true, 30n, 3n, 1n),
    ], { nowSec: NOW });
    // Cap of 2 events per market keeps the 2 newest
    expect(cache.getActivity("1", NOW)?.volume24h).toBe(50n);

    cache.ingestChainEvents("2", [makeChainTrade("d", NOW - 10, TRADER_B, true, 40n, 4n, 2n)], { nowSec: NOW });
    cache.ingestChainEvents("3", [makeChainTrade("e", NOW - 10, TRADER_B, true, 50n, 5n, 3n)], { nowSec: NOW });
    // Max 2 markets: market "1" evicted
    expect(cache.size()).toBe(2);
    expect(cache.getActivity("1", NOW)).toBeNull();

    // Advance past 24h: old events expire
    expect(cache.getActivity("3", NOW + ACTIVITY_WINDOW_SECONDS + 100)?.tradeCount).toBe(0);
  });
});
