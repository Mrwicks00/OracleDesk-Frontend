import { apiClient, apiPath, type ApiRequestOptions } from "./client";
import { assertValid, parseTxHash, parseUuid } from "@/lib/validation/ids";
import { CopyTradeInitSchema } from "./schemas";

/** What the wallet must sign to copy a trace: market_core.buy. */
export interface CopyTradePayload {
  contractId: string;
  onChainMarketId: string;
  outcome: "Yes" | "No";
  collateralInRaw: string;
  userWallet: string;
  traceReference: string | null;
}

export interface InitiateCopyTradeParams {
  traceId: string;
  marketId: string;
  /** 7-decimal USDC base units, as a decimal string. */
  amountRaw: string;
}

export interface CopyTradeRecord {
  id: string;
  userId: string;
  traceId: string;
  marketId: string;
  direction: "YES" | "NO";
  amount: number;
  amountRaw: string | null;
  status: "PENDING" | "EXECUTED" | "FAILED";
  txHash?: string | null;
}

export async function initiateCopyTrade(params: InitiateCopyTradeParams, options?: ApiRequestOptions) {
  const idempotencyKey = options?.idempotencyKey ?? crypto.randomUUID();
  const { data } = await apiClient.post<{
    copyTradeId: string;
    transactionPayload: CopyTradePayload;
    instructions: string;
  }>("/trade/copy", params, { "Idempotency-Key": idempotencyKey }, { ...options, schema: CopyTradeInitSchema });

  return data;
}

export async function confirmCopyTrade(id: string, txHash: string, options?: ApiRequestOptions) {
  const copyTradeId = assertValid(parseUuid(id), "copy trade id");
  const hash = assertValid(parseTxHash(txHash), "transaction hash");
  // Deterministic idempotency key so duplicate confirms across tabs or retries are harmless.
  const idempotencyKey = `copy-confirm:${copyTradeId}:${hash.toLowerCase()}`;
  const { data } = await apiClient.patch<CopyTradeRecord>(apiPath`/trade/copy/${copyTradeId}/confirm`, {
    txHash: hash,
  }, { "Idempotency-Key": idempotencyKey }, options);

  return data;
}
