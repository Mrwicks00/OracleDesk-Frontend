import { describe, expect, it, vi } from "vitest";
import { apiClient } from "../client";
import { initiateCopyTrade } from "../trade";

describe("initiateCopyTrade idempotency key", () => {
  it("sends an Idempotency-Key header and reuses options.idempotencyKey across retries", async () => {
    const postSpy = vi.spyOn(apiClient, "post").mockResolvedValue({
      data: {
        copyTradeId: "8c1f0a2b-1111-4222-8333-444455556666",
        transactionPayload: {
          contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
          onChainMarketId: "1",
          outcome: "Yes",
          collateralInRaw: "10000000",
          userWallet: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
          traceReference: null,
        },
        instructions: "Sign",
      },
      meta: null,
    } as never);

    const actionKey = "11111111-2222-4333-8444-555555555555";
    const params = {
      traceId: "8c1f0a2b-1111-4222-8333-444455556666",
      marketId: "9c1f0a2b-1111-4222-8333-444455556666",
      amountRaw: "10000000",
    };

    await initiateCopyTrade(params, { idempotencyKey: actionKey });
    await initiateCopyTrade(params, { idempotencyKey: actionKey });

    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(postSpy.mock.calls[0]?.[2]).toEqual({ "Idempotency-Key": actionKey });
    expect(postSpy.mock.calls[1]?.[2]).toEqual({ "Idempotency-Key": actionKey });

    // Without an explicit key, generates a UUID
    await initiateCopyTrade(params);
    const autoHeaders = postSpy.mock.calls[2]?.[2] as Record<string, string>;
    expect(autoHeaders["Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    postSpy.mockRestore();
  });
});
