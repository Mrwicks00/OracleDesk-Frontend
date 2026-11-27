"use client";

import React, { memo, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { VirtualTableBody } from "@/components/ui/virtual-list";
import {
  INTEGRITY_CLASSES,
  RESOLUTION_CLASSES,
  findingKey,
  isDriftAction,
  isDriftClass,
  type DriftFinding,
} from "@/lib/admin/drift";
import { downloadTextFile, exportFindingsCsv, exportFindingsJson } from "@/lib/admin/export";
import type { RecheckResult } from "@/lib/admin/recheck";
import { useRecheck, useReconcileRun } from "@/lib/hooks/useReconciliation";
import { formatHashHex } from "@/lib/stellar/market-question";
import { parseOnChainMarketId, routes } from "@/lib/routes";

type Finding = DriftFinding;

const MAX_FINDINGS = 5_000;

interface FindingRowProps {
  finding: Finding;
  index: number;
  recheck: RecheckResult | undefined;
  showPriceRechecks: boolean;
  onCheck: (finding: Finding) => void;
}

function json(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  return JSON.stringify(value, (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry));
}

function hash(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    const parts = ["questionHash", "resolutionHash", "metaUri", "status", "currentYesProb"]
      .filter((key) => object[key] !== undefined)
      .map((key) => `${key}: ${hash(object[key])}`);
    return parts.join(" · ") || json(value);
  }
  if (typeof value === "string" && /^[0-9a-f]{64}$/i.test(value)) {
    return formatHashHex(value) ?? value;
  }
  return String(value);
}

function closeTime(value: unknown): string {
  const object = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const seconds = typeof object.closeTime === "number"
    ? object.closeTime
    : typeof object.expiryTimestamp === "number"
      ? object.expiryTimestamp
      : null;
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  return `${new Date(seconds * 1_000).toISOString()} (${seconds})`;
}

function classLabel(value: string): string {
  return isDriftClass(value) ? value : "unknown class";
}

function actionLabel(value: string): string {
  return isDriftAction(value) ? value : "unknown action";
}

function badgeClass(value: string): string {
  if (!isDriftClass(value)) return "bg-error-container text-on-error-container";
  if (INTEGRITY_CLASSES.has(value)) return "bg-error-container text-on-error-container";
  if (RESOLUTION_CLASSES.has(value)) return "bg-tertiary-container text-on-tertiary-container";
  return "bg-surface-container-highest text-on-surface-variant";
}

function recheckLabel(result: RecheckResult | undefined): string {
  if (!result) return "Not checked";
  if (result.status === "still-holds") return "Still holds";
  if (result.status === "resolved") return "Resolved";
  if (result.status === "changed") return `Changed · ${result.detail}`;
  return `Unverifiable · ${result.reason}`;
}

function recheckClass(result: RecheckResult | undefined): string {
  if (!result) return "text-on-surface-variant";
  if (result.status === "resolved") return "text-secondary";
  if (result.status === "still-holds") return "text-error";
  return "text-on-surface-variant";
}

const FindingRow = memo(function FindingRow({
  finding,
  index,
  recheck,
  showPriceRechecks,
  onCheck,
}: FindingRowProps) {
  const hiddenPrice = finding.driftClass === "PRICE_STALE" && !showPriceRechecks;
  return (
    <tr className="border-b border-outline-variant align-top">
      <td className="px-3 py-2 font-data-mono text-xs">
        <span className={`px-1.5 py-0.5 rounded ${badgeClass(finding.driftClass)}`}>{classLabel(finding.driftClass)}</span>
      </td>
      <td className="px-3 py-2 font-data-mono text-xs">{actionLabel(finding.action)}</td>
      <td className="px-3 py-2 font-data-mono text-xs">
        {(() => {
          const onChainId = parseOnChainMarketId(finding.onChainMarketId);
          return onChainId ? (
            <Link className="text-primary underline" href={routes.marketsQuickView({ onChainId })}>
              {finding.onChainMarketId}
            </Link>
          ) : (
            <span>{finding.onChainMarketId}</span>
          );
        })()}
        <div className="text-[10px] text-on-surface-variant">{finding.marketId}</div>
      </td>
      <td className="px-3 py-2 text-xs break-all">{hash(finding.dbValue)}</td>
      <td className="px-3 py-2 text-xs break-all">{hash(finding.chainValue)}</td>
      <td className="px-3 py-2 font-data-mono text-xs">{closeTime(finding.dbValue)}<br />{closeTime(finding.chainValue)}</td>
      <td className="px-3 py-2 font-data-mono text-xs">{finding.observedLedger}</td>
      <td className="px-3 py-2 text-xs">
        <span className={recheckClass(recheck)}>{hiddenPrice ? "Hidden" : recheckLabel(recheck)}</span>
        {!hiddenPrice && (
          <button
            type="button"
            className="block text-primary underline mt-1"
            onClick={() => onCheck(finding)}
          >
            Check
          </button>
        )}
      </td>
      <td className="px-3 py-2 font-data-mono text-xs">{finding.id ?? `row-${index}`}</td>
    </tr>
  );
});

function Chip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-surface-container-low rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase text-on-surface-variant">{label}</div>
      <div className="font-data-mono text-data-mono">{value}</div>
    </div>
  );
}

export function ReconcileRunDetail({ runId }: { runId: string | null }) {
  const queryClient = useQueryClient();
  const {
    data: runData,
    isLoading,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useReconcileRun(runId);
  const [classFilter, setClassFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [integrityOnly, setIntegrityOnly] = useState(false);
  const [marketFilter, setMarketFilter] = useState("");
  const [showPriceRechecks, setShowPriceRechecks] = useState(false);
  const [visibleCount, setVisibleCount] = useState(200);

  const pages = useMemo(() => runData?.pages ?? [], [runData?.pages]);
  const findings = useMemo(() => pages.flatMap((page) => page.findings), [pages]);
  const findingIndices = useMemo(() => new Map(findings.map((finding, index) => [finding, index])), [findings]);
  const run = pages[0]?.run;
  const total = pages[0]?.meta?.total ?? findings.length;
  const recheck = useRecheck(findings);

  useEffect(() => {
    const target = Math.min(visibleCount, MAX_FINDINGS);
    if (findings.length < target && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [findings.length, hasNextPage, isFetchingNextPage, fetchNextPage, visibleCount]);

  const filtered = useMemo(() => {
    const needle = marketFilter.trim();
    return findings.filter((finding) => {
      if (classFilter && finding.driftClass !== classFilter) return false;
      if (actionFilter && finding.action !== actionFilter) return false;
      if (integrityOnly && !(isDriftClass(finding.driftClass) && INTEGRITY_CLASSES.has(finding.driftClass))) return false;
      if (needle && !finding.onChainMarketId.includes(needle) && !finding.marketId.includes(needle)) return false;
      return true;
    });
  }, [findings, classFilter, actionFilter, integrityOnly, marketFilter]);

  const displayed = filtered.slice(0, Math.min(visibleCount, MAX_FINDINGS));
  const mislinked = useMemo(() => {
    const byMarket = new Map<string, Set<string>>();
    for (const finding of findings) {
      const set = byMarket.get(finding.onChainMarketId) ?? new Set<string>();
      set.add(finding.driftClass);
      byMarket.set(finding.onChainMarketId, set);
    }
    return [...byMarket.values()].some((set) => set.has("CLOSE_TIME_MISMATCH") && set.has("HASH_MISMATCH"));
  }, [findings]);

  const checkFinding = (finding: Finding) => {
    void queryClient.refetchQueries({ queryKey: ["stellar", "recheck", finding.onChainMarketId] });
  };

  if (!runId) {
    return <p className="p-6 text-sm text-on-surface-variant">Select a run to inspect its findings.</p>;
  }
  if (isLoading) {
    return <p className="p-6 text-sm text-on-surface-variant animate-pulse">Loading reconciliation run…</p>;
  }
  if (isError) {
    return (
      <div className="p-6 text-sm text-error">
        <p>Couldn&apos;t load the run: {error instanceof Error ? error.message : "unknown error"}</p>
        <button type="button" className="underline mt-2" onClick={() => void refetch()}>Retry</button>
      </div>
    );
  }
  if (!run) return null;

  const lockHeld = Boolean(run.error?.includes("another instance is reconciling"));

  return (
    <section className="bg-white border border-outline-variant rounded-xl overflow-hidden" aria-label="Reconciliation run detail">
      <div className="p-5 border-b border-outline-variant space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-headline-sm text-headline-sm font-data-mono break-all">{run.id}</h2>
            <p className="text-xs text-on-surface-variant">
              {new Date(run.startedAt).toLocaleString()}
              {run.finishedAt ? ` → ${new Date(run.finishedAt).toLocaleString()}` : " → running"}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="border border-outline rounded-lg px-3 py-2 text-xs"
              onClick={() => void recheck.refetch()}
              disabled={recheck.isFetching}
            >
              Check all
            </button>
            <button
              type="button"
              className="border border-outline rounded-lg px-3 py-2 text-xs"
              onClick={() => downloadTextFile(`reconcile-${run.id}.csv`, exportFindingsCsv(findings, recheck.data), "text/csv")}
            >
              Export CSV
            </button>
            <button
              type="button"
              className="border border-outline rounded-lg px-3 py-2 text-xs"
              onClick={() => downloadTextFile(`reconcile-${run.id}.json`, exportFindingsJson(findings, recheck.data), "application/json")}
            >
              Export JSON
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Chip label="Scanned" value={run.scanned} />
          <Chip label="Repaired" value={run.repaired} />
          <Chip label="Reported" value={run.reported} />
          <Chip label="Deferred" value={run.deferred} />
          <Chip label="RPC calls" value={run.rpcCalls} />
        </div>
        {run.error && (
          <p role="status" className={`text-xs ${lockHeld ? "text-on-surface-variant" : "text-error"}`}>
            {lockHeld ? "Skipped (lock held): " : "Error: "}{run.error}
          </p>
        )}
        {mislinked && (
          <p role="note" className="text-xs text-error">
            Possible mislinked market: close-time and hash mismatches occur together.
          </p>
        )}
      </div>

      <div className="p-4 border-b border-outline-variant flex flex-wrap gap-3 items-end text-xs">
        <label className="flex flex-col gap-1">
          Drift class
          <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)} className="bg-surface border border-outline-variant rounded px-2 py-1">
            <option value="">All</option>
            {[...new Set(findings.map((finding) => finding.driftClass))].map((value) => (
              <option key={value} value={value}>{classLabel(value)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Action
          <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} className="bg-surface border border-outline-variant rounded px-2 py-1">
            <option value="">All</option>
            {[...new Set(findings.map((finding) => finding.action))].map((value) => (
              <option key={value} value={value}>{actionLabel(value)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Market id
          <input value={marketFilter} onChange={(event) => setMarketFilter(event.target.value)} className="bg-surface border border-outline-variant rounded px-2 py-1 font-data-mono" />
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={integrityOnly} onChange={(event) => setIntegrityOnly(event.target.checked)} />
          Integrity only
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showPriceRechecks} onChange={(event) => setShowPriceRechecks(event.target.checked)} />
          Show price re-checks
        </label>
        <button
          type="button"
          className="border border-outline rounded-lg px-3 py-2"
          onClick={() => setVisibleCount(Math.min(total, MAX_FINDINGS))}
        >
          Load all (up to {MAX_FINDINGS.toLocaleString()})
        </button>
        <span className="text-on-surface-variant">Showing {displayed.length} of {total} findings</span>
      </div>

      {filtered.length === 0 ? (
        <p className="p-6 text-sm text-on-surface-variant">No findings match these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead className="bg-surface-container-low text-on-surface-variant text-[11px] uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2">Class</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Market</th>
                <th className="px-3 py-2">DB value</th>
                <th className="px-3 py-2">Chain value</th>
                <th className="px-3 py-2">Close time</th>
                <th className="px-3 py-2">Ledger</th>
                <th className="px-3 py-2">Re-check</th>
                <th className="px-3 py-2">Id</th>
              </tr>
            </thead>
            <VirtualTableBody
              items={displayed}
              getKey={(finding, index) => finding.id ?? `${run.id}:${index}`}
              estimateSize={() => 96}
              colSpan={9}
              renderRow={(finding, index) => (
                <FindingRow
                  finding={finding}
                  index={index}
                  recheck={recheck.data.get(findingKey(finding, findingIndices.get(finding) ?? index))}
                  showPriceRechecks={showPriceRechecks}
                  onCheck={checkFinding}
                />
              )}
            />
          </table>
        </div>
      )}
    </section>
  );
}
