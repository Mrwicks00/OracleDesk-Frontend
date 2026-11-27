import { describe, it, expect } from "vitest";
import { mapErrorToField } from "../error-map";
import { UserFacingError } from "@/lib/stellar/errors";

type Fields = "amount" | "slippage" | "cap";

const map: Partial<Record<string, Fields>> = {
  SlippageExceeded: "slippage",
  InsufficientBalance: "amount",
  "insufficient-balance": "amount",
  ALLOWANCE_DAILY_LIMIT: "cap",
};

describe("mapErrorToField", () => {
  it("maps contract code to field (priority 1)", () => {
    const err = new UserFacingError({ kind: "contract", code: "SlippageExceeded", message: "Slippage exceeded" });
    const result = mapErrorToField<Fields>(err, map);
    expect(result.target).toEqual({ field: "slippage" });
    expect(result.message).toBe("Slippage exceeded");
  });

  it("maps DescribedErrorKind to field (priority 2)", () => {
    const err = new UserFacingError({ kind: "insufficient-balance", message: "Not enough USDC" });
    const result = mapErrorToField<Fields>(err, map);
    expect(result.target).toEqual({ field: "amount" });
  });

  it("maps ApiError code to field (priority 3)", () => {
    const apiErr = { name: "ApiError", code: "ALLOWANCE_DAILY_LIMIT", message: "Daily limit" };
    const result = mapErrorToField<Fields>(apiErr, map);
    expect(result.target).toEqual({ field: "cap" });
    expect(result.message).toBeTruthy();
  });

  it("falls back to form level for unknown errors", () => {
    const err = new Error("Unknown explosion");
    const result = mapErrorToField<Fields>(err, map);
    expect(result.target).toEqual({ form: true });
    expect(result.message).toBeTruthy();
  });

  it("returns form target when no mapping matches but provides message", () => {
    const err = new UserFacingError({ kind: "network", message: "Network error" });
    const result = mapErrorToField<Fields>(err, map);
    expect(result.target).toEqual({ form: true });
    expect(result.message).toBe("Network error");
  });
});
