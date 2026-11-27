"use client";

import React from "react";
import Link from "next/link";
import { explorerTx } from "@/lib/stellar/config";
import type { LifecycleEntry } from "@/lib/stellar/market-lifecycle";
import { useMarketLifecycle } from "@/lib/hooks/useMarketLifecycle";
import { Ltr } from "@/components/ui/ltr";
import { parseRouteTxHash, routes } from "@/lib/routes";

const SOURCE_LABELS: Record<LifecycleEntry["source"], string> = {
  "market-core": "market-core",
  registry: "registry",
  resolver: "resolver",
  state: "state-derived",
};

function describeEntry(entry: LifecycleEntry): string {
  const d = entry.detail;
  switch (entry.kind) {
    case "created":
      return d.stateDerived === "true"
        ? `Market created (state-derived; closes ${d.closeTime})`
        : `Market created (seed ${d.seedAmount} USDC, initial YES ${d.initialYesBps} bps)`;
    case "trace":
      return `Reasoning trace #${d.traceId} (${d.action})${d.stateDerived === "true" ? " · state-derived" : ""}`;
    case "trades":
      return `${d.count} trade(s) · Buy ${d.buyCollateral} USDC / Sell ${d.sellCollateral} USDC · YES ${d.yesBpsBefore} → ${d.yesBpsAfter} bps`;
    case "price-resolution":
      return `Oracle price resolution: ${d.outcome}${d.groupedWithTx ? " (same tx as MarketResolved)" : ""}`;
    case "proposed":
      return `Resolution proposed: ${d.outcome}`;
    case "finalized":
      return `Resolution finalized: ${d.outcome}`;
    case "resolved":
      return `Market resolved: ${d.outcome}${d.groupedWithTx ? " (same tx as PriceResolution)" : ""}`;
    case "voided":
      return `Market voided (${d.voidReason ?? "void"})`;
    case "redeemed":
      return `Redeemed ${d.payout} USDC`;
    case "fees-swept":
      return `Fees swept: ${d.amount} USDC`;
    case "pool-claimed":
      return d.stateDerived === "true"
        ? "Pool remainder claimed (state-derived)"
        : `Pool remainder claimed: ${d.amount} USDC`;
    case "closed":
      return "Market closed";
    case "retention-gap":
      return `History before ledger ${d.oldestLedger} is outside RPC retention`;
  }
}

export function LifecycleTimelineView({
  entries,
  partial,
  onLoadOlder,
}: {
  entries: readonly LifecycleEntry[];
  partial?: boolean;
  onLoadOlder?: () => void;
}) {
  if (!entries.length) {
    return (
      <p className="text-xs text-on-surface-variant">No lifecycle events available yet.</p>
    );
  }

  return (
    <ol className="space-y-3 border-s border-outline-variant ps-4" aria-label="Market lifecycle timeline">
      {entries.map((entry) => {
        const key = entry.eventIds.join(",") || `${entry.kind}-${entry.ledger ?? "state"}`;
        if (entry.kind === "retention-gap") {
          return (
            <li
              key={key}
              className="border-t border-b border-dashed border-outline-variant py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant"
            >
              <span>{describeEntry(entry)}</span>
              {partial && onLoadOlder && (
                <button
                  type="button"
                  onClick={onLoadOlder}
                  className="px-2.5 py-1 rounded border border-outline-variant bg-white text-primary font-bold hover:bg-surface-container-low"
                >
                  Load older
                </button>
              )}
            </li>
          );
        }

        const explorer = entry.txHash ? explorerTx(entry.txHash) : null;
        return (
          <li key={key} className="space-y-1 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-data-mono text-[11px] text-on-surface-variant">
                {entry.closedAt ? new Date(entry.closedAt).toLocaleString() : "Time unknown"}
                {entry.ledger !== null ? ` · Ledger ${entry.ledger}` : ""}
              </span>
              <span className="rounded bg-surface-container-highest px-1.5 py-0.5 text-[10px] font-bold uppercase text-on-surface-variant">
                {SOURCE_LABELS[entry.source]}
              </span>
              {entry.txHash && (
                <span className="inline-flex items-center gap-2">
                  {(() => {
                    const txHash = parseRouteTxHash(entry.txHash);
                    return txHash ? (
                      <Link
                        href={routes.tx(txHash)}
                        className="underline text-primary font-data-mono text-[11px]"
                      >
                        <Ltr>{entry.txHash.slice(0, 8)}…</Ltr>
                      </Link>
                    ) : null;
                  })()}
                  {explorer && (
                    <a
                      href={explorer}
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-on-surface-variant text-[11px]"
                    >
                      Explorer
                    </a>
                  )}
                </span>
              )}
            </div>
            <p className="text-on-surface">{describeEntry(entry)}</p>
          </li>
        );
      })}
    </ol>
  );
}

export function LifecycleTimeline({
  onChainMarketId,
}: {
  onChainMarketId: bigint | string | null | undefined;
}) {
  const { data, isLoading, isError, loadOlder } = useMarketLifecycle(onChainMarketId);

  return (
    <section
      aria-labelledby="lifecycle-timeline-heading"
      className="rounded-xl border border-outline-variant bg-surface p-4 space-y-3"
    >
      <h3 id="lifecycle-timeline-heading" className="font-headline-sm text-headline-sm text-on-surface">
        Market Lifecycle Timeline
      </h3>
      {isLoading && <p className="text-xs text-on-surface-variant">Loading contract lifecycle…</p>}
      {isError && <p className="text-xs text-error">Could not load market lifecycle events.</p>}
      {data && (
        <LifecycleTimelineView
          entries={data.entries}
          partial={data.partial}
          onLoadOlder={loadOlder}
        />
      )}
    </section>
  );
}
