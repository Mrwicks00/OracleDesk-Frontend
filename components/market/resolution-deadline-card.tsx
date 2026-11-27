"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWalletAddress } from "@/lib/contexts/WalletContext";
import { useViewedAddress } from "@/lib/hooks/useViewedAddress";
import {
  useExpireMarket,
  useExpiryPreview,
  useOpenFallback,
  usePosition,
  useRedeem,
  useResolutionDeadline,
} from "@/lib/hooks/useStellar";
import { useLedgerNow } from "@/lib/stellar/ledger-clock";
import { settleValue } from "@/lib/stellar/generated/fpmm";
import { formatUsdcDisplay } from "@/lib/format/money";
import { supportsExpiryAndFallback, type ExpiryEffect } from "@/lib/stellar/resolution-deadline";
import { userMessage } from "@/lib/errors/display";
import { Term } from "@/components/ui/term";

function formatCountdown(targetSec: bigint, nowSec: number | null, uncertaintySec: number): string {
  if (nowSec === null) return "syncing ledger time…";
  const diff = Number(targetSec) - Math.floor(nowSec);
  const unc = Math.max(1, Math.ceil(uncertaintySec));
  if (diff <= 0) return `passed (± ${unc} s)`;
  const days = Math.floor(diff / 86_400);
  const hours = Math.floor((diff % 86_400) / 3_600);
  const mins = Math.floor((diff % 3_600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return `in ${parts.join(" ")} (± ${unc} s)`;
}

function formatLedgerTime(tsSec: bigint): string {
  return new Date(Number(tsSec) * 1000).toLocaleString();
}

export function ResolutionDeadlineCard({
  onChainMarketId,
}: {
  onChainMarketId: bigint | string | null | undefined;
}) {
  const { address } = useWalletAddress();
  const { isWatching } = useViewedAddress();
  const ledger = useLedgerNow();
  const deadline = useResolutionDeadline(onChainMarketId);
  const position = usePosition(onChainMarketId, address);
  const expireMut = useExpireMarket();
  const fallbackMut = useOpenFallback();
  const redeemMut = useRedeem();

  const [confirmMode, setConfirmMode] = useState<"expire" | "fallback" | null>(null);
  const [doneEffect, setDoneEffect] = useState<ExpiryEffect | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const view = deadline.data;
  const canTryExpire = view?.phase === "expirable";
  const canTryFallback = view?.phase === "fallback-openable";

  const expirePreview = useExpiryPreview(onChainMarketId, "expire", Boolean(canTryExpire));
  const fallbackPreview = useExpiryPreview(onChainMarketId, "fallback", Boolean(canTryFallback));

  const activeMode = canTryExpire ? "expire" : canTryFallback ? "fallback" : null;
  const activePreview = activeMode === "expire" ? expirePreview.data : activeMode === "fallback" ? fallbackPreview.data : undefined;

  const holderPayout = useMemo(() => {
    const pos = position.data?.value;
    if (!pos || !activePreview?.ok) return null;
    if (activePreview.effect.kind === "void") {
      return settleValue("void", pos.yes, pos.no);
    }
    if (activePreview.effect.kind === "resolve") {
      return settleValue(activePreview.effect.outcome === "Yes" ? "yes" : "no", pos.yes, pos.no);
    }
    return null;
  }, [position.data, activePreview]);

  if (!onChainMarketId || !supportsExpiryAndFallback()) return null;
  if (!view || view.phase === "terminal" || view.phase === "open") return null;

  const canWrite = Boolean(address) && !isWatching;

  const runConfirmed = async () => {
    if (!activeMode || !activePreview?.ok) return;
    setActionError(null);
    try {
      if (activeMode === "expire") {
        const res = await expireMut.mutateAsync({
          marketId: onChainMarketId,
          expectedEffect: activePreview.effect,
        });
        setDoneEffect(res.effect);
      } else {
        const res = await fallbackMut.mutateAsync({
          marketId: onChainMarketId,
          expectedEffect: activePreview.effect,
        });
        setDoneEffect(res.effect);
      }
      setConfirmMode(null);
    } catch (err) {
      setActionError(userMessage(err));
    }
  };

  return (
    <div className="p-4 bg-surface-container-low rounded-lg border border-outline-variant/60 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
          Resolution Deadline (Ledger Time)
        </span>
        <span className="font-data-mono text-xs text-on-surface">
          {formatLedgerTime(view.resolutionDeadline)} · {formatCountdown(view.resolutionDeadline, ledger.now, ledger.uncertainty)}
        </span>
      </div>

      {view.fallbackOpensAt !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant">
          <span>Hybrid fallback opens</span>
          <span className="font-data-mono">
            {formatLedgerTime(view.fallbackOpensAt)} · {formatCountdown(view.fallbackOpensAt, ledger.now, ledger.uncertainty)}
          </span>
        </div>
      )}

      {view.phase === "deadline-near" && (
        <p className="text-xs font-medium text-amber-900 bg-amber-500/10 border border-amber-500/30 rounded p-2.5">
          Resolution deadline is approaching. If the market is not resolved by then, anyone can expire it.
        </p>
      )}

      {view.phase === "expirable" && (
        <p className="text-xs font-medium text-error bg-error-container/30 border border-error/30 rounded p-2.5">
          This market is past its resolution deadline and appears stuck.
        </p>
      )}

      {view.phase === "fallback-openable" && (
        <p className="text-xs font-medium text-primary bg-primary/10 border border-primary/20 rounded p-2.5">
          The price feed fallback window has opened. Anyone can trigger fallback resolution.
        </p>
      )}

      {activePreview && !activePreview.ok && (
        <div className="text-xs text-on-surface-variant bg-white border border-outline-variant rounded p-2.5">
          {activePreview.reason === "ResolutionAvailable" ? (
            <span>
              A quorum resolution proposal is available to finalize.{" "}
              <Link href="/admin" className="underline text-primary font-bold">
                Go to finalization
              </Link>
            </span>
          ) : activePreview.reason === "DisputeActive" ? (
            <span>Dispute in progress — expiry is blocked until resolved.</span>
          ) : (
            <span>{activePreview.detail}</span>
          )}
        </div>
      )}

      {activePreview?.ok && canWrite && !doneEffect && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-xs text-on-surface-variant">
            {activePreview.effect.kind === "void" ? (
              <span>Simulation proves this will <Term id="void">void</Term> the market.</span>
            ) : activePreview.effect.kind === "resolve" ? (
              `Simulation proves this will resolve the market as ${activePreview.effect.outcome}.`
            ) : (
              "Simulation proves this will open signer fallback."
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              setActionError(null);
              setConfirmMode(activeMode);
            }}
            className="bg-primary text-primary-foreground px-3 py-1.5 rounded text-xs font-bold font-label-caps"
          >
            {activeMode === "expire" ? "Expire market" : "Open fallback"}
          </button>
        </div>
      )}

      {doneEffect && (doneEffect.kind === "void" || doneEffect.kind === "resolve") && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-secondary/10 border border-secondary/30 rounded p-2.5 text-xs">
          <span className="font-medium text-secondary">
            Market {doneEffect.kind === "void" ? "voided" : `resolved (${doneEffect.outcome})`}.
          </span>
          <button
            type="button"
            disabled={redeemMut.isPending}
            onClick={() => void redeemMut.mutateAsync({ marketId: onChainMarketId })}
            className="bg-secondary text-secondary-foreground px-3 py-1 rounded font-bold"
          >
            {redeemMut.isPending ? "Redeeming…" : "Redeem now"}
          </button>
        </div>
      )}

      <Dialog open={confirmMode !== null} onOpenChange={(open) => { if (!open) setConfirmMode(null); }}>
        <DialogContent>
          <DialogTitle>
            {confirmMode === "expire" ? "Confirm Expire Market" : "Confirm Open Fallback"}
          </DialogTitle>
          <DialogDescription>
            This action is irreversible and permissionless. The transaction fee is paid by your wallet.
          </DialogDescription>
          {activePreview?.ok && (
            <div className="space-y-2 text-xs py-2">
              <p>
                <strong>Simulated effect:</strong>{" "}
                {activePreview.effect.kind === "void" ? (
                  <span><Term id="void">Void</Term> market (collateral returned proportionally)</span>
                ) : activePreview.effect.kind === "resolve" ? (
                  `Resolve market as ${activePreview.effect.outcome}`
                ) : (
                  "Open hybrid signer fallback"
                )}
              </p>
              {holderPayout !== null && (
                <p>
                  <strong>Your estimated payout:</strong>{" "}
                  <span className="font-data-mono font-bold">{formatUsdcDisplay(holderPayout)}</span>
                </p>
              )}
            </div>
          )}
          {actionError && <p role="alert" className="text-xs text-error">{actionError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setConfirmMode(null)}
              className="px-3 py-1.5 rounded border border-outline-variant text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={expireMut.isPending || fallbackMut.isPending}
              onClick={() => void runConfirmed()}
              className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50"
            >
              {expireMut.isPending || fallbackMut.isPending ? "Submitting…" : "Confirm & Sign"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
