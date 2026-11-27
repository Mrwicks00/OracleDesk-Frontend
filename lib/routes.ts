import type { Route } from "next";
import {
  type Brand,
  parseAccount,
  parseRecordId,
  parseTxHash,
  parseU64,
} from "./validation/ids";

/**
 * Typed route builder and query-parameter contracts (issue #261).
 *
 * - Distinct branded ID types prevent mixing backend market ids, on-chain
 *   market ids (u64), trace ids, on-chain trace ids, agent addresses, and tx
 *   hashes at compile time.
 * - `ROUTE_CONTRACTS` is the single source of truth for declared query params,
 *   verified in CI by `scripts/check-route-params.mjs`.
 * - Receiving-side parsers validate `searchParams` and return `{ ok: true, ... }`
 *   or `{ ok: false, invalid: [...] }` so pages never trust raw strings.
 */

export type BackendMarketId = Brand<string, "BackendMarketId">;
export type OnChainMarketId = Brand<string, "OnChainMarketId">;
export type TraceId = Brand<string, "TraceId">;
export type OnChainTraceId = Brand<string, "OnChainTraceId">;
export type AgentAddress = Brand<string, "AgentAddress">;
export type TxHash = Brand<string, "TxHash">;
/** Demo-only identifier used by legacy static demo pages (e.g. 9204, MKT-9204, TRD-7724). */
export type DemoId = Brand<string, "DemoId">;

export type QuickViewSide = "YES" | "NO";
export type QuickViewFrom = "markets" | "push";
export type FpmmSide = "Yes" | "No";

export interface SearchParamsLike {
  get(name: string): string | null;
}

export type ParseResult<T> =
  | ({ ok: true } & T)
  | { ok: false; invalid: string[] };

// ── Branded ID Parsers ──────────────────────────────────────────────────────

export function parseBackendMarketId(value: unknown): BackendMarketId | null {
  const id = parseRecordId(value);
  return id ? (id as string as BackendMarketId) : null;
}

export function parseOnChainMarketId(value: unknown): OnChainMarketId | null {
  if (typeof value === "bigint") {
    if (value < 0n || value > 2n ** 64n - 1n) return null;
    return value.toString() as OnChainMarketId;
  }
  const id = parseU64(value);
  return id ? (id as string as OnChainMarketId) : null;
}

export function parseTraceId(value: unknown): TraceId | null {
  const id = parseRecordId(value);
  return id ? (id as string as TraceId) : null;
}

export function parseOnChainTraceId(value: unknown): OnChainTraceId | null {
  if (typeof value === "bigint") {
    if (value < 0n || value > 2n ** 64n - 1n) return null;
    return value.toString() as OnChainTraceId;
  }
  const id = parseU64(value);
  return id ? (id as string as OnChainTraceId) : null;
}

export function parseAgentAddress(value: unknown): AgentAddress | null {
  const addr = parseAccount(value);
  return addr ? (addr as string as AgentAddress) : null;
}

export function parseRouteTxHash(value: unknown): TxHash | null {
  const hash = parseTxHash(value);
  return hash ? (hash as string as TxHash) : null;
}

/** Wraps a known hardcoded demo id so demo links can still use the typed builder. */
export function asDemoId(id: "9204" | "MKT-9204" | "TRD-7724"): DemoId {
  return id as DemoId;
}

// ── Route Contracts ─────────────────────────────────────────────────────────

export const ROUTE_CONTRACTS = {
  "/": [] as const,
  "/markets": [] as const,
  "/markets/quick-view": ["marketId", "onChainId", "from", "side"] as const,
  "/markets/terminal": [] as const,
  "/market": ["onChainId", "id"] as const,
  "/market/[id]/trades": [] as const,
  "/market/[id]/trace-history": [] as const,
  "/copy-trade": ["traceId", "marketId"] as const,
  "/learn/fpmm": ["market", "side", "amount", "slippage"] as const,
  "/premium": [] as const,
  "/premium/trace": ["traceId"] as const,
  "/reasoning": [] as const,
  "/reasoning/detail": ["traceId", "onChainTraceId"] as const,
  "/reasoning/verify": ["traceId", "onChainTraceId", "marketId", "onChainMarketId"] as const,
  "/tx": ["hash"] as const,
  "/agent/[address]": [] as const,
  "/portfolio": [] as const,
  "/portfolio/analytics": [] as const,
  "/portfolio/wallets": [] as const,
  "/notifications": [] as const,
  "/settings": [] as const,
  "/stats": [] as const,
  "/privacy": [] as const,
  "/offline": [] as const,
  "/admin": [] as const,
  "/admin/agents": [] as const,
  "/admin/contracts": [] as const,
  "/admin/create": [] as const,
  "/admin/reconciliation": [] as const,
  "/admin/roles": [] as const,
  "/admin/treasury": [] as const,
  "/dev/gallery": [] as const,
  "/dev/virtual-fixture": [] as const,
} as const;

export type StaticRoutePath = keyof typeof ROUTE_CONTRACTS;

// ── Query String Helper ─────────────────────────────────────────────────────

function withQuery(
  path: string,
  params: Record<string, string | number | undefined | null>,
): Route {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number] =>
      entry[1] !== undefined && entry[1] !== null && entry[1] !== "",
  );
  if (entries.length === 0) return path as Route;
  const qs = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${path}?${qs}` as Route;
}

// ── Typed Route Builders ────────────────────────────────────────────────────

export interface QuickViewParams {
  marketId?: BackendMarketId;
  onChainId?: OnChainMarketId;
  from?: QuickViewFrom;
  side?: QuickViewSide;
}

export interface MarketPageParams {
  onChainId?: OnChainMarketId;
}

export interface CopyTradeParams {
  traceId?: TraceId | DemoId;
  marketId?: BackendMarketId | DemoId;
}

export interface VerifyTraceParams {
  traceId?: TraceId;
  onChainTraceId?: OnChainTraceId;
  marketId?: BackendMarketId;
  onChainMarketId?: OnChainMarketId;
}

export interface ReasoningDetailParams {
  traceId?: TraceId;
  onChainTraceId?: OnChainTraceId;
}

export interface FpmmParams {
  market?: OnChainMarketId;
  side?: FpmmSide;
  amount?: string;
  slippage?: number;
}

export const routes = {
  home: (): Route => "/" as Route,
  markets: (): Route => "/markets" as Route,
  marketsTerminal: (): Route => "/markets/terminal" as Route,
  marketsQuickView: (params: QuickViewParams = {}): Route =>
    withQuery("/markets/quick-view", {
      marketId: params.marketId,
      onChainId: params.onChainId,
      from: params.from,
      side: params.side,
    }),
  market: (params: MarketPageParams = {}): Route =>
    withQuery("/market", { onChainId: params.onChainId }),
  marketTrades: (id: BackendMarketId | OnChainMarketId | DemoId): Route =>
    `/market/${encodeURIComponent(id)}/trades` as Route,
  marketTraceHistory: (id: BackendMarketId | OnChainMarketId | DemoId): Route =>
    `/market/${encodeURIComponent(id)}/trace-history` as Route,
  copyTrade: (params: CopyTradeParams = {}): Route =>
    withQuery("/copy-trade", {
      traceId: params.traceId,
      marketId: params.marketId,
    }),
  learnFpmm: (params: FpmmParams = {}): Route =>
    withQuery("/learn/fpmm", {
      market: params.market,
      side: params.side,
      amount: params.amount,
      slippage: params.slippage,
    }),
  premium: (): Route => "/premium" as Route,
  premiumTrace: (traceId?: TraceId): Route =>
    withQuery("/premium/trace", { traceId }),
  reasoning: (): Route => "/reasoning" as Route,
  reasoningDetail: (params: ReasoningDetailParams = {}): Route =>
    withQuery("/reasoning/detail", {
      traceId: params.traceId,
      onChainTraceId: params.onChainTraceId,
    }),
  reasoningVerify: (params: VerifyTraceParams = {}): Route =>
    withQuery("/reasoning/verify", {
      traceId: params.traceId,
      onChainTraceId: params.onChainTraceId,
      marketId: params.marketId,
      onChainMarketId: params.onChainMarketId,
    }),
  tx: (hash?: TxHash): Route => withQuery("/tx", { hash }),
  agent: (address: AgentAddress | BackendMarketId): Route =>
    `/agent/${encodeURIComponent(address)}` as Route,
  portfolio: (): Route => "/portfolio" as Route,
  portfolioAnalytics: (): Route => "/portfolio/analytics" as Route,
  portfolioWallets: (): Route => "/portfolio/wallets" as Route,
  notifications: (): Route => "/notifications" as Route,
  settings: (): Route => "/settings" as Route,
  stats: (): Route => "/stats" as Route,
  glossary: (): Route => "/help/glossary" as Route,
  privacy: (): Route => "/privacy" as Route,
  offline: (): Route => "/offline" as Route,
  admin: (): Route => "/admin" as Route,
  adminAgents: (): Route => "/admin/agents" as Route,
  adminContracts: (): Route => "/admin/contracts" as Route,
  adminCreate: (): Route => "/admin/create" as Route,
  adminReconciliation: (): Route => "/admin/reconciliation" as Route,
  adminRoles: (): Route => "/admin/roles" as Route,
  adminTreasury: (): Route => "/admin/treasury" as Route,
  devGallery: (): Route => "/dev/gallery" as Route,
  devVirtualFixture: (): Route => "/dev/virtual-fixture" as Route,
} as const;

// ── Receiving-side Query-Parameter Parsers ──────────────────────────────────

export interface ParsedQuickViewParams {
  marketId: BackendMarketId | null;
  onChainId: OnChainMarketId | null;
  from: QuickViewFrom | null;
  side: QuickViewSide | null;
}

export function parseQuickViewParams(sp: SearchParamsLike): ParseResult<ParsedQuickViewParams> {
  const invalid: string[] = [];

  const rawMarketId = sp.get("marketId");
  const marketId = rawMarketId ? parseBackendMarketId(rawMarketId) : null;
  if (rawMarketId && !marketId) invalid.push("marketId");

  const rawOnChainId = sp.get("onChainId");
  const onChainId = rawOnChainId ? parseOnChainMarketId(rawOnChainId) : null;
  if (rawOnChainId && !onChainId) invalid.push("onChainId");

  const rawFrom = sp.get("from");
  let from: QuickViewFrom | null = null;
  if (rawFrom) {
    if (rawFrom === "markets" || rawFrom === "push") from = rawFrom;
    else invalid.push("from");
  }

  const rawSide = sp.get("side");
  let side: QuickViewSide | null = null;
  if (rawSide) {
    const upper = rawSide.toUpperCase();
    if (upper === "YES" || upper === "NO") side = upper;
    else invalid.push("side");
  }

  if (invalid.length > 0) return { ok: false, invalid };
  return { ok: true, marketId, onChainId, from, side };
}

export interface ParsedMarketPageParams {
  onChainId: OnChainMarketId | null;
}

export function parseMarketPageParams(sp: SearchParamsLike): ParseResult<ParsedMarketPageParams> {
  const invalid: string[] = [];
  const rawOnChainId = sp.get("onChainId") ?? sp.get("id");
  const onChainId = rawOnChainId ? parseOnChainMarketId(rawOnChainId) : null;
  if (rawOnChainId && !onChainId) invalid.push(sp.get("onChainId") ? "onChainId" : "id");
  if (invalid.length > 0) return { ok: false, invalid };
  return { ok: true, onChainId };
}

export interface ParsedCopyTradeParams {
  traceId: TraceId | null;
  marketId: BackendMarketId | null;
}

export function parseCopyTradeParams(sp: SearchParamsLike): ParseResult<ParsedCopyTradeParams> {
  const invalid: string[] = [];
  const rawTraceId = sp.get("traceId");
  const traceId = rawTraceId ? parseTraceId(rawTraceId) : null;
  if (rawTraceId && !traceId) invalid.push("traceId");

  const rawMarketId = sp.get("marketId");
  const marketId = rawMarketId ? parseBackendMarketId(rawMarketId) : null;
  if (rawMarketId && !marketId) invalid.push("marketId");

  if (invalid.length > 0) return { ok: false, invalid };
  return { ok: true, traceId, marketId };
}

export interface ParsedVerifyTraceParams {
  traceId: TraceId | null;
  onChainTraceId: OnChainTraceId | null;
  marketId: BackendMarketId | null;
  onChainMarketId: OnChainMarketId | null;
}

export function parseVerifyTraceParams(sp: SearchParamsLike): ParseResult<ParsedVerifyTraceParams> {
  const invalid: string[] = [];
  const rawTraceId = sp.get("traceId");
  const traceId = rawTraceId ? parseTraceId(rawTraceId) : null;
  if (rawTraceId && !traceId) invalid.push("traceId");

  const rawOnChainTraceId = sp.get("onChainTraceId");
  const onChainTraceId = rawOnChainTraceId ? parseOnChainTraceId(rawOnChainTraceId) : null;
  if (rawOnChainTraceId && !onChainTraceId) invalid.push("onChainTraceId");

  const rawMarketId = sp.get("marketId");
  const marketId = rawMarketId ? parseBackendMarketId(rawMarketId) : null;
  if (rawMarketId && !marketId) invalid.push("marketId");

  const rawOnChainMarketId = sp.get("onChainMarketId");
  const onChainMarketId = rawOnChainMarketId ? parseOnChainMarketId(rawOnChainMarketId) : null;
  if (rawOnChainMarketId && !onChainMarketId) invalid.push("onChainMarketId");

  if (invalid.length > 0) return { ok: false, invalid };
  return { ok: true, traceId, onChainTraceId, marketId, onChainMarketId };
}

export interface ParsedReasoningDetailParams {
  traceId: TraceId | null;
  onChainTraceId: OnChainTraceId | null;
}

export function parseReasoningDetailParams(
  sp: SearchParamsLike,
): ParseResult<ParsedReasoningDetailParams> {
  const invalid: string[] = [];
  const rawTraceId = sp.get("traceId");
  const traceId = rawTraceId ? parseTraceId(rawTraceId) : null;
  if (rawTraceId && !traceId) invalid.push("traceId");

  const rawOnChainTraceId = sp.get("onChainTraceId");
  const onChainTraceId = rawOnChainTraceId ? parseOnChainTraceId(rawOnChainTraceId) : null;
  if (rawOnChainTraceId && !onChainTraceId) invalid.push("onChainTraceId");

  if (invalid.length > 0) return { ok: false, invalid };
  return { ok: true, traceId, onChainTraceId };
}

export interface ParsedPremiumTraceParams {
  traceId: TraceId | null;
}

export function parsePremiumTraceParams(
  sp: SearchParamsLike,
): ParseResult<ParsedPremiumTraceParams> {
  const rawTraceId = sp.get("traceId");
  const traceId = rawTraceId ? parseTraceId(rawTraceId) : null;
  if (rawTraceId && !traceId) return { ok: false, invalid: ["traceId"] };
  return { ok: true, traceId };
}

export interface ParsedTxParams {
  hash: TxHash | null;
}

export function parseTxParams(sp: SearchParamsLike): ParseResult<ParsedTxParams> {
  const rawHash = sp.get("hash")?.trim() ?? "";
  if (!rawHash) return { ok: true, hash: null };
  const hash = parseRouteTxHash(rawHash);
  if (!hash) return { ok: false, invalid: ["hash"] };
  return { ok: true, hash };
}

export interface ParsedFpmmParams {
  market: OnChainMarketId | null;
  side: FpmmSide | null;
  amount: string | null;
  slippage: number | null;
}

export function parseFpmmParams(sp: SearchParamsLike): ParseResult<ParsedFpmmParams> {
  const invalid: string[] = [];

  const rawMarket = sp.get("market");
  const market = rawMarket ? parseOnChainMarketId(rawMarket) : null;
  if (rawMarket && !market) invalid.push("market");

  const rawSide = sp.get("side");
  let side: FpmmSide | null = null;
  if (rawSide) {
    if (rawSide === "Yes" || rawSide === "No") side = rawSide;
    else if (rawSide.toUpperCase() === "YES") side = "Yes";
    else if (rawSide.toUpperCase() === "NO") side = "No";
    else invalid.push("side");
  }

  const rawAmount = sp.get("amount");
  let amount: string | null = null;
  if (rawAmount) {
    if (/^\d{1,30}$/.test(rawAmount)) amount = rawAmount;
    else invalid.push("amount");
  }

  const rawSlippage = sp.get("slippage");
  let slippage: number | null = null;
  if (rawSlippage) {
    const parsed = Number(rawSlippage);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 10000) slippage = parsed;
    else invalid.push("slippage");
  }

  if (invalid.length > 0) return { ok: false, invalid };
  return { ok: true, market, side, amount, slippage };
}
