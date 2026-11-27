import { describe, expect, it } from "vitest";
import { splitFee, validateLpRecipient } from "../lp";

describe("splitFee", () => {
  it("splits evenly at 50%", () => {
    expect(splitFee(100n, 5_000n)).toEqual({ protocol: 50n, lp: 50n });
  });

  it("rounds the protocol share up", () => {
    // 10 * 3333 / 10000 = 3.333 -> protocol rounds up to 4.
    expect(splitFee(10n, 3_333n)).toEqual({ protocol: 4n, lp: 6n });
  });

  it("always sums to the fee and keeps each side within bounds", () => {
    for (const fee of [0n, 1n, 7n, 999n, 1_000_003n]) {
      for (const share of [0n, 1n, 2_500n, 6_667n, 10_000n]) {
        const { protocol, lp } = splitFee(fee, share);
        expect(protocol + lp).toBe(fee);
        expect(lp >= 0n && lp <= fee).toBe(true);
      }
    }
  });

  it("rejects out-of-range shares", () => {
    expect(() => splitFee(1n, 10_001n)).toThrow(RangeError);
    expect(() => splitFee(-1n, 1n)).toThrow(RangeError);
  });
});

describe("validateLpRecipient", () => {
  const creator = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

  it("rejects empty, non-account and current-LP recipients", () => {
    expect(validateLpRecipient("  ", creator)).not.toBeNull();
    expect(validateLpRecipient("not-an-address", creator)).toBe("Enter a G… account address.");
    expect(validateLpRecipient(creator, creator)).toBe("That address already holds the LP role.");
  });
});
