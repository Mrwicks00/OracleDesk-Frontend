import { describe, expect, it } from "vitest";
import { recoverBuy } from "../trade-recovery";

describe("recoverBuy", () => {
  it("returns a reduced buy that satisfies the original average-price bound", () => {
    const market = { reserveYes: 100_000n, reserveNo: 100_000n, feeBps: 30n, setsMinted: 0n, ledger: 1 };
    const failed = {
      side: "Yes" as const,
      collateralIn: 10_000n,
      minSharesOut: 8_000n,
      quotedShares: 9_000n,
      quotedAt: { reserveYes: 100_000n, reserveNo: 100_000n },
      slippageBps: 100,
    };
    const result = recoverBuy(failed, market);
    expect(result.kind).toBe("fillable");
    if (result.kind === "fillable") {
      expect(result.collateralIn * failed.minSharesOut <= result.sharesOut * failed.collateralIn).toBe(true);
    }
  });
});
