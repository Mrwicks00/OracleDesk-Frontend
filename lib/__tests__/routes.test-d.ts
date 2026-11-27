import { describe, it } from "vitest";
import {
  type BackendMarketId,
  type OnChainMarketId,
  type OnChainTraceId,
  type TraceId,
  type TxHash,
  routes,
} from "../routes";

describe("route builder branded id type safety", () => {
  it("rejects mixing id kinds at compile time", () => {
    const backendMarketId = "8c1f0a2b-1111-4222-8333-444455556666" as BackendMarketId;
    const onChainMarketId = "42" as OnChainMarketId;
    const traceId = "8c1f0a2b-1111-4222-8333-444455556666" as TraceId;
    const onChainTraceId = "7" as OnChainTraceId;
    const txHash = "a".repeat(64) as TxHash;

    // @ts-expect-error BackendMarketId cannot be passed as onChainId
    routes.marketsQuickView({ onChainId: backendMarketId });

    // @ts-expect-error OnChainMarketId cannot be passed as marketId
    routes.marketsQuickView({ marketId: onChainMarketId });

    // @ts-expect-error TraceId cannot be passed as marketId
    routes.copyTrade({ marketId: traceId });

    // @ts-expect-error BackendMarketId cannot be passed as traceId
    routes.copyTrade({ traceId: backendMarketId });

    // @ts-expect-error OnChainMarketId cannot be passed as onChainTraceId
    routes.reasoningVerify({ onChainTraceId: onChainMarketId });

    // @ts-expect-error OnChainTraceId cannot be passed as onChainMarketId
    routes.reasoningVerify({ onChainMarketId: onChainTraceId });

    // @ts-expect-error raw string cannot be passed as TxHash
    routes.tx("not-branded");

    // Valid calls compile cleanly:
    routes.marketsQuickView({ marketId: backendMarketId, onChainId: onChainMarketId });
    routes.tx(txHash);
  });
});
