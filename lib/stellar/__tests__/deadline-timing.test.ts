import { describe, expect, it } from "vitest";
import { deadlineFor, timeoutForTiming } from "../deadline";

describe("timing-aware deadlines", () => {
  it("extended mode requests the longer window", () => {
    const deadline = deadlineFor("transfer", 1_000, undefined, timeoutForTiming("extended"));
    expect(deadline.timeoutInSeconds).toBe(300);
    expect(deadline.maxTime).toBe(1_300);
  });

  it("still clamps the window to market close", () => {
    // Last safe second is close - 10 = 1040; 40 s remain from ledger time 1000.
    const deadline = deadlineFor("buy", 1_000, 1_050n, timeoutForTiming("extended"));
    expect(deadline.timeoutInSeconds).toBe(40);
  });
});
