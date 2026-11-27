"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useWallet } from "@/lib/contexts/WalletContext";
import { useUserScope, useUserScopeStore, ScopeChangedError } from "@/lib/query/scope";
import { initiateCopyTrade, confirmCopyTrade } from "@/lib/api/trade";
import { reportError } from "@/lib/observability/report";
import { CONTRACTS } from "@/lib/stellar/config";
import { checkTransaction } from "@/lib/stellar/tx-lifecycle";
import { describeError } from "@/lib/stellar/errors";
import { formatErrorWithReference, withOperation } from "@/lib/observability/tracing";
import { track } from "@/lib/observability/analytics";
import type { Outcome } from "@/lib/observability/analytics-events";
import { useBuy, type BuyParams, type PreparedBuy } from "./useStellar";
import {
  appendOutboxEntry, emptyOutbox, isTerminal, MAX_OUTBOX_ENTRIES, readOutbox, reconcileOutboxEntryCrossTab, refreshOutbox,
  subscribeOutbox, updateOutbox, type OutboxEntry,
} from "@/lib/copy-trade/outbox";

export { verifyCopyBuy } from "@/lib/copy-trade/outbox";
const inFlight = new Set<string>();
/** Copy trade ids already reported (one `copy_trade_completed` per trade). */
const reportedCompletions = new Set<string>();

/**
 * Issue #125: exactly one `copy_trade_completed` per copy trade id — a failure
 * in `run()` and a later reconciler confirm must not both report. Failures
 * before the backend issued an id have no id to dedupe on and always report.
 */
function reportCompletion(copyTradeId: string | null, outcome: Outcome, confirmRecorded: boolean): void {
  if (copyTradeId !== null) {
    if (reportedCompletions.has(copyTradeId)) return;
    reportedCompletions.add(copyTradeId);
  }
  track("copy_trade_completed", { outcome, confirmRecorded });
}

export function useCopyTradeOutbox() {
  const { address } = useWallet();
  const entries = useSyncExternalStore(subscribeOutbox, () => readOutbox(address), emptyOutbox);
  return {
    entries,
    needsSession: entries.some((entry) => entry.needsSession && !isTerminal(entry) && !entry.dismissed),
    retry: (id: string) => { if (address) updateOutbox(address, id, { nextAttemptAt: 0 }); },
    dismiss: (id: string) => { if (address) updateOutbox(address, id, { dismissed: true }); },
  };
}

/** Mounted once in the root layout; panels only observe this persisted store. */
export function useCopyTradeReconciler() {
  const { address, isWrongNetwork, rpcNetwork } = useWallet();
  const scope = useUserScope(); const store = useUserScopeStore();
  useEffect(() => {
    if (!address || isWrongNetwork || rpcNetwork.status === "mismatch") return;
    let live = true;
    const tick = async () => {
      if (!live || document.hidden) return;
      for (const entry of readOutbox(address)) {
        if (!live || isTerminal(entry) || entry.dismissed) continue;
        const id = `${address}:${entry.copyTradeId}`;
        if (inFlight.has(id)) continue;
        inFlight.add(id);
        const ticket = store?.capture(scope);
        try {
          ticket?.assertCurrent();
          await reconcileOutboxEntryCrossTab(address, entry.copyTradeId, {
            now: Date.now,
            sessionId: scope.sessionId,
            check: checkTransaction,
            confirm: async (copyTradeId, hash) => {
              const confirmed = await confirmCopyTrade(copyTradeId, hash, { expectScope: scope, signal: ticket?.signal });
              // Issue #125: the backend recorded it — the one completion event
              // for this trade. Failures are reported by `run()`'s catch (first
              // outcome wins, deduped by copyTradeId); a failed confirm is
              // retried by this reconciler and is not a trade outcome.
              reportCompletion(copyTradeId, "success", true);
              return confirmed;
            },
            assertCurrent: () => { ticket?.assertCurrent(); },
          });
        } catch (error) {
          // Cancelled scope: the next connection owns the next attempt.
          // Everything else (recording/confirmation failures, unreachable
          // backend) must reach the reporter instead of vanishing (issue #123).
          const name = (error as { name?: string } | null)?.name;
          if (!(error instanceof ScopeChangedError) && name !== "AbortError") {
            reportError(error, { feature: "copy-trade" });
          }
        }
        finally { inFlight.delete(id); }
      }
    };
    const wake = () => { void tick(); };
    const timer = window.setInterval(wake, 1_000);
    const first = window.setTimeout(wake, 0);
    const off = subscribeOutbox(wake);
    const onStorage = (event: StorageEvent) => { if (event.key === `oracledesk_copy_outbox:${address}`) refreshOutbox(address); };
    document.addEventListener("visibilitychange", wake); window.addEventListener("storage", onStorage);
    return () => { live = false; clearInterval(timer); clearTimeout(first); off(); document.removeEventListener("visibilitychange", wake); window.removeEventListener("storage", onStorage); };
  }, [address, scope, store, isWrongNetwork, rpcNetwork.status]);
}

export function useCopyTrade() {
  const wallet = useWallet(); const store = useUserScopeStore(); const buy = useBuy();
  const run = async (input: BuyParams & { traceId: string; backendMarketId: string; prepared?: PreparedBuy }) =>
    // Issue #124: one trace across initiation, recording and signing, and a
    // reference the user can quote when any of them fails.
    withOperation("copy-trade", async (opCtx) => {
      const withReference = (error: unknown): unknown => {
        if (error instanceof Error && !(error instanceof ScopeChangedError)) {
          error.message = formatErrorWithReference(error, opCtx.traceId);
        }
        return error;
      };
      // Known only after the backend issues the trade; lets the failure report
      // below dedupe against a later reconciler confirm (issue #125).
      let copyTradeId: string | null = null;
      try {
        const trader = wallet.address;
        if (!trader || !(await wallet.ensureSession())) throw new Error("Sign in with your wallet to copy trades.");
        const scope = store?.getSnapshot();
        if (scope && scope.wallet !== trader) throw new ScopeChangedError();
        const ticket = store?.capture(scope);
        ticket?.assertCurrent();
        if (readOutbox(trader).filter((entry) => !isTerminal(entry) && !entry.dismissed).length >= MAX_OUTBOX_ENTRIES) {
          throw new Error("Finish or dismiss a pending copy trade before starting another.");
        }
        const idempotencyKey = crypto.randomUUID();
        const intent = await initiateCopyTrade(
          { traceId: input.traceId, marketId: input.backendMarketId, amountRaw: input.collateralIn.toString() },
          { expectScope: scope, signal: ticket?.signal, idempotencyKey },
        );
        ticket?.assertCurrent();
        const payload = intent.transactionPayload;
        const entry: OutboxEntry = {
          copyTradeId: intent.copyTradeId, traceId: input.traceId, marketId: input.backendMarketId,
          onChainMarketId: payload.onChainMarketId, outcome: payload.outcome, collateralInRaw: payload.collateralInRaw,
          state: "initiated", txHash: null, attempts: 0, nextAttemptAt: 0, createdAt: Date.now(),
        };
        copyTradeId = entry.copyTradeId;
        // Issue #228: gate on durable storage before signing; also refuse if outbox write failed
        const { assertDurableStorage } = await import("@/lib/storage/quota");
        await assertDurableStorage("copy-trade");
        const durable = appendOutboxEntry(trader, entry);
        if (!durable) {
          throw new Error("Storage unavailable: could not record this trade. Clear browser data or try again.");
        }
        // Never sign a changed backend payload without another explicit review.
        if (payload.userWallet !== trader || payload.contractId !== CONTRACTS.marketCore ||
            payload.onChainMarketId !== String(input.marketId) || payload.outcome !== input.outcome || payload.collateralInRaw !== input.collateralIn.toString()) {
          updateOutbox(trader, entry.copyTradeId, { state: "abandoned", lastError: "The server's copy-trade payload changed. Review the trade again." });
          throw new Error("The server's copy-trade payload does not match your reviewed trade.");
        }
        try {
          ticket?.assertCurrent();
          const result = await buy.mutateAsync({ ...input, onSigned: (hash) => {
            updateOutbox(trader, entry.copyTradeId, { state: "signed", txHash: hash.toLowerCase(), nextAttemptAt: 0 });
            input.onSigned?.(hash);
          } });
          updateOutbox(trader, entry.copyTradeId, { state: "signed", txHash: result.txHash, nextAttemptAt: 0,
            lastError: result.txHash ? undefined : "No transaction hash was returned. Check your account history." });
          ticket?.assertCurrent();
          // Chain finality is independent of backend recording. The root worker
          // confirms it without holding up this result or asking for another buy.
          return { ...result, recording: "pending" as const, copyTradeId: entry.copyTradeId, durable };
        } catch (error) {
          // Keep the failure with its scope: initiation, review mismatch and
          // signing errors all land here and previously only reached the status line.
          if (!(error instanceof ScopeChangedError) && (error as { name?: string } | null)?.name !== "AbortError") {
            reportError(error, { feature: "copy-trade", contract: "marketCore" });
          }
          const saved = readOutbox(trader).find((e) => e.copyTradeId === entry.copyTradeId);
          if (!saved?.txHash) {
            updateOutbox(trader, entry.copyTradeId, { state: "abandoned", lastError: describeError(error).message });
          } else {
            updateOutbox(trader, entry.copyTradeId, { state: "signed", lastError: "Submission could not be confirmed yet. Checking the saved hash automatically." });
          }
          throw error;
        }
      } catch (error) {
        // Issue #125: one completion event per copy trade attempt — a failure
        // ends it here; a success is reported when the backend confirms the
        // recording (the reconciler's `confirm` above). A cancelled scope or
        // an aborted request is not a trade outcome.
        if (!(error instanceof ScopeChangedError) && (error as { name?: string } | null)?.name !== "AbortError") {
          reportCompletion(copyTradeId, describeError(error).kind, false);
        }
        throw withReference(error);
      }
    });
  return { run, phase: buy.phase, isPending: buy.isPending };
}
