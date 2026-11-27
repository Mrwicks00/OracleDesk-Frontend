"use client";

import { useEffect, useState } from "react";
import type { AgentType } from "@/lib/api/traces";
import { EMPTY_FILTERS, isEmptyFilters, type TraceFeedFilters, type Verification } from "@/lib/traces/feed-filters";
import {
  createSavedView,
  loadSavedViews,
  saveSavedViews,
  MAX_SAVED_VIEWS,
  type SavedTraceView,
} from "@/lib/traces/saved-views";
import { parseTraceFilters } from "@/lib/traces/feed-params";

interface FeedFilterBarProps {
  filters: TraceFeedFilters;
  onChange: (next: TraceFeedFilters) => void;
  /** Connected wallet address; saved views and the "held" filter need one. */
  wallet: string | null;
}

function AgentFilter({ value, onChange }: { value: string | undefined; onChange: (agent: string | undefined) => void }) {
  const [draft, setDraft] = useState(value ?? "");
  const [invalid, setInvalid] = useState(false);
  const apply = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setInvalid(false);
      onChange(undefined);
    } else if (/^G[A-Z2-7]{55}$/.test(trimmed)) {
      setInvalid(false);
      onChange(trimmed);
    } else {
      setInvalid(true);
    }
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-label-caps uppercase">Agent address</span>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={apply}
        onKeyDown={(event) => { if (event.key === "Enter") apply(); }}
        placeholder="G…"
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid || undefined}
        className="w-56 rounded border border-outline-variant bg-surface px-2 py-1 font-data-mono text-xs"
      />
      {invalid && <span role="alert" className="text-error text-xs">Enter a G… account address.</span>}
    </label>
  );
}

const VERIFICATION_OPTIONS: { value: Verification; label: string }[] = [
  { value: "verified", label: "Verified" },
  { value: "unchecked", label: "Not verified" },
];

export function FeedFilterBar({ filters, onChange, wallet }: FeedFilterBarProps) {
  const [views, setViews] = useState<SavedTraceView[]>([]);
  const [name, setName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setViews(wallet ? loadSavedViews(wallet) : []);
  }, [wallet]);

  const toggleVerification = (value: Verification) => {
    const current = filters.verification ?? [];
    const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
    onChange({ ...filters, verification: next.length > 0 ? next : undefined });
  };

  const saveView = () => {
    if (!wallet || name.trim() === "") return;
    if (views.length >= MAX_SAVED_VIEWS) {
      setSaveError(`You can save up to ${MAX_SAVED_VIEWS} views. Delete one first.`);
      return;
    }
    const next = [...views, createSavedView(name, filters)];
    const stored = saveSavedViews(wallet, next);
    setSaveError(stored ? null : "This browser can't save views right now.");
    if (stored) {
      setViews(next);
      setName("");
    }
  };

  const deleteView = (id: string) => {
    if (!wallet) return;
    const next = views.filter((view) => view.id !== id);
    if (saveSavedViews(wallet, next)) setViews(next);
  };

  return (
    <section aria-label="Filter traces" className="mb-6 rounded-lg border border-outline-variant bg-surface-container-low p-4 text-sm space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-label-caps uppercase">Agent type</span>
          <select
            value={filters.agentType ?? ""}
            onChange={(event) => onChange({ ...filters, agentType: (event.target.value || undefined) as AgentType | undefined })}
            className="rounded border border-outline-variant bg-surface px-2 py-1"
          >
            <option value="">All agents</option>
            <option value="MARKET_MAKER">Market maker</option>
            <option value="TRADER">Trader</option>
          </select>
        </label>

        <AgentFilter value={filters.agent} onChange={(agent) => onChange({ ...filters, agent })} />

        <label className="flex flex-col gap-1">
          <span className="text-xs font-label-caps uppercase">On chain</span>
          <select
            value={filters.onChain ?? ""}
            onChange={(event) => onChange({ ...filters, onChain: (event.target.value || undefined) as "yes" | "no" | undefined })}
            className="rounded border border-outline-variant bg-surface px-2 py-1"
          >
            <option value="">Any</option>
            <option value="yes">Published on chain</option>
            <option value="no">Not on chain</option>
          </select>
        </label>

        <fieldset className="flex flex-wrap gap-3">
          <legend className="text-xs font-label-caps uppercase">Verification</legend>
          {VERIFICATION_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={filters.verification?.includes(option.value) ?? false}
                onChange={() => toggleVerification(option.value)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(filters.held)}
            disabled={!wallet}
            onChange={(event) => onChange({ ...filters, held: event.target.checked || undefined })}
          />
          Markets I hold
          {!wallet && <span className="text-xs text-on-surface-variant">(connect a wallet)</span>}
        </label>

        {!isEmptyFilters(filters) && (
          <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="underline">
            Clear filters
          </button>
        )}
      </div>

      {wallet && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-label-caps uppercase">Save this view</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="View name"
                maxLength={60}
                className="rounded border border-outline-variant bg-surface px-2 py-1"
              />
            </label>
            <button type="button" onClick={saveView} disabled={name.trim() === ""} className="rounded border border-primary px-3 py-1 text-primary disabled:opacity-50">
              Save view
            </button>
            {saveError && <p role="alert" className="text-error">{saveError}</p>}
          </div>
          {views.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Saved views">
              {views.map((view) => (
                <li key={view.id} className="flex items-center gap-1 rounded border border-outline-variant px-2 py-1">
                  <button type="button" onClick={() => onChange(parseTraceFilters(new URLSearchParams(view.query)))} className="underline">
                    {view.name}
                  </button>
                  <button type="button" onClick={() => deleteView(view.id)} aria-label={`Delete view ${view.name}`} className="text-xs underline">
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
