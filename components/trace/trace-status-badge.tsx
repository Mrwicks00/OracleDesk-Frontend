"use client";

/**
 * Issue #307: TraceStatusBadge
 * Shows the on-chain verdict for a trace: Verified, Flagged, HashMismatch,
 * or AgentRevoked. Supplements hash verification; never replaces it.
 *
 * Watch-only compatible: read-only, no write actions.
 */

import React from "react";
import { useTraceFlag, useAgentRecord, traceVerdictLocal } from "@/lib/hooks/useRegistryModeration";

interface Props {
  /** On-chain trace id as a string of the u64 value */
  traceId?: string;
  /** Ethereum/Stellar address of the publishing agent */
  agentAddr?: string;
  /** Whether the locally computed hash matched the on-chain trace_hash */
  hashOk?: boolean;
  /** Ledger timestamp (u64) when the trace was published */
  publishedAt?: bigint;
  className?: string;
}

type Tone = "ok" | "warn" | "error" | "muted";

const TONE_CLASSES: Record<Tone, string> = {
  ok: "bg-secondary/10 text-secondary border border-secondary/20",
  warn: "bg-warning/10 text-warning-on border border-warning/20",
  error: "bg-error/10 text-error border border-error/20",
  muted: "bg-surface-container text-on-surface-variant border border-outline-variant",
};

function Badge({ label, tone, title }: { label: string; tone: Tone; title?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-label-caps font-medium ${TONE_CLASSES[tone]}`}
      title={title}
      aria-label={title ?? label}
    >
      {label}
    </span>
  );
}

/**
 * Renders a status chip based on the local trace verdict (hash → flag → revocation → valid).
 * The badge is null when trace data is unavailable (skips when traceId or agentAddr missing).
 */
export function TraceStatusBadge({ traceId, agentAddr, hashOk = true, publishedAt, className }: Props) {
  const flagQuery = useTraceFlag(traceId);
  const agentQuery = useAgentRecord(agentAddr);

  if (!traceId || !agentAddr) return null;

  // While loading, show nothing (don't flash a stale badge)
  if (flagQuery.isLoading || agentQuery.isLoading) {
    return (
      <span className={`inline-block w-16 h-4 rounded-full bg-surface-container animate-pulse ${className ?? ""}`} aria-hidden="true" />
    );
  }

  const flag = flagQuery.data ?? null;
  const agentState = agentQuery.data ?? { kind: "Unregistered" as const };
  const trace = { publishedAt: publishedAt ?? 0n, hashOk };

  const verdict = traceVerdictLocal(trace, flag, agentState);

  if (verdict === "HashMismatch") {
    return (
      <span className={className}>
        <Badge label="Hash mismatch" tone="error" title="The stored trace hash does not match the retrieved content. This trace may have been tampered with." />
      </span>
    );
  }

  if (typeof verdict === "object" && "Flagged" in verdict) {
    return (
      <span className={className}>
        <Badge label="Flagged" tone="warn" title={`Flagged by moderator: ${verdict.Flagged}`} />
      </span>
    );
  }

  if (typeof verdict === "object" && "AgentRevokedAfter" in verdict) {
    return (
      <span className={className}>
        <Badge
          label="Agent revoked"
          tone="error"
          title="The publishing agent was revoked effective before this trace was published. The trace is no longer trusted."
        />
      </span>
    );
  }

  // "Valid"
  return (
    <span className={className}>
      <Badge label="Verified" tone="ok" title="Hash integrity check passed and no active flags or revocations apply." />
    </span>
  );
}
