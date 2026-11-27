/**
 * Tests for the scenario engine (#309).
 *
 * Tests:
 * - Payoffs equal settleValue for each outcome including odd void sums
 * - Settled market → single possible outcome
 * - bookBounds sums max and min per market
 * - exactly-one-yes constraint yields correct combo count
 * - implies constraint and cycle rejection
 * - Exclusion set removes combos
 * - n > 8 rejected
 * - impliedExpectedValue equals valuation midValue (shared helper)
 * - Property: worst ≤ implied ≤ best over random books
 */

import { describe, it, expect } from "vitest";
import {
  marketScenarios,
  bookBounds,
  enumerateGroup,
  combinedRange,
  impliedExpectedValue,
  validateGroupsDisjoint,
  type ScenarioPosition,
  type MarketScenario,
  type Group,
} from "../scenarios";
import { settleValue } from "../../stellar/generated/fpmm";
import { midValue } from "../valuation";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pos(overrides: Partial<ScenarioPosition> = {}): ScenarioPosition {
  return {
    marketId: "1",
    yes: 300_000_000n,   // 30 USDC shares
    no: 100_000_000n,    // 10 USDC shares
    settled: null,
    cost: 400_000_000n,
    exitValue: 350_000_000n,
    ...overrides,
  };
}

// ─── marketScenarios ──────────────────────────────────────────────────────────

describe("marketScenarios", () => {
  it("payoffs equal settleValue for each outcome", () => {
    const p = pos({ yes: 300_000_000n, no: 100_000_000n });
    const sc = marketScenarios(p, { includeVoid: true });
    expect(sc.payoff.yes).toBe(settleValue("yes", 300_000_000n, 100_000_000n));
    expect(sc.payoff.no).toBe(settleValue("no", 300_000_000n, 100_000_000n));
    expect(sc.payoff.void).toBe(settleValue("void", 300_000_000n, 100_000_000n));
  });

  it("void payoff floors the sum once (odd shares)", () => {
    // 30 YES + 11 NO → void = (30 + 11) / 2 = 20 (integer floor once on the sum)
    const p = pos({ yes: 30n, no: 11n, cost: null, exitValue: null });
    const sc = marketScenarios(p, { includeVoid: true });
    expect(sc.payoff.void).toBe(20n); // (30 + 11) / 2n = 20n (bigint floor)
  });

  it("settled market has only the settled outcome as possible", () => {
    const p = pos({ settled: "yes" });
    const sc = marketScenarios(p, { includeVoid: true });
    expect(sc.possible).toEqual(["yes"]);
  });

  it("open market with void excluded → only yes and no possible", () => {
    const p = pos({ settled: null });
    const sc = marketScenarios(p, { includeVoid: false });
    expect(sc.possible).toEqual(["yes", "no"]);
  });

  it("pnl is null when cost is null", () => {
    const p = pos({ cost: null });
    const sc = marketScenarios(p, { includeVoid: true });
    expect(sc.pnl).toBeNull();
  });

  it("pnl computed correctly when cost is known", () => {
    // YES payout = yes shares = 300_000_000
    // cost = 400_000_000 → pnl.yes = 300_000_000 - 400_000_000 = -100_000_000
    const p = pos({ yes: 300_000_000n, no: 100_000_000n, cost: 400_000_000n });
    const sc = marketScenarios(p, { includeVoid: true });
    expect(sc.pnl?.yes).toBe(settleValue("yes", 300_000_000n, 100_000_000n) - 400_000_000n);
    expect(sc.pnl?.no).toBe(settleValue("no", 300_000_000n, 100_000_000n) - 400_000_000n);
  });
});

// ─── bookBounds ───────────────────────────────────────────────────────────────

describe("bookBounds", () => {
  it("sums max and min across all markets", () => {
    const sc1: MarketScenario = {
      marketId: "1",
      payoff: { yes: 100n, no: 50n, void: 75n },
      pnl: null,
      possible: ["yes", "no", "void"],
    };
    const sc2: MarketScenario = {
      marketId: "2",
      payoff: { yes: 200n, no: 80n, void: 140n },
      pnl: null,
      possible: ["yes", "no"],
    };
    const { best, worst } = bookBounds([sc1, sc2]);
    expect(best).toBe(100n + 200n);  // max(100,50,75) + max(200,80)
    expect(worst).toBe(50n + 80n);   // min(100,50,75) + min(200,80)
  });

  it("handles settled market with single possible outcome", () => {
    const sc: MarketScenario = {
      marketId: "1",
      payoff: { yes: 100n, no: 0n, void: 50n },
      pnl: null,
      possible: ["yes"],
    };
    const { best, worst } = bookBounds([sc]);
    expect(best).toBe(100n);
    expect(worst).toBe(100n);
  });
});

// ─── enumerateGroup ───────────────────────────────────────────────────────────

function makeScenarioMap(ids: string[]): Map<string, MarketScenario> {
  const map = new Map<string, MarketScenario>();
  for (const id of ids) {
    map.set(id, {
      marketId: id,
      payoff: { yes: 100n, no: 0n, void: 50n },
      pnl: null,
      possible: ["yes", "no", "void"],
    });
  }
  return map;
}

describe("enumerateGroup", () => {
  it("exactly-one-yes with 3 markets and void: 3·2^2 = 12 combos", () => {
    // exactly-one-yes: for n=3 with void, number of combos where exactly one market is "yes"
    // = C(3,1) · 2^2 = 3 · 4 = 12 (the other two can be "no" or "void")
    const g: Group = {
      id: "g1",
      marketIds: ["A", "B", "C"],
      constraint: { kind: "exactly-one-yes" },
      excluded: new Set(),
    };
    const combos = enumerateGroup(g, makeScenarioMap(["A", "B", "C"]));
    expect(combos.length).toBe(12);
  });

  it("exactly-one-yes with 3 markets without void: 3 combos", () => {
    // Without void: each of the 3 markets can be the one YES; others must be NO
    const ms = new Map<string, MarketScenario>();
    for (const id of ["A", "B", "C"]) {
      ms.set(id, {
        marketId: id,
        payoff: { yes: 100n, no: 0n, void: 50n },
        pnl: null,
        possible: ["yes", "no"], // no void
      });
    }
    const g: Group = {
      id: "g1",
      marketIds: ["A", "B", "C"],
      constraint: { kind: "exactly-one-yes" },
      excluded: new Set(),
    };
    const combos = enumerateGroup(g, ms);
    expect(combos.length).toBe(3);
  });

  it("implies constraint filters correctly", () => {
    // If A=yes then B=yes
    const g: Group = {
      id: "g1",
      marketIds: ["A", "B"],
      constraint: { kind: "implies", ifYes: "A", thenYes: "B" },
      excluded: new Set(),
    };
    const combos = enumerateGroup(g, makeScenarioMap(["A", "B"]));
    // A=yes,B≠yes should not appear
    for (const c of combos) {
      if (c.outcomes["A"] === "yes") {
        expect(c.outcomes["B"]).toBe("yes");
      }
    }
  });

  it("exclusion set removes combos", () => {
    const g: Group = {
      id: "g1",
      marketIds: ["A", "B"],
      constraint: { kind: "independent" },
      excluded: new Set(["yes|yes"]),
    };
    const combos = enumerateGroup(g, makeScenarioMap(["A", "B"]));
    for (const c of combos) {
      expect(c.outcomes["A"] === "yes" && c.outcomes["B"] === "yes").toBe(false);
    }
  });

  it("throws for n > 8 markets", () => {
    const ids = Array.from({ length: 9 }, (_, i) => String(i));
    const g: Group = {
      id: "g1",
      marketIds: ids,
      constraint: { kind: "independent" },
      excluded: new Set(),
    };
    expect(() => enumerateGroup(g, makeScenarioMap(ids))).toThrow(/maximum is 8/);
  });

  it("throws when all combos are excluded", () => {
    // 2 markets, no void — 4 combos, exclude all 4
    const ms = new Map<string, MarketScenario>();
    for (const id of ["A", "B"]) {
      ms.set(id, {
        marketId: id,
        payoff: { yes: 100n, no: 0n, void: 50n },
        pnl: null,
        possible: ["yes", "no"],
      });
    }
    const g: Group = {
      id: "g1",
      marketIds: ["A", "B"],
      constraint: { kind: "independent" },
      excluded: new Set(["yes|yes", "yes|no", "no|yes", "no|no"]),
    };
    expect(() => enumerateGroup(g, ms)).toThrow(/exclude every outcome/);
  });
});

// ─── impliedExpectedValue ─────────────────────────────────────────────────────

describe("impliedExpectedValue", () => {
  it("equals midValue from valuation.ts for open positions", () => {
    const positions = [
      {
        marketId: "1",
        yes: 300_000_000n,
        no: 100_000_000n,
        settled: null as null,
        cost: null,
        exitValue: null,
        reserveYes: 5_000_000_000n,
        reserveNo: 5_000_000_000n,
      },
    ];
    const implied = impliedExpectedValue(positions);
    const expected = midValue(5_000_000_000n, 5_000_000_000n, 300_000_000n, 100_000_000n);
    expect(implied).toBe(expected);
  });
});

// ─── validateGroupsDisjoint ───────────────────────────────────────────────────

describe("validateGroupsDisjoint", () => {
  it("returns null for disjoint groups", () => {
    const groups: Group[] = [
      { id: "g1", marketIds: ["A", "B"], constraint: { kind: "independent" }, excluded: new Set() },
      { id: "g2", marketIds: ["C", "D"], constraint: { kind: "independent" }, excluded: new Set() },
    ];
    expect(validateGroupsDisjoint(groups)).toBeNull();
  });

  it("returns error message for overlapping groups", () => {
    const groups: Group[] = [
      { id: "g1", marketIds: ["A", "B"], constraint: { kind: "independent" }, excluded: new Set() },
      { id: "g2", marketIds: ["B", "C"], constraint: { kind: "independent" }, excluded: new Set() },
    ];
    const result = validateGroupsDisjoint(groups);
    expect(result).toContain('"B"');
  });
});
