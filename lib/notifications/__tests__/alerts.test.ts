import { describe, expect, it } from "vitest";
import {
  MAX_ALERT_RULES,
  alertInboxId,
  evaluateRule,
  evaluateSeries,
  initialState,
  validateRule,
  validateRules,
  type AlertPricePoint,
  type AlertRule,
} from "../alerts";

const M = "7";
const pt = (ledger: number, yesBps: number, time = ledger * 5, marketId = M): AlertPricePoint => ({
  marketId, ledger, time, yesBps: BigInt(yesBps),
});
const cross = (over: Partial<Extract<AlertRule, { kind: "cross" }>> = {}): Extract<AlertRule, { kind: "cross" }> => ({
  id: "r1", kind: "cross", marketId: M, direction: "above", levelBps: 6000, hysteresisBps: 200, ...over,
});
const move = (over: Partial<Extract<AlertRule, { kind: "move" }>> = {}): Extract<AlertRule, { kind: "move" }> => ({
  id: "m1", kind: "move", marketId: M, deltaBps: 500, windowSec: 600, ...over,
});

describe("validateRule", () => {
  it("accepts valid cross and move rules", () => {
    expect(validateRule(cross())).toBeNull();
    expect(validateRule(move())).toBeNull();
  });

  it("rejects levels outside 1..9999 and non-integers", () => {
    expect(validateRule(cross({ levelBps: 0 }))).not.toBeNull();
    expect(validateRule(cross({ levelBps: 10_000 }))).not.toBeNull();
    expect(validateRule(cross({ levelBps: 55.5 }))).not.toBeNull();
  });

  it("rejects a hysteresis band that could never re-arm", () => {
    expect(validateRule(cross({ direction: "above", levelBps: 300, hysteresisBps: 300 }))).toMatch(/never re-arm/);
    expect(validateRule(cross({ direction: "below", levelBps: 9_800, hysteresisBps: 200 }))).toMatch(/never re-arm/);
    expect(validateRule(cross({ direction: "below", levelBps: 9_800, hysteresisBps: 199 }))).toBeNull();
  });

  it("bounds move size and window", () => {
    expect(validateRule(move({ deltaBps: 0 }))).not.toBeNull();
    expect(validateRule(move({ windowSec: 59 }))).not.toBeNull();
    expect(validateRule(move({ windowSec: 7 * 86_400 + 1 }))).not.toBeNull();
  });
});

describe("validateRules", () => {
  it("allows 50 rules and rejects 51", () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => cross({ id: `r${i}` }));
    expect(validateRules(make(MAX_ALERT_RULES))).toBeNull();
    expect(validateRules(make(MAX_ALERT_RULES + 1))).toMatch(/At most 50/);
  });

  it("rejects duplicate ids", () => {
    expect(validateRules([cross(), cross()])).toMatch(/Duplicate/);
  });
});

describe("cross rules", () => {
  it("fires exactly at the level (inclusive) and not one bp below", () => {
    expect(evaluateRule(cross(), initialState(), pt(10, 5_999)).firing).toBeNull();
    const hit = evaluateRule(cross(), initialState(), pt(11, 6_000));
    expect(hit.firing).toMatchObject({ ruleId: "r1", ledger: 11, yesBps: 6_000n });
    expect(hit.state.armed).toBe(false);
  });

  it("fires once while the price stays above the level", () => {
    const { firings } = evaluateSeries(cross(), initialState(), [pt(1, 6_100), pt(2, 6_300), pt(3, 6_500)]);
    expect(firings).toHaveLength(1);
  });

  it("does not re-arm inside the hysteresis band, so a flapping price fires once", () => {
    const { firings } = evaluateSeries(cross(), initialState(), [
      pt(1, 6_050), pt(2, 5_950), pt(3, 6_050), pt(4, 5_900), pt(5, 6_100),
    ]);
    expect(firings).toHaveLength(1);
  });

  it("re-arms at level minus hysteresis and fires again on the next crossing", () => {
    const { firings, state } = evaluateSeries(cross(), initialState(), [
      pt(1, 6_100), pt(2, 5_800), pt(3, 6_000),
    ]);
    expect(firings.map((f) => f.ledger)).toEqual([1, 3]);
    expect(state.armed).toBe(false);
  });

  it("handles a below rule symmetrically", () => {
    const rule = cross({ direction: "below", levelBps: 4_000, hysteresisBps: 200 });
    const { firings } = evaluateSeries(rule, initialState(), [pt(1, 4_000), pt(2, 4_100), pt(3, 4_200), pt(4, 3_900)]);
    expect(firings.map((f) => f.ledger)).toEqual([1, 4]);
  });

  it("with zero hysteresis re-arms as soon as the price leaves the level", () => {
    const { firings } = evaluateSeries(cross({ hysteresisBps: 0 }), initialState(), [pt(1, 6_000), pt(2, 5_999), pt(3, 6_000)]);
    expect(firings).toHaveLength(2);
  });
});

describe("move rules", () => {
  it("fires when the change inside the window reaches deltaBps", () => {
    const { firings } = evaluateSeries(move(), initialState(), [pt(1, 5_000, 1_000), pt(2, 5_300, 1_200), pt(3, 5_500, 1_400)]);
    expect(firings).toHaveLength(1);
    expect(firings[0]).toMatchObject({ ledger: 3, changeBps: 500n });
  });

  it("reports the sign of the change", () => {
    const { firings } = evaluateSeries(move(), initialState(), [pt(1, 6_000, 1_000), pt(2, 5_400, 1_100)]);
    expect(firings[0]?.changeBps).toBe(-600n);
  });

  it("ignores moves that happened outside the window", () => {
    const { firings } = evaluateSeries(move({ windowSec: 600 }), initialState(), [pt(1, 5_000, 1_000), pt(2, 5_700, 1_700)]);
    expect(firings).toHaveLength(0);
  });

  it("stays quiet for one window after firing", () => {
    const { firings } = evaluateSeries(move(), initialState(), [
      pt(1, 5_000, 1_000), pt(2, 5_600, 1_100), pt(3, 6_300, 1_300),
    ]);
    expect(firings).toHaveLength(1);
  });

  it("needs an earlier point to compare with", () => {
    expect(evaluateRule(move(), initialState(), pt(1, 9_000)).firing).toBeNull();
  });
});

describe("replay and scoping", () => {
  it("ignores other markets", () => {
    const result = evaluateRule(cross(), initialState(), pt(5, 9_000, 25, "99"));
    expect(result.firing).toBeNull();
    expect(result.state).toEqual(initialState());
  });

  it("does not fire twice when the same ledger is replayed", () => {
    const first = evaluateRule(cross(), initialState(), pt(5, 6_500));
    const again = evaluateRule(cross(), first.state, pt(5, 6_500));
    expect(first.firing).not.toBeNull();
    expect(again.firing).toBeNull();
  });

  it("skips points at or before lastEvaluatedLedger (catch-up resumes where it left off)", () => {
    const { firings } = evaluateSeries(cross(), initialState(10), [pt(8, 6_500), pt(10, 6_500), pt(11, 6_500)]);
    expect(firings.map((f) => f.ledger)).toEqual([11]);
  });

  it("evaluates out-of-order points in ledger order", () => {
    const { firings } = evaluateSeries(cross(), initialState(), [pt(3, 6_500), pt(1, 5_000)]);
    expect(firings.map((f) => f.ledger)).toEqual([3]);
  });

  it("gives the same inbox id for the same firing, so two tabs store it once", () => {
    const a = evaluateRule(cross(), initialState(), pt(5, 6_500)).firing!;
    const b = evaluateRule(cross(), initialState(), pt(5, 6_500)).firing!;
    expect(alertInboxId(a)).toBe(alertInboxId(b));
    expect(alertInboxId(a)).toBe("alert:r1:5");
  });
});
