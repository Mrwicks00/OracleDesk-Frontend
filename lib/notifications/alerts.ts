// Client-side price alerts (issue #320): the rule model, validation and a pure
// evaluator. Prices are YES prices in basis points (bigint, from reserves), so
// every comparison is exact integer math. Time is ledger-close time in unix
// seconds, never Date.now() (BRIEF §13). Storage, delivery and the ledger
// subscription are separate concerns and live elsewhere.

export const MAX_ALERT_RULES = 50;
export const MAX_WINDOW_SEC = 7 * 24 * 60 * 60;

export type AlertRule =
  | { id: string; kind: "cross"; marketId: string; direction: "above" | "below"; levelBps: number; hysteresisBps: number }
  | { id: string; kind: "move"; marketId: string; deltaBps: number; windowSec: number };

/** One observed price, as produced by `buildSeries` in lib/stellar/price-history.ts. */
export interface AlertPricePoint {
  marketId: string;
  ledger: number;
  /** Ledger close time, unix seconds. */
  time: number;
  yesBps: bigint;
}

/** Per-rule state, persisted next to the rule so catch-up can resume. */
export interface AlertRuleState {
  /** A cross rule fires only while armed; it re-arms once the price retreats past the hysteresis band. */
  armed: boolean;
  lastFiredLedger: number | null;
  /** Ledger time of the last firing; a move rule stays quiet for one window after it. */
  lastFiredTime: number | null;
  lastEvaluatedLedger: number;
}

export interface AlertFiring {
  ruleId: string;
  marketId: string;
  ledger: number;
  time: number;
  yesBps: bigint;
  /** For move rules, the signed change in bps over the window. */
  changeBps?: bigint;
}

export function initialState(sinceLedger = 0): AlertRuleState {
  return { armed: true, lastFiredLedger: null, lastFiredTime: null, lastEvaluatedLedger: sinceLedger };
}

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/** Returns an error message, or null when the rule is valid. */
export function validateRule(rule: AlertRule): string | null {
  if (typeof rule.id !== "string" || rule.id === "") return "Rule needs an id.";
  if (typeof rule.marketId !== "string" || rule.marketId === "") return "Rule needs a market.";
  if (rule.kind === "cross") {
    if (rule.direction !== "above" && rule.direction !== "below") return "Direction must be above or below.";
    if (!isInt(rule.levelBps) || rule.levelBps < 1 || rule.levelBps > 9_999) return "Level must be between 1 and 9999 bps.";
    if (!isInt(rule.hysteresisBps) || rule.hysteresisBps < 0 || rule.hysteresisBps > 5_000) {
      return "Hysteresis must be between 0 and 5000 bps.";
    }
    // A band that cannot fit between the level and the price bounds would never re-arm.
    const room = rule.direction === "above" ? rule.levelBps : 10_000 - rule.levelBps;
    if (rule.hysteresisBps >= room) return "Hysteresis is too wide for this level; the rule could never re-arm.";
    return null;
  }
  if (rule.kind === "move") {
    if (!isInt(rule.deltaBps) || rule.deltaBps < 1 || rule.deltaBps > 10_000) return "Move must be between 1 and 10000 bps.";
    if (!isInt(rule.windowSec) || rule.windowSec < 60 || rule.windowSec > MAX_WINDOW_SEC) {
      return "Window must be between 1 minute and 7 days.";
    }
    return null;
  }
  return "Unknown rule kind.";
}

/** Validates a whole rule set, including the size limit and duplicate ids. */
export function validateRules(rules: readonly AlertRule[]): string | null {
  if (rules.length > MAX_ALERT_RULES) return `At most ${MAX_ALERT_RULES} alert rules are allowed.`;
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) return `Duplicate rule id ${rule.id}.`;
    seen.add(rule.id);
    const error = validateRule(rule);
    if (error) return error;
  }
  return null;
}

export interface EvaluateResult {
  state: AlertRuleState;
  firing: AlertFiring | null;
}

/**
 * Evaluates one rule against one new price point. `history` holds the earlier
 * points of the same market, oldest first, and is only read by move rules.
 * Points for other markets, and points at or before `lastEvaluatedLedger`,
 * leave the state untouched, so replaying the same ledger twice fires once.
 */
export function evaluateRule(
  rule: AlertRule,
  state: AlertRuleState,
  point: AlertPricePoint,
  history: readonly AlertPricePoint[] = [],
): EvaluateResult {
  if (point.marketId !== rule.marketId || point.ledger <= state.lastEvaluatedLedger) return { state, firing: null };
  const next: AlertRuleState = { ...state, lastEvaluatedLedger: point.ledger };

  if (rule.kind === "cross") {
    const level = BigInt(rule.levelBps);
    const band = BigInt(rule.hysteresisBps);
    const crossed = rule.direction === "above" ? point.yesBps >= level : point.yesBps <= level;
    const retreated = rule.direction === "above" ? point.yesBps <= level - band : point.yesBps >= level + band;
    if (state.armed && crossed) {
      next.armed = false;
      next.lastFiredLedger = point.ledger;
      next.lastFiredTime = point.time;
      return { state: next, firing: { ruleId: rule.id, marketId: rule.marketId, ledger: point.ledger, time: point.time, yesBps: point.yesBps } };
    }
    if (!state.armed && retreated) next.armed = true;
    return { state: next, firing: null };
  }

  // move: compare with the oldest point still inside the window.
  const windowStart = point.time - rule.windowSec;
  if (state.lastFiredTime !== null && point.time - state.lastFiredTime < rule.windowSec) return { state: next, firing: null };
  const base = history.find((p) => p.marketId === rule.marketId && p.time >= windowStart && p.ledger < point.ledger);
  if (!base) return { state: next, firing: null };
  const change = point.yesBps - base.yesBps;
  const size = change < 0n ? -change : change;
  if (size >= BigInt(rule.deltaBps)) {
    next.lastFiredLedger = point.ledger;
    next.lastFiredTime = point.time;
    return {
      state: next,
      firing: { ruleId: rule.id, marketId: rule.marketId, ledger: point.ledger, time: point.time, yesBps: point.yesBps, changeBps: change },
    };
  }
  return { state: next, firing: null };
}

/**
 * Runs one rule over a market's points in ledger order, for the catch-up pass
 * on load and for ledger batches. Returns every firing and the final state.
 */
export function evaluateSeries(
  rule: AlertRule,
  state: AlertRuleState,
  points: readonly AlertPricePoint[],
): { state: AlertRuleState; firings: AlertFiring[] } {
  const own = points.filter((p) => p.marketId === rule.marketId).sort((a, b) => a.ledger - b.ledger);
  const firings: AlertFiring[] = [];
  let current = state;
  own.forEach((point, i) => {
    const result = evaluateRule(rule, current, point, own.slice(0, i));
    current = result.state;
    if (result.firing) firings.push(result.firing);
  });
  return { state: current, firings };
}

/** Stable inbox id, so a firing seen by two tabs (or by catch-up and live) is stored once. */
export function alertInboxId(firing: Pick<AlertFiring, "ruleId" | "ledger">): string {
  return `alert:${firing.ruleId}:${firing.ledger}`;
}
