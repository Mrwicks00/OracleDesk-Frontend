import type { ChainEvent } from "./events";
import type { TradeEvent as SocketTradeEvent } from "../realtime/types";

/**
 * Pure, exact 24h market activity aggregation over `Trade` events (issue #260).
 *
 * Metric definitions:
 * - `volume24h`: Sum of gross `collateral` (bigint, 7-decimal USDC base units)
 *   across all `Trade` events (buys + sells) within `[nowSec - 86400, nowSec]`.
 * - `fees24h`: Sum of `fee` (bigint, 7-decimal USDC base units) across all
 *   `Trade` events within `[nowSec - 86400, nowSec]`. `FeesSwept` events are
 *   NOT fees earned and are excluded.
 * - `uniqueTraders`: Count of distinct `trader` addresses in the 24h window.
 * - `tradeCount`: Number of `Trade` events in the 24h window.
 *
 * `fees_accrued` on the `Market` struct is cumulative since market creation
 * (lifetime), not 24h, and must be labelled as lifetime if displayed.
 */

export const ACTIVITY_WINDOW_SECONDS = 86_400;
export const MAX_EVENTS_PER_MARKET = 1_000;
export const MAX_CACHED_MARKETS = 64;

export interface ActivityTradeRecord {
  /** Stable identity: Soroban event id, or `txHash:index` fallback. */
  id: string;
  txHash: string;
  marketId: string;
  trader: string;
  isBuy: boolean;
  collateral: bigint;
  fee: bigint;
  /** Unix timestamp in seconds (from ledgerClosedAt or socket closedAt/receivedAt). */
  timestampSec: number;
  ledger: number;
  source: "chain" | "socket";
}

export interface MarketActivity24h {
  status: "ready" | "unavailable";
  volume24h: bigint;
  fees24h: bigint;
  uniqueTraders: number;
  tradeCount: number;
  /** True when RPC retention or page limits truncated the 24h window. */
  partial: boolean;
  /** Approximate hours covered when `partial` is true; null if unknown. */
  coveredHours: number | null;
  windowStartSec: number;
  windowEndSec: number;
}

export function eventIdentity(ev: Pick<ChainEvent, "id" | "txHash">): string {
  return ev.id || `${ev.txHash}:0`;
}

export function parseTimestampSec(isoOrMs: string | number | undefined): number | null {
  if (typeof isoOrMs === "number") {
    if (!Number.isFinite(isoOrMs) || isoOrMs <= 0) return null;
    return isoOrMs > 1e12 ? Math.floor(isoOrMs / 1000) : Math.floor(isoOrMs);
  }
  if (typeof isoOrMs === "string" && isoOrMs.length > 0) {
    const ms = Date.parse(isoOrMs);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  return null;
}

/** Converts a decoded `ChainEvent` into an `ActivityTradeRecord` if it is a `Trade`. */
export function chainEventToActivityTrade(ev: ChainEvent): ActivityTradeRecord | null {
  if (ev.name !== "Trade") return null;
  const d = ev.data;
  if (
    typeof d.market_id !== "bigint" ||
    typeof d.trader !== "string" ||
    typeof d.is_buy !== "boolean" ||
    typeof d.collateral !== "bigint" ||
    typeof d.fee !== "bigint" ||
    d.collateral < 0n ||
    d.fee < 0n
  ) {
    return null;
  }
  const ts = parseTimestampSec(ev.closedAt);
  if (ts === null) return null;
  return {
    id: eventIdentity(ev),
    txHash: ev.txHash,
    marketId: d.market_id.toString(),
    trader: d.trader,
    isBuy: d.is_buy,
    collateral: d.collateral,
    fee: d.fee,
    timestampSec: ts,
    ledger: ev.ledger,
    source: "chain",
  };
}

/** Converts a validated socket `TradeEvent` into a provisional `ActivityTradeRecord`. */
export function socketEventToActivityTrade(
  ev: SocketTradeEvent,
  receivedAtMs: number = Date.now(),
): ActivityTradeRecord | null {
  const ts = parseTimestampSec(ev.closedAt) ?? parseTimestampSec(receivedAtMs);
  if (ts === null) return null;
  try {
    const collateral = BigInt(ev.collateralRaw);
    const fee = BigInt(ev.feeRaw);
    if (collateral < 0n || fee < 0n) return null;
    return {
      id: ev.eventId || `${ev.txHash}:0`,
      txHash: ev.txHash,
      marketId: ev.onChainMarketId,
      trader: ev.trader,
      isBuy: ev.isBuy,
      collateral,
      fee,
      timestampSec: ts,
      ledger: ev.ledger,
      source: "socket",
    };
  } catch {
    return null;
  }
}

/**
 * De-duplicates trade records by `id` (chain wins over socket) and filters to
 * `[windowStartSec, nowSec]`.
 */
export function deduplicateTrades(records: readonly ActivityTradeRecord[]): ActivityTradeRecord[] {
  const byId = new Map<string, ActivityTradeRecord>();
  for (const rec of records) {
    const existing = byId.get(rec.id);
    if (!existing || (existing.source === "socket" && rec.source === "chain")) {
      byId.set(rec.id, rec);
    }
  }
  return [...byId.values()].sort(
    (a, b) => a.timestampSec - b.timestampSec || a.ledger - b.ledger || a.id.localeCompare(b.id),
  );
}

export interface AggregateOptions {
  nowSec: number;
  /** Oldest timestamp available from the RPC retention window, if known. */
  oldestAvailableSec?: number | null;
  /** True if the RPC response hit its page limit or retention boundary. */
  truncated?: boolean;
  /** True if the RPC read failed and no reliable data is available. */
  unavailable?: boolean;
}

/**
 * Pure bigint aggregation of 24h volume, fees, unique traders, and trade count.
 * Uses event timestamps (not ledger-count arithmetic) for the 24h window.
 */
export function aggregateMarketActivity(
  records: readonly ActivityTradeRecord[],
  opts: AggregateOptions,
): MarketActivity24h {
  const windowEndSec = Math.floor(opts.nowSec);
  const windowStartSec = windowEndSec - ACTIVITY_WINDOW_SECONDS;

  if (opts.unavailable) {
    return {
      status: "unavailable",
      volume24h: 0n,
      fees24h: 0n,
      uniqueTraders: 0,
      tradeCount: 0,
      partial: false,
      coveredHours: null,
      windowStartSec,
      windowEndSec,
    };
  }

  const deduped = deduplicateTrades(records);
  let volume24h = 0n;
  let fees24h = 0n;
  let tradeCount = 0;
  const traders = new Set<string>();

  for (const rec of deduped) {
    if (rec.timestampSec < windowStartSec || rec.timestampSec > windowEndSec) continue;
    volume24h += rec.collateral;
    fees24h += rec.fee;
    traders.add(rec.trader);
    tradeCount++;
  }

  const oldest = opts.oldestAvailableSec ?? null;
  const retentionTruncated = oldest !== null && oldest > windowStartSec;
  const partial = Boolean(opts.truncated || retentionTruncated);
  let coveredHours: number | null = null;
  if (partial && oldest !== null) {
    coveredHours = Math.max(0, Math.min(24, Math.floor((windowEndSec - oldest) / 3600)));
  }

  return {
    status: "ready",
    volume24h,
    fees24h,
    uniqueTraders: traders.size,
    tradeCount,
    partial,
    coveredHours,
    windowStartSec,
    windowEndSec,
  };
}

// ── Shared Bounded Event Cache ──────────────────────────────────────────────

export interface CachedMarketEvents {
  events: Map<string, ChainEvent>;
  trades: Map<string, ActivityTradeRecord>;
  truncated: boolean;
  oldestAvailableSec: number | null;
  updatedAtMs: number;
}

export class MarketEventCache {
  private readonly markets = new Map<string, CachedMarketEvents>();

  constructor(
    private readonly maxMarkets = MAX_CACHED_MARKETS,
    private readonly maxEventsPerMarket = MAX_EVENTS_PER_MARKET,
  ) {}

  private touch(marketId: string, entry: CachedMarketEvents): void {
    this.markets.delete(marketId);
    this.markets.set(marketId, entry);
    if (this.markets.size > this.maxMarkets) {
      const oldestKey = this.markets.keys().next().value;
      if (oldestKey !== undefined) this.markets.delete(oldestKey);
    }
  }

  private getOrCreate(marketId: string, nowMs: number): CachedMarketEvents {
    const existing = this.markets.get(marketId);
    if (existing) {
      this.touch(marketId, existing);
      return existing;
    }
    const created: CachedMarketEvents = {
      events: new Map(),
      trades: new Map(),
      truncated: false,
      oldestAvailableSec: null,
      updatedAtMs: nowMs,
    };
    this.touch(marketId, created);
    return created;
  }

  ingestChainEvents(
    marketId: string,
    chainEvents: readonly ChainEvent[],
    meta: { truncated?: boolean; oldestAvailableSec?: number | null; nowSec?: number } = {},
  ): void {
    const nowMs = (meta.nowSec ?? Math.floor(Date.now() / 1000)) * 1000;
    const entry = this.getOrCreate(marketId, nowMs);

    for (const ev of chainEvents) {
      const id = eventIdentity(ev);
      entry.events.set(id, ev);
      const trade = chainEventToActivityTrade(ev);
      if (trade) {
        entry.trades.set(trade.id, trade);
      }
    }

    if (meta.truncated !== undefined) entry.truncated = meta.truncated;
    if (meta.oldestAvailableSec !== undefined) entry.oldestAvailableSec = meta.oldestAvailableSec;
    entry.updatedAtMs = nowMs;

    this.pruneEntry(entry, meta.nowSec ?? Math.floor(nowMs / 1000));
  }

  ingestSocketTrade(trade: ActivityTradeRecord, nowSec = Math.floor(Date.now() / 1000)): void {
    const entry = this.getOrCreate(trade.marketId, nowSec * 1000);
    const existing = entry.trades.get(trade.id);
    if (!existing || existing.source === "socket") {
      entry.trades.set(trade.id, trade);
    }
    entry.updatedAtMs = nowSec * 1000;
    this.pruneEntry(entry, nowSec);
  }

  private pruneEntry(entry: CachedMarketEvents, nowSec: number): void {
    const cutoff = nowSec - ACTIVITY_WINDOW_SECONDS;
    for (const [id, rec] of entry.trades) {
      if (rec.timestampSec < cutoff) entry.trades.delete(id);
    }
    if (entry.trades.size > this.maxEventsPerMarket) {
      const sorted = [...entry.trades.values()].sort(
        (a, b) => a.timestampSec - b.timestampSec || a.ledger - b.ledger,
      );
      const dropCount = sorted.length - this.maxEventsPerMarket;
      for (let i = 0; i < dropCount; i++) {
        entry.trades.delete(sorted[i].id);
      }
    }
    if (entry.events.size > this.maxEventsPerMarket) {
      const dropCount = entry.events.size - this.maxEventsPerMarket;
      let i = 0;
      for (const key of entry.events.keys()) {
        if (i++ >= dropCount) break;
        entry.events.delete(key);
      }
    }
  }

  getChainEvents(marketId: string): ChainEvent[] {
    const entry = this.markets.get(marketId);
    return entry ? [...entry.events.values()] : [];
  }

  getActivity(marketId: string, nowSec = Math.floor(Date.now() / 1000)): MarketActivity24h | null {
    const entry = this.markets.get(marketId);
    if (!entry) return null;
    this.pruneEntry(entry, nowSec);
    return aggregateMarketActivity([...entry.trades.values()], {
      nowSec,
      truncated: entry.truncated,
      oldestAvailableSec: entry.oldestAvailableSec,
    });
  }

  clear(): void {
    this.markets.clear();
  }

  size(): number {
    return this.markets.size;
  }
}

export const sharedMarketEventCache = new MarketEventCache();
