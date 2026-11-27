/**
 * Version-aware trace schema registry for OracleDesk reasoning traces.
 *
 * Supported formats and detection order (first match wins):
 *   1. backend-v1: schemaVersion === 1 && kind === "oracledesk.trace"
 *   2. agents-v2:  schemaVersion === 2 && agent ∈ {"market-maker","trader"}
 *   3. agents-v1:  no schemaVersion, agent ∈ {"market-maker","trader"}, inputs is object
 *   4. text:       non-JSON string or JSON primitive
 *   5. unknown:    anything else (including schemaVersion > 2)
 *
 * No cross-format field fallback. Each handler is strict; unknown fields are
 * reported but never adopted. Prototype pollution is prevented by explicit key
 * iteration with __proto__ / constructor guards.
 *
 * parseTrace() receives already-decoded content and must never be used to
 * re-serialize bytes for hashing. Hashing operates on the original raw bytes.
 */

import {
  sanitizeString,
  sanitizeUrl,
  sanitizeStringWithWarnings,
  MAX_TRACE_STRING_LENGTH,
  MAX_SIGNAL_STRING_LENGTH,
  MAX_NAME_STRING_LENGTH,
  MAX_SOURCES_COUNT,
  MAX_CONDITIONS_COUNT,
} from "./trace-schema";

// ─── Public types ─────────────────────────────────────────────────────────────

export type TraceFormat = "agents-v1" | "agents-v2" | "backend-v1" | "text" | "unknown";

export type TraceDecision =
  | "buy"
  | "sell"
  | "create_market"
  | "skip"
  | "redeem"
  | "claim_remainder"
  | "resolve"
  | "rebalance"
  | "risk_reject"
  | "other";

export interface TraceEstimate {
  yesBps: bigint;
  source: "probabilityEstimate" | "fairValue.bps" | "inputs";
  interval?: { loBps: bigint; hiBps: bigint };
}

export interface TraceMarketSnapshot {
  reserveYes: bigint;
  reserveNo: bigint;
  feeBps: number;
  priceYesBps: number;
  ledger: number;
  closeTime: number;
}

export interface TraceOrder {
  collateralIn?: bigint;
  minSharesOut?: bigint;
  sharesIn?: bigint;
  minCollateralOut?: bigint;
}

export interface TraceSource {
  name: string;
  weight: number | null;
  signal: string;
  url: string | null;
}

export interface TraceView {
  format: TraceFormat;
  decision: TraceDecision;
  side: "Yes" | "No" | null;
  estimate: TraceEstimate | null;
  marketSnapshot: TraceMarketSnapshot | null;
  order: TraceOrder | null;
  reasoning: string;
  sources: TraceSource[];
  /** u64 market id as decimal string; null when missing or not applicable. */
  marketId: string | null;
  /** Unix seconds; null when missing. */
  timestamp: number | null;
  /** Validation issues that do not prevent rendering. */
  issues: string[];
  /** Unknown root-level keys (reported but not adopted). */
  unknownFields: string[];
}

export interface FormatHandler {
  format: TraceFormat;
  detect(obj: Record<string, unknown>): boolean;
  toView(obj: Record<string, unknown>): TraceView;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const SAFE_AGENTS = new Set(["market-maker", "trader"]);

/** Explicitly guard against prototype pollution. */
function safeEntries(obj: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(obj).filter(
    ([k]) => k !== "__proto__" && k !== "constructor" && k !== "prototype",
  );
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function safeString(val: unknown, max: number = MAX_NAME_STRING_LENGTH): string {
  if (val == null) return "";
  return sanitizeString(val, max);
}

function safeBigInt(val: unknown): bigint | null {
  if (typeof val === "bigint") return val;
  if (typeof val === "number" && Number.isFinite(val)) return BigInt(Math.floor(val));
  if (typeof val === "string" && /^\d+$/.test(val.trim())) return BigInt(val.trim());
  return null;
}

function safeNumber(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  return null;
}

function safeInt(val: unknown): number | null {
  const n = safeNumber(val);
  return n !== null ? Math.floor(n) : null;
}

/** Normalize a u64 marketId to decimal string; flag precision loss. */
function normalizeMarketId(val: unknown, issues: string[]): string | null {
  if (val == null) return null;
  if (typeof val === "string") {
    if (/^\d+$/.test(val.trim())) return val.trim();
    return null;
  }
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return null;
    if (val > Number.MAX_SAFE_INTEGER) {
      issues.push("marketId exceeds Number.MAX_SAFE_INTEGER — precision loss possible");
    }
    return String(Math.floor(val));
  }
  return null;
}

/** Convert a [0,1] float probability to bps bigint (strict, no percent heuristic). */
function floatProbToBps(val: unknown, fieldName: string, issues: string[]): bigint | null {
  const n = safeNumber(val);
  if (n === null) return null;
  if (n < 0 || n > 1) {
    issues.push(`${fieldName} out of [0,1] range (${n}) — estimate suppressed`);
    return null;
  }
  return BigInt(Math.round(n * 10_000));
}

function parseSources(raw: unknown, warnings: string[]): TraceSource[] {
  if (!Array.isArray(raw)) return [];
  const sliced = raw.slice(0, MAX_SOURCES_COUNT);
  if (raw.length > MAX_SOURCES_COUNT) {
    warnings.push(`Sources capped at ${MAX_SOURCES_COUNT}`);
  }
  const out: TraceSource[] = [];
  for (const item of sliced) {
    if (!isPlainObject(item)) continue;
    const { cleaned: name, hasBidi: nb, hasControls: nc } = sanitizeStringWithWarnings(
      item["name"] ?? item["source"] ?? "Source",
      MAX_NAME_STRING_LENGTH,
    );
    if (nb || nc) warnings.push(`Sanitized bidi/control in source name "${name}"`);
    const { cleaned: signal } = sanitizeStringWithWarnings(
      item["signal"] ?? "",
      MAX_SIGNAL_STRING_LENGTH,
    );
    const weightRaw = safeNumber(item["weight"]);
    const weight = weightRaw !== null ? Math.min(1, Math.max(0, weightRaw)) : null;
    const url = sanitizeUrl(item["url"] ?? item["link"]);
    out.push({ name, weight, signal, url });
  }
  return out;
}

function emptyView(format: TraceFormat, overrides: Partial<TraceView> = {}): TraceView {
  return {
    format,
    decision: "other",
    side: null,
    estimate: null,
    marketSnapshot: null,
    order: null,
    reasoning: "",
    sources: [],
    marketId: null,
    timestamp: null,
    issues: [],
    unknownFields: [],
    ...overrides,
  };
}

// ─── Known keys per format (for unknownFields computation) ────────────────────

const BACKEND_V1_KNOWN = new Set([
  "schemaVersion", "kind", "traceId", "agentType", "decisionType", "action",
  "probabilityEstimate", "marketProbability", "edge", "confidenceInterval",
  "sourcesUsed", "betFraction", "betSizeUsdc", "hedgeConditions", "agentWallet",
  "createdAt", "strict", "reasoning", "marketId",
]);

const AGENTS_V2_KNOWN = new Set([
  "schemaVersion", "agent", "marketId", "action", "inputs", "timestamp",
  "ledgerSequence", "ledgerCloseTime", "extensions",
]);

const AGENTS_V1_KNOWN = new Set([
  "agent", "marketId", "action", "reasoning", "inputs", "timestamp", "version",
]);

function collectUnknownFields(
  obj: Record<string, unknown>,
  known: Set<string>,
): string[] {
  return safeEntries(obj)
    .filter(([k]) => !known.has(k))
    .map(([k]) => sanitizeString(k, 100));
}

// ─── Action normalizers ───────────────────────────────────────────────────────

const AGENTS_V2_ACTION_MAP: Record<string, TraceDecision> = {
  buy: "buy",
  sell: "sell",
  create_market: "create_market",
  inventory_rebalance: "rebalance",
  risk_reject: "risk_reject",
  skip: "skip",
  redeem: "redeem",
  claim_remainder: "claim_remainder",
  resolve: "resolve",
};

const BACKEND_V1_DECISION_MAP: Record<string, TraceDecision> = {
  buy: "buy",
  sell: "sell",
  create_market: "create_market",
  skip: "skip",
  redeem: "redeem",
  resolve: "resolve",
};

/** agents-v1 uses "buy:yes", "buy:no", "other:maker" etc. */
function parseAgentsV1Action(raw: unknown): { decision: TraceDecision; side: "Yes" | "No" | null } {
  const str = typeof raw === "string" ? raw.trim() : "";
  const [action, qualifier] = str.split(":");
  const normalSide = qualifier === "yes" ? "Yes" : qualifier === "no" ? "No" : null;
  const normalAction: TraceDecision =
    action === "buy" ? "buy"
    : action === "sell" ? "sell"
    : action === "create_market" ? "create_market"
    : action === "skip" ? "skip"
    : action === "redeem" ? "redeem"
    : action === "resolve" ? "resolve"
    : "other";
  return { decision: normalAction, side: normalSide };
}

// ─── Format handlers ──────────────────────────────────────────────────────────

const backendV1Handler: FormatHandler = {
  format: "backend-v1",

  detect(obj) {
    return obj["schemaVersion"] === 1 && obj["kind"] === "oracledesk.trace";
  },

  toView(obj): TraceView {
    const issues: string[] = [];
    const warnings: string[] = [];

    // estimate
    const pBps = floatProbToBps(obj["probabilityEstimate"], "probabilityEstimate", issues);
    let estimate: TraceEstimate | null = null;
    if (pBps !== null) {
      let interval: TraceEstimate["interval"] | undefined;
      const rawCi = obj["confidenceInterval"];
      if (isPlainObject(rawCi)) {
        const lo = floatProbToBps(rawCi["lower"] ?? rawCi["min"], "confidenceInterval.lower", issues);
        const hi = floatProbToBps(rawCi["upper"] ?? rawCi["max"], "confidenceInterval.upper", issues);
        if (lo !== null && hi !== null && lo <= hi) {
          interval = { loBps: lo, hiBps: hi };
        }
      }
      estimate = { yesBps: pBps, source: "probabilityEstimate", interval };
    } else {
      issues.push("probabilityEstimate missing or invalid — estimate suppressed");
    }

    // decision
    const rawDecision = obj["decisionType"] ?? obj["action"];
    const decision: TraceDecision =
      typeof rawDecision === "string"
        ? BACKEND_V1_DECISION_MAP[rawDecision] ?? "other"
        : "other";

    // sources
    const sources = parseSources(obj["sourcesUsed"], warnings);
    issues.push(...warnings);

    // reasoning
    const reasoning = safeString(obj["reasoning"], MAX_TRACE_STRING_LENGTH);

    // timestamp
    const rawTs = obj["createdAt"];
    let timestamp: number | null = null;
    if (typeof rawTs === "number" && Number.isFinite(rawTs)) {
      timestamp = rawTs;
    } else if (typeof rawTs === "string") {
      const d = Date.parse(rawTs);
      if (!Number.isNaN(d)) timestamp = Math.floor(d / 1000);
    }

    return {
      format: "backend-v1",
      decision,
      side: null,
      estimate,
      marketSnapshot: null,
      order: null,
      reasoning,
      sources,
      marketId: normalizeMarketId(obj["marketId"], issues),
      timestamp,
      issues,
      unknownFields: collectUnknownFields(obj, BACKEND_V1_KNOWN),
    };
  },
};

const agentsV2Handler: FormatHandler = {
  format: "agents-v2",

  detect(obj) {
    return (
      obj["schemaVersion"] === 2 &&
      typeof obj["agent"] === "string" &&
      SAFE_AGENTS.has(obj["agent"])
    );
  },

  toView(obj): TraceView {
    const issues: string[] = [];

    const rawAction = typeof obj["action"] === "string" ? obj["action"] : "";
    const decision: TraceDecision = AGENTS_V2_ACTION_MAP[rawAction] ?? "other";
    const side: "Yes" | "No" | null =
      decision === "buy" || decision === "sell"
        ? (rawAction === "sell" ? "Yes" : "Yes") // side encoded in inputs.order, see below
        : null;

    const inputs = isPlainObject(obj["inputs"]) ? (obj["inputs"] as Record<string, unknown>) : null;

    // estimate
    let estimate: TraceEstimate | null = null;
    if ((decision === "buy" || decision === "sell") && inputs !== null) {
      const fairValue = isPlainObject(inputs["fairValue"]) ? inputs["fairValue"] : null;
      if (fairValue !== null) {
        const bpsRaw = safeBigInt(fairValue["bps"]);
        if (bpsRaw !== null && bpsRaw >= 0n && bpsRaw <= 10_000n) {
          // Verify priceYesBps consistency
          const rYes = safeBigInt(inputs["reserveYes"]);
          const rNo = safeBigInt(inputs["reserveNo"]);
          if (rYes !== null && rNo !== null && rYes + rNo > 0n) {
            const expectedPrice = (rNo * 10_000n) / (rYes + rNo); // floor
            const recordedPrice = safeBigInt(inputs["priceYesBps"]);
            if (recordedPrice !== null && recordedPrice !== expectedPrice) {
              issues.push(
                `priceYesBps inconsistency: recorded ${recordedPrice}, expected ${expectedPrice} from reserves`,
              );
            }
          }
          estimate = { yesBps: bpsRaw, source: "fairValue.bps" };
        } else {
          issues.push("inputs.fairValue.bps missing or out of [0,10000]");
        }
      } else {
        issues.push("inputs.fairValue not found — estimate suppressed");
      }
    } else if (decision === "create_market" && inputs !== null) {
      const initBps = safeBigInt(inputs["initialYesBps"]);
      if (initBps !== null && initBps >= 0n && initBps <= 10_000n) {
        estimate = { yesBps: initBps, source: "inputs" };
      }
    }

    // market snapshot
    let marketSnapshot: TraceMarketSnapshot | null = null;
    if (inputs !== null) {
      const rYes = safeBigInt(inputs["reserveYes"]);
      const rNo = safeBigInt(inputs["reserveNo"]);
      const feeBps = safeInt(inputs["feeBps"]);
      const priceYes = safeInt(inputs["priceYesBps"]);
      const ledger = safeInt(obj["ledgerSequence"] ?? inputs["ledgerSequence"]);
      const closeTime = safeInt(obj["ledgerCloseTime"] ?? inputs["ledgerCloseTime"]);
      if (
        rYes !== null && rNo !== null && rYes >= 0n && rNo >= 0n &&
        feeBps !== null && priceYes !== null && ledger !== null && closeTime !== null
      ) {
        marketSnapshot = {
          reserveYes: rYes,
          reserveNo: rNo,
          feeBps,
          priceYesBps: priceYes,
          ledger,
          closeTime,
        };
      }
    }

    // order
    let order: TraceOrder | null = null;
    if (inputs !== null && isPlainObject(inputs["order"])) {
      const rawOrder = inputs["order"] as Record<string, unknown>;
      const ci = safeBigInt(rawOrder["collateralIn"]);
      const ms = safeBigInt(rawOrder["minSharesOut"]);
      const si = safeBigInt(rawOrder["sharesIn"]);
      const mc = safeBigInt(rawOrder["minCollateralOut"]);
      if (ci !== null || ms !== null || si !== null || mc !== null) {
        order = {
          ...(ci !== null ? { collateralIn: ci } : {}),
          ...(ms !== null ? { minSharesOut: ms } : {}),
          ...(si !== null ? { sharesIn: si } : {}),
          ...(mc !== null ? { minCollateralOut: mc } : {}),
        };
      }
    }

    // reasoning (not standard in v2 but tolerated in extensions)
    const reasoning = safeString(obj["reasoning"] ?? (isPlainObject(obj["extensions"]) ? (obj["extensions"] as Record<string, unknown>)["reasoning"] : undefined), MAX_TRACE_STRING_LENGTH);

    // timestamp
    const rawTs = obj["timestamp"];
    let timestamp: number | null = null;
    if (typeof rawTs === "number" && Number.isFinite(rawTs)) timestamp = rawTs;

    return {
      format: "agents-v2",
      decision,
      side: side ?? (decision === "buy" ? "Yes" : decision === "sell" ? "Yes" : null),
      estimate,
      marketSnapshot,
      order,
      reasoning,
      sources: [],
      marketId: normalizeMarketId(obj["marketId"], issues),
      timestamp,
      issues,
      unknownFields: collectUnknownFields(obj, AGENTS_V2_KNOWN),
    };
  },
};

const agentsV1Handler: FormatHandler = {
  format: "agents-v1",

  detect(obj) {
    return (
      obj["schemaVersion"] === undefined &&
      obj["version"] === undefined &&
      typeof obj["agent"] === "string" &&
      SAFE_AGENTS.has(obj["agent"]) &&
      isPlainObject(obj["inputs"])
    );
  },

  toView(obj): TraceView {
    const issues: string[] = [];

    const { decision, side } = parseAgentsV1Action(obj["action"]);
    const inputs = isPlainObject(obj["inputs"]) ? (obj["inputs"] as Record<string, unknown>) : {};

    // estimate: only from inputs.fairValueBps (never from other keys)
    let estimate: TraceEstimate | null = null;
    const fairValueBps = safeBigInt(inputs["fairValueBps"]);
    if (fairValueBps !== null && fairValueBps >= 0n && fairValueBps <= 10_000n) {
      estimate = { yesBps: fairValueBps, source: "fairValue.bps" };
    }
    // maker traces (inputs.signal/decision/dueDiligence) → estimate stays null

    // marketId: may be number (precision risk) or null
    const marketId = normalizeMarketId(obj["marketId"], issues);

    // reasoning
    const reasoning = safeString(obj["reasoning"], MAX_TRACE_STRING_LENGTH);

    // timestamp
    const rawTs = obj["timestamp"];
    let timestamp: number | null = null;
    if (typeof rawTs === "number" && Number.isFinite(rawTs)) timestamp = rawTs;
    else if (typeof rawTs === "string") {
      const d = Date.parse(rawTs);
      if (!Number.isNaN(d)) timestamp = Math.floor(d / 1000);
    }

    return {
      format: "agents-v1",
      decision,
      side,
      estimate,
      marketSnapshot: null,
      order: null,
      reasoning,
      sources: [],
      marketId,
      timestamp,
      issues,
      unknownFields: collectUnknownFields(obj, AGENTS_V1_KNOWN),
    };
  },
};

const textHandler: FormatHandler = {
  format: "text",
  detect: () => false, // applied only by parseTrace for string/primitive inputs
  toView: () => emptyView("text"),
};

const unknownHandler: FormatHandler = {
  format: "unknown",
  detect: () => true, // catch-all
  toView(obj): TraceView {
    return {
      ...emptyView("unknown"),
      issues: ["Unrecognized trace format"],
      unknownFields: safeEntries(obj).map(([k]) => sanitizeString(k, 100)),
    };
  },
};

/** Ordered registry — detection is first-match. */
export const TRACE_FORMATS: readonly FormatHandler[] = [
  backendV1Handler,
  agentsV2Handler,
  agentsV1Handler,
  // textHandler and unknownHandler are handled inline in parseTrace
];

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Parses raw decoded content (JSON object or string) into a TraceView.
 *
 * IMPORTANT: this function receives already-decoded content. It must never be
 * used to re-serialize bytes — trace hashing always operates on the original
 * raw bytes from IPFS.
 */
export function parseTrace(content: unknown): TraceView {
  // Raw text
  if (typeof content === "string") {
    const trimmed = content.trim();
    // Try JSON parse
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return {
        ...emptyView("text"),
        reasoning: sanitizeString(trimmed, MAX_TRACE_STRING_LENGTH),
      };
    }
    if (!isPlainObject(parsed)) {
      return {
        ...emptyView("text"),
        reasoning: sanitizeString(trimmed, MAX_TRACE_STRING_LENGTH),
      };
    }
    content = parsed;
  }

  if (!isPlainObject(content)) {
    return {
      ...emptyView("unknown"),
      issues: ["Unrecognized trace format"],
    };
  }

  const obj = content as Record<string, unknown>;

  for (const handler of TRACE_FORMATS) {
    if (handler.detect(obj)) {
      return handler.toView(obj);
    }
  }

  return unknownHandler.toView(obj);
}
