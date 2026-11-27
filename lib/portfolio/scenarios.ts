/**
 * Outcome scenario engine for /portfolio.
 *
 * All values are bigints in 7-decimal USDC base units.
 * No floating-point arithmetic is used anywhere in this module.
 *
 * Key invariants:
 *   payoff["void"] = settleValue("void", yes, no) = (yes + no) / 2n  (single floor on sum)
 *   impliedExpectedValue uses midValue from valuation.ts — the two are consistent by construction.
 *   Group enumeration is O(3^n) with n ≤ 8 (max 6,561 iterations), enforced at the boundary.
 *   Groups must be disjoint; validated before combinedRange.
 */

import { settleValue } from "../stellar/generated/fpmm";
import { midValue } from "./valuation";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Outcome = "yes" | "no" | "void";
export const ALL_OUTCOMES: readonly Outcome[] = ["yes", "no", "void"];

export interface ScenarioPosition {
  marketId: string;
  yes: bigint;
  no: bigint;
  /** Non-null when the market has resolved. */
  settled: Outcome | null;
  /** null when cost history is incomplete (truncated RPC window). */
  cost: bigint | null;
  /** null when the market is not tradable (closed, paused, or resolved). */
  exitValue: bigint | null;
}

export interface MarketScenario {
  marketId: string;
  /** Exact bigint payoff for each outcome. */
  payoff: Record<Outcome, bigint>;
  /** PnL per outcome; null when cost is null. */
  pnl: Record<Outcome, bigint> | null;
  /** Which outcomes are possible (all 3, or just the settled one). */
  possible: Outcome[];
}

export type GroupConstraint =
  | { kind: "independent" }
  | { kind: "exactly-one-yes" }
  | { kind: "at-most-one-yes" }
  | { kind: "implies"; ifYes: string; thenYes: string };

export interface Group {
  id: string;
  marketIds: string[];
  constraint: GroupConstraint;
  /** Combo keys ("yes|no|void|…") that are excluded by the user. */
  excluded: Set<string>;
}

export interface GroupCombo {
  /** outcomes[marketId] = "yes" | "no" | "void" */
  outcomes: Record<string, Outcome>;
  payoff: bigint;
  pnl: bigint | null;
}

// ─── marketScenarios ──────────────────────────────────────────────────────────

/**
 * Computes per-outcome payoffs for a single position.
 * Uses settleValue from fpmm.ts directly — the only source of truth.
 */
export function marketScenarios(
  p: ScenarioPosition,
  opts: { includeVoid: boolean },
): MarketScenario {
  const yes = p.yes > 0n ? p.yes : 0n;
  const no = p.no > 0n ? p.no : 0n;

  const payoff: Record<Outcome, bigint> = {
    yes: settleValue("yes", yes, no),
    no: settleValue("no", yes, no),
    void: settleValue("void", yes, no),
  };

  const pnl: Record<Outcome, bigint> | null =
    p.cost !== null
      ? {
          yes: payoff.yes - p.cost,
          no: payoff.no - p.cost,
          void: payoff.void - p.cost,
        }
      : null;

  let possible: Outcome[];
  if (p.settled !== null) {
    possible = [p.settled];
  } else {
    possible = opts.includeVoid ? ["yes", "no", "void"] : ["yes", "no"];
  }

  return { marketId: p.marketId, payoff, pnl, possible };
}

// ─── bookBounds ───────────────────────────────────────────────────────────────

/**
 * Σ max(payoff over possible) for best-case; Σ min(payoff over possible) for worst-case.
 * Both are exact bigint sums.
 */
export function bookBounds(ms: readonly MarketScenario[]): { best: bigint; worst: bigint } {
  let best = 0n;
  let worst = 0n;
  for (const m of ms) {
    if (m.possible.length === 0) continue;
    let hi = m.payoff[m.possible[0]];
    let lo = m.payoff[m.possible[0]];
    for (let i = 1; i < m.possible.length; i++) {
      const v = m.payoff[m.possible[i]];
      if (v > hi) hi = v;
      if (v < lo) lo = v;
    }
    best += hi;
    worst += lo;
  }
  return { best, worst };
}

// ─── enumerateGroup ───────────────────────────────────────────────────────────

const MAX_GROUP_SIZE = 8;

/**
 * Enumerates all constraint-valid, non-excluded outcome combinations for a group.
 * Time: O(3^n) with n ≤ 8. Throws a descriptive error for n > 8.
 */
export function enumerateGroup(g: Group, ms: Map<string, MarketScenario>): GroupCombo[] {
  const { marketIds, constraint, excluded } = g;
  if (marketIds.length > MAX_GROUP_SIZE) {
    throw new Error(
      `Group "${g.id}" has ${marketIds.length} markets; maximum is ${MAX_GROUP_SIZE}.`,
    );
  }

  const scenarios = marketIds.map((id) => {
    const s = ms.get(id);
    if (!s) throw new Error(`Group "${g.id}" references unknown market "${id}".`);
    return s;
  });

  // Check implies cycles
  if (constraint.kind === "implies") {
    const { ifYes, thenYes } = constraint;
    if (!marketIds.includes(ifYes) || !marketIds.includes(thenYes)) {
      throw new Error(`"implies" references markets not in the group.`);
    }
  }

  const results: GroupCombo[] = [];
  const n = marketIds.length;
  const totalCombos = 3 ** n; // max 6,561 for n=8

  for (let i = 0; i < totalCombos; i++) {
    // Decode combo index to outcomes
    const outcomes: Record<string, Outcome> = {};
    let rem = i;
    for (let j = n - 1; j >= 0; j--) {
      const digit = rem % 3;
      rem = Math.floor(rem / 3);
      outcomes[marketIds[j]] = ALL_OUTCOMES[digit];
    }

    // Filter to possible outcomes per market
    let valid = true;
    for (let j = 0; j < n; j++) {
      const sc = scenarios[j];
      if (!sc.possible.includes(outcomes[marketIds[j]])) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;

    // Apply constraint
    if (constraint.kind === "exactly-one-yes") {
      const yesCount = marketIds.filter((id) => outcomes[id] === "yes").length;
      if (yesCount !== 1) continue;
    } else if (constraint.kind === "at-most-one-yes") {
      const yesCount = marketIds.filter((id) => outcomes[id] === "yes").length;
      if (yesCount > 1) continue;
    } else if (constraint.kind === "implies") {
      const { ifYes, thenYes } = constraint;
      if (outcomes[ifYes] === "yes" && outcomes[thenYes] !== "yes") continue;
    }

    // Combo key for exclusion check
    const comboKey = marketIds.map((id) => outcomes[id]).join("|");
    if (excluded.has(comboKey)) continue;

    // Compute payoff and pnl
    let payoff = 0n;
    let pnl: bigint | null = 0n;
    for (let j = 0; j < n; j++) {
      const sc = scenarios[j];
      const outcome = outcomes[marketIds[j]];
      payoff += sc.payoff[outcome];
      if (pnl !== null && sc.pnl !== null) {
        pnl += sc.pnl[outcome];
      } else {
        pnl = null;
      }
    }

    results.push({ outcomes, payoff, pnl });
  }

  if (results.length === 0) {
    throw new Error(`Group "${g.id}": constraints exclude every outcome combination.`);
  }

  return results;
}

// ─── combinedRange ────────────────────────────────────────────────────────────

/**
 * Best = max payoff per group + Σ max(payoff) over independent markets.
 * Worst = min payoff per group + Σ min(payoff) over independent markets.
 * Groups must be disjoint (caller's responsibility to validate).
 */
export function combinedRange(
  groups: GroupCombo[][],
  independent: MarketScenario[],
): { best: bigint; worst: bigint } {
  let best = 0n;
  let worst = 0n;

  for (const combos of groups) {
    if (combos.length === 0) continue;
    let hi = combos[0].payoff;
    let lo = combos[0].payoff;
    for (let i = 1; i < combos.length; i++) {
      if (combos[i].payoff > hi) hi = combos[i].payoff;
      if (combos[i].payoff < lo) lo = combos[i].payoff;
    }
    best += hi;
    worst += lo;
  }

  const { best: indBest, worst: indWorst } = bookBounds(independent);
  best += indBest;
  worst += indWorst;

  return { best, worst };
}

// ─── impliedExpectedValue ─────────────────────────────────────────────────────

/**
 * Market-implied expected value for open positions.
 * Uses midValue from valuation.ts — identical to the valuation module's mid.
 * They share the same function so the two can never disagree.
 */
export function impliedExpectedValue(
  positions: Array<
    ScenarioPosition & { reserveYes: bigint; reserveNo: bigint }
  >,
): bigint {
  let total = 0n;
  for (const p of positions) {
    if (p.settled !== null) {
      // settled: use the actual payoff
      total += settleValue(p.settled, p.yes > 0n ? p.yes : 0n, p.no > 0n ? p.no : 0n);
    } else {
      total += midValue(p.reserveYes, p.reserveNo, p.yes > 0n ? p.yes : 0n, p.no > 0n ? p.no : 0n);
    }
  }
  return total;
}

// ─── Group validation ─────────────────────────────────────────────────────────

/** Validate that groups are disjoint. Returns error message or null. */
export function validateGroupsDisjoint(groups: Group[]): string | null {
  const seen = new Set<string>();
  for (const g of groups) {
    for (const id of g.marketIds) {
      if (seen.has(id)) {
        return `Market "${id}" appears in more than one group.`;
      }
      seen.add(id);
    }
  }
  return null;
}
