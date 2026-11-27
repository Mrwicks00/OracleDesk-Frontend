"use client";

import { Icon } from "@/components/ui/icon";
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { RequireWallet } from "@/components/require-wallet";
import { useWalletAddress } from "@/lib/contexts/WalletContext";
import {
  useAgents,
  useRegisterAgent,
  useRegistryAdmin,
  type AgentRow,
  type AgentSource,
} from "@/lib/hooks/useAgents";
import {
  useAgentRecord,
  useRegistryWrite,
  useRevokeImpact,
  allowedActions,
  validateRevoke,
  type AgentState,
  type AgentAction,
} from "@/lib/hooks/useRegistryModeration";
import { TraceStatusBadge } from "@/components/trace/trace-status-badge";
import {
  useFormErrors,
  ErrorSummary,
  FieldError,
  Field,
  FormStatus,
} from "@/components/ui/form-errors";
import { CONTRACTS, explorerAccount, explorerTx } from "@/lib/stellar/config";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import { describeError } from "@/lib/stellar/errors";
import { AddressInput } from "@/components/ui/address-input";
import { knownAddresses } from "@/lib/stellar/address-book";
import type { PolicyCheckedAddress } from "@/lib/stellar/address-policy";
import { parseOnChainTraceId, routes } from "@/lib/routes";
import { ledgerClock } from "@/lib/stellar/ledger-clock";

const SOURCE_LABELS: Record<AgentSource, string> = {
  "event:registered": "AgentRegistered event",
  "event:published": "TracePublished event",
  deployments: "deployments.testnet.json",
  env: "NEXT_PUBLIC_KNOWN_AGENTS",
};

const SourceBadge = ({ source }: { source: AgentSource }) => (
  <span className="inline-block me-1 mb-1 px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant text-[10px] font-label-caps uppercase tracking-wide">
    {SOURCE_LABELS[source]}
  </span>
);

function AgentStatusChip({ state, row }: { state: AgentState; row: AgentRow }) {
  switch (state.kind) {
    case "Active":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-label-caps font-medium bg-secondary/10 text-secondary border border-secondary/20">
          Active
        </span>
      );
    case "Retired":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-label-caps font-medium bg-warning/10 text-warning-on border border-warning/20">
          Retired
        </span>
      );
    case "Revoked":
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-label-caps font-medium bg-error/10 text-error border border-error/20"
          title={`Effective from: ${state.effectiveFrom.toString()} — Reason: ${state.reason}`}
        >
          Revoked
        </span>
      );
    case "Unregistered":
      if (row.registered === true) {
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-label-caps font-medium bg-secondary/10 text-secondary border border-secondary/20">
            Registered
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-label-caps font-medium bg-surface-container text-on-surface-variant border border-outline-variant">
          Unregistered
        </span>
      );
  }
}

function windowsDays(window: { oldestLedger: number; latestLedger: number } | undefined): number | null {
  if (!window) return null;
  return Math.max(0, Math.round((window.latestLedger - window.oldestLedger) / 17_280));
}

export default function AdminAgentsPage() {
  return (
    <RequireWallet
      title="Restricted Access"
      description="The agent registry requires a secure wallet connection for institutional authentication."
    >
      <AdminAgentsContent />
    </RequireWallet>
  );
}

type ActiveDialog =
  | { kind: "register"; agent: string }
  | { kind: "retire"; agent: string }
  | { kind: "reactivate"; agent: string }
  | { kind: "revoke"; agent: string; state: AgentState }
  | null;

function AdminAgentsContent() {
  const { address } = useWalletAddress();
  const { can, isDevelopmentFallback } = useAdminPermissions();
  const agents = useAgents();
  const registryAdmin = useRegistryAdmin();
  const registerMutation = useRegisterAgent();
  const registryWrite = useRegistryWrite();

  const [input, setInput] = useState("");
  const [validatedAgent, setValidatedAgent] = useState<PolicyCheckedAddress | null>(null);
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Form error kits for accessible dialog forms
  const registerForm = useFormErrors<"agentAddress">(["agentAddress"]);
  const actionForm = useFormErrors<"confirm" | "reason" | "effectiveFrom">([
    "confirm",
    "reason",
    "effectiveFrom",
  ]);
  const flagForm = useFormErrors<"traceId" | "reason">(["traceId", "reason"]);

  // Form states for modal inputs
  const [typedConfirm, setTypedConfirm] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeEffectiveStr, setRevokeEffectiveStr] = useState("");
  const [flagTraceId, setFlagTraceId] = useState("");
  const [flagReason, setFlagReason] = useState("");

  const authorized = can("admin.read") || can("agents.manage");
  const canManage = can("agents.manage");
  const rows = useMemo(() => agents.data?.rows ?? [], [agents.data?.rows]);
  const adminHint = registryAdmin.data;
  const notAdmin = Boolean(adminHint && address && adminHint !== address);
  const busy = registerMutation.isPending || registryWrite.isPending;
  const days = windowsDays(agents.data?.window);

  // Revoke impact calculation
  const revokeEffectiveBigInt = useMemo(() => {
    if (!revokeEffectiveStr.trim()) return undefined;
    try {
      return BigInt(revokeEffectiveStr.trim());
    } catch {
      return undefined;
    }
  }, [revokeEffectiveStr]);

  const revokeImpact = useRevokeImpact(
    activeDialog?.kind === "revoke" ? activeDialog.agent : undefined,
    revokeEffectiveBigInt,
  );

  const known = useMemo(
    () =>
      knownAddresses(
        address,
        rows.map((r) => ({
          address: r.address,
          label: r.registered ? "Registered Agent" : "Registry Agent",
          source: "registry" as const,
        })),
      ),
    [address, rows],
  );

  if (!authorized) {
    return (
      <main className="flex-grow flex items-center justify-center p-gutter">
        <div className="max-w-md w-full text-center space-y-4 bg-white p-10 rounded-xl border border-outline-variant shadow-sm">
          <h2 className="font-headline-md text-headline-md">Access Denied</h2>
          <p className="text-on-surface-variant">Only OracleDesk admins can manage registry agents.</p>
          <p className="text-on-surface-variant text-sm font-data-mono break-all">{address}</p>
        </div>
      </main>
    );
  }

  const openDialog = (dialog: ActiveDialog) => {
    actionForm.clearErrors();
    actionForm.setFormError(null);
    setTypedConfirm("");
    setRevokeReason("");
    setRevokeEffectiveStr(String(ledgerClock.now() || 0));
    setActiveDialog(dialog);
  };

  const closeDialog = () => {
    setActiveDialog(null);
    actionForm.clearErrors();
  };

  // Submit action from modal
  const handleActionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDialog) return;

    const suffix = activeDialog.agent.slice(-6);
    const passed = actionForm.attemptSubmit(() => {
      const errs: Partial<Record<"confirm" | "reason" | "effectiveFrom", string>> = {};
      if (activeDialog.kind === "retire" || activeDialog.kind === "revoke") {
        if (typedConfirm !== suffix) {
          errs.confirm = `Type the last 6 characters (${suffix}) to confirm.`;
        }
      }
      if (activeDialog.kind === "revoke") {
        if (!revokeReason.trim()) {
          errs.reason = "A revocation reason is required.";
        }
        if (!revokeEffectiveStr.trim()) {
          errs.effectiveFrom = "Effective timestamp is required.";
        } else {
          try {
            const eff = BigInt(revokeEffectiveStr.trim());
            const now = BigInt((ledgerClock.now() || 0) + 300); // 5 min ledger buffer
            const valErr = validateRevoke(activeDialog.state, eff, now);
            if (valErr) errs.effectiveFrom = valErr;
          } catch {
            errs.effectiveFrom = "Effective timestamp must be an integer.";
          }
        }
      }
      return errs;
    });

    if (!passed) return;

    try {
      let res: { txHash: string | null };
      if (activeDialog.kind === "retire") {
        res = await registryWrite.mutateAsync({ kind: "retire", agent: activeDialog.agent });
      } else if (activeDialog.kind === "reactivate") {
        res = await registryWrite.mutateAsync({ kind: "reactivate", agent: activeDialog.agent });
      } else if (activeDialog.kind === "revoke") {
        res = await registryWrite.mutateAsync({
          kind: "revoke",
          agent: activeDialog.agent,
          effectiveFrom: BigInt(revokeEffectiveStr.trim()),
          reason: revokeReason.trim(),
        });
      } else {
        return;
      }
      setTxHash(res.txHash);
      actionForm.announceSettled(
        "success",
        `Agent ${activeDialog.kind} operation submitted successfully.`,
      );
      closeDialog();
    } catch (err) {
      actionForm.setFormError(describeError(err, "reasoningRegistry").message);
      actionForm.summaryRef.current?.focus();
    }
  };

  // Register new agent submit
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const passed = registerForm.attemptSubmit(() => {
      const errs: Partial<Record<"agentAddress", string>> = {};
      if (!validatedAgent) {
        errs.agentAddress = "Enter a valid Stellar account or contract address.";
      }
      if (!canManage) {
        errs.agentAddress = "Permission denied: You do not have agents.manage permission.";
      }
      if (notAdmin) {
        errs.agentAddress = `This wallet is not the registry admin (${adminHint}).`;
      }
      return errs;
    });

    if (!passed || !validatedAgent) return;

    try {
      const res = await registerMutation.mutateAsync({ agent: validatedAgent });
      setTxHash(res.txHash);
      registerForm.announceSettled("registered", `Agent ${validatedAgent} registered.`);
      setInput("");
      setValidatedAgent(null);
    } catch (err) {
      registerForm.setFormError(describeError(err, "reasoningRegistry").message);
      registerForm.summaryRef.current?.focus();
    }
  };

  // Trace flag submit
  const handleFlagSubmit = async (action: "flag" | "unflag") => {
    const passed = flagForm.attemptSubmit(() => {
      const errs: Partial<Record<"traceId" | "reason", string>> = {};
      if (!flagTraceId.trim()) errs.traceId = "Enter a trace ID.";
      else {
        try {
          BigInt(flagTraceId.trim());
        } catch {
          errs.traceId = "Trace ID must be an integer.";
        }
      }
      if (!flagReason.trim()) errs.reason = "Enter a reason.";
      return errs;
    });

    if (!passed) return;

    try {
      const id = BigInt(flagTraceId.trim());
      const res =
        action === "flag"
          ? await registryWrite.mutateAsync({ kind: "flag", traceId: id, reason: flagReason.trim() })
          : await registryWrite.mutateAsync({
              kind: "unflag",
              traceId: id,
              reason: flagReason.trim(),
            });
      setTxHash(res.txHash);
      flagForm.announceSettled("flagged", `Trace #${flagTraceId} ${action}ged successfully.`);
      setFlagTraceId("");
      setFlagReason("");
    } catch (err) {
      flagForm.setFormError(describeError(err, "reasoningRegistry").message);
      flagForm.summaryRef.current?.focus();
    }
  };

  return (
    <main className="flex-grow max-w-container-max-width mx-auto px-gutter py-12 w-full space-y-8">
      {isDevelopmentFallback && (
        <div
          role="note"
          className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-700 text-xs flex items-center gap-2"
        >
          <Icon name="warning" className="text-sm" />
          <span>
            DEVELOPMENT FALLBACK: Gated by local environment addresses, not real backend authorization.
            Never active in production.
          </span>
        </div>
      )}
      <div className="flex flex-col md:flex-row justify-between items-end gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-on-surface-variant">
            <Link href="/admin" className="hover:text-primary">
              Admin
            </Link>
            <Icon name="chevron_right" className="text-sm" />
            <span>Agents &amp; Moderation</span>
          </div>
          <h1 className="font-display-lg text-display-lg text-primary text-4xl">
            Reasoning agents &amp; moderation
          </h1>
          <p className="text-on-surface-variant font-body-lg text-body-lg max-w-3xl">
            Lifecycle state and trace moderation on{" "}
            <code className="font-data-mono">{CONTRACTS.reasoningRegistry.slice(0, 8)}…</code>.
            Retiring prevents future publishes while preserving past traces; revoking retroactively
            invalidates traces.
          </p>
        </div>
      </div>

      <section className="bg-surface-container-low border border-outline-variant rounded-xl p-5 space-y-2">
        <p className="text-sm text-on-surface-variant">
          {agents.data ? (
            <>
              Events cover ledgers <strong>{agents.data.window.oldestLedger}</strong>–
              <strong>{agents.data.window.latestLedger}</strong>
              {days !== null ? ` (about ${days} days)` : ""}. Agents registered earlier appear if
              configured.
            </>
          ) : agents.isLoading ? (
            "Reading registry events…"
          ) : (
            "Couldn't read registry events."
          )}
        </p>
        {agents.data?.partial && (
          <p className="text-sm text-tertiary">
            Partial window: event read stopped at its page cap; some entries may be missing.
          </p>
        )}
        {registryAdmin.isError && (
          <p className="text-sm text-on-surface-variant">
            Couldn&apos;t read registry admin. The contract still verifies caller authorization.
          </p>
        )}
        {notAdmin && (
          <p className="text-sm text-tertiary">
            Connected wallet <span className="font-data-mono">{address}</span> is not the registry
            admin (<span className="font-data-mono">{adminHint}</span>). Moderation actions are
            disabled.
          </p>
        )}
      </section>

      {txHash && (
        <div
          role="status"
          className="p-4 bg-secondary/10 border border-secondary/20 rounded-xl text-secondary text-sm flex items-center justify-between"
        >
          <span>Transaction submitted.</span>
          <a
            className="underline font-data-mono text-xs"
            href={explorerTx(txHash) ?? undefined}
            target="_blank"
            rel="noreferrer"
          >
            View on explorer
          </a>
        </div>
      )}

      <section className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Left Column: Register & Trace Moderation */}
        <div className="xl:col-span-2 space-y-6">
          {/* Register Agent Form */}
          <div className="bg-white border border-outline-variant rounded-xl p-6 space-y-4">
            <h2 className="font-headline-sm text-headline-sm">Register new agent</h2>
            <p className="text-sm text-on-surface-variant">
              Authorizes an address to publish reasoning traces on-chain.
            </p>

            <ErrorSummary
              errors={registerForm.errors}
              formError={registerForm.formError}
              summaryRef={registerForm.summaryRef}
            />

            <form onSubmit={handleRegisterSubmit} className="space-y-4">
              <Field>
                <label
                  className="block font-label-caps text-label-caps text-on-surface-variant mb-1"
                  htmlFor={registerForm.ids.agentAddress.input}
                >
                  AGENT ADDRESS
                </label>
                <AddressInput
                  id={registerForm.ids.agentAddress.input}
                  value={input}
                  onChange={(next) => {
                    setInput(next);
                    registerForm.clearErrors();
                  }}
                  onValidated={setValidatedAgent}
                  policy="authority"
                  expect="any"
                  known={known}
                  knownLoading={agents.isLoading}
                  placeholder="G… or C…"
                  className="bg-surface p-3 text-sm"
                  aria-invalid={Boolean(
                    registerForm.errors.agentAddress && registerForm.touched.agentAddress,
                  )}
                  aria-describedby={registerForm.ids.agentAddress.error}
                />
                <FieldError
                  id={registerForm.ids.agentAddress.error}
                  message={
                    registerForm.touched.agentAddress
                      ? registerForm.errors.agentAddress
                      : undefined
                  }
                />
              </Field>

              <button
                type="submit"
                disabled={notAdmin || busy}
                className="w-full bg-primary text-primary-foreground px-4 py-3 rounded-lg font-label-caps text-label-caps disabled:opacity-50"
              >
                {registerMutation.isPending ? "REGISTERING…" : "REGISTER AGENT"}
              </button>
              <FormStatus status={registerForm.statusMessage} />
            </form>
          </div>

          {/* Trace Moderation Panel */}
          <div className="bg-white border border-outline-variant rounded-xl p-6 space-y-4">
            <h2 className="font-headline-sm text-headline-sm">Trace moderation</h2>
            <p className="text-sm text-on-surface-variant">
              Flag or unflag reasoning traces with a moderation reason (up to 16 entries preserved).
            </p>

            <ErrorSummary
              errors={flagForm.errors}
              formError={flagForm.formError}
              summaryRef={flagForm.summaryRef}
            />

            <div className="space-y-3">
              <Field>
                <label
                  className="block font-label-caps text-label-caps text-on-surface-variant mb-1"
                  htmlFor={flagForm.ids.traceId.input}
                >
                  TRACE ID
                </label>
                <input
                  id={flagForm.ids.traceId.input}
                  type="text"
                  value={flagTraceId}
                  onChange={(e) => {
                    setFlagTraceId(e.target.value);
                    flagForm.clearErrors();
                  }}
                  placeholder="e.g. 42"
                  className="w-full bg-surface border border-outline-variant rounded p-2.5 font-data-mono text-sm outline-none focus:ring-2 focus:ring-primary"
                  aria-invalid={Boolean(flagForm.errors.traceId && flagForm.touched.traceId)}
                  aria-describedby={flagForm.ids.traceId.error}
                  onBlur={flagForm.handleBlur("traceId")}
                />
                <FieldError
                  id={flagForm.ids.traceId.error}
                  message={flagForm.touched.traceId ? flagForm.errors.traceId : undefined}
                />
              </Field>

              <Field>
                <label
                  className="block font-label-caps text-label-caps text-on-surface-variant mb-1"
                  htmlFor={flagForm.ids.reason.input}
                >
                  REASON
                </label>
                <input
                  id={flagForm.ids.reason.input}
                  type="text"
                  value={flagReason}
                  onChange={(e) => {
                    setFlagReason(e.target.value);
                    flagForm.clearErrors();
                  }}
                  placeholder="Reason for flag/unflag"
                  className="w-full bg-surface border border-outline-variant rounded p-2.5 text-sm outline-none focus:ring-2 focus:ring-primary"
                  aria-invalid={Boolean(flagForm.errors.reason && flagForm.touched.reason)}
                  aria-describedby={flagForm.ids.reason.error}
                  onBlur={flagForm.handleBlur("reason")}
                />
                <FieldError
                  id={flagForm.ids.reason.error}
                  message={flagForm.touched.reason ? flagForm.errors.reason : undefined}
                />
              </Field>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  disabled={notAdmin || busy}
                  onClick={() => void handleFlagSubmit("flag")}
                  className="flex-1 bg-warning/20 text-warning-on border border-warning/30 hover:bg-warning/30 px-3 py-2 rounded-lg font-label-caps text-xs disabled:opacity-50"
                >
                  FLAG TRACE
                </button>
                <button
                  type="button"
                  disabled={notAdmin || busy}
                  onClick={() => void handleFlagSubmit("unflag")}
                  className="flex-1 border border-outline text-on-surface hover:bg-surface-container px-3 py-2 rounded-lg font-label-caps text-xs disabled:opacity-50"
                >
                  UNFLAG TRACE
                </button>
              </div>
              <FormStatus status={flagForm.statusMessage} />
            </div>
          </div>
        </div>

        {/* Right Column: Agents Table */}
        <div className="xl:col-span-3 bg-white border border-outline-variant rounded-xl overflow-hidden">
          <div className="p-5 border-b border-outline-variant flex items-center justify-between gap-3">
            <h2 className="font-headline-sm text-headline-sm">Known agents &amp; status</h2>
            <span className="text-xs text-on-surface-variant">
              {rows.length} address{rows.length === 1 ? "" : "es"}
            </span>
          </div>

          {agents.isLoading ? (
            <p className="p-8 text-center text-on-surface-variant animate-pulse">
              Reading events and live state…
            </p>
          ) : agents.isError ? (
            <div className="p-8 text-center text-error">
              <p>Couldn&apos;t load agents.</p>
              <button
                type="button"
                className="mt-3 underline text-sm"
                onClick={() => void agents.refetch()}
              >
                Retry
              </button>
            </div>
          ) : rows.length === 0 ? (
            <p className="p-8 text-center text-on-surface-variant">
              No agents found in this window.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead className="bg-surface-container-low text-on-surface-variant text-[11px] uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3">Sources</th>
                    <th className="px-4 py-3">Lifecycle state</th>
                    <th className="px-4 py-3">Traces</th>
                    <th className="px-4 py-3">Last publish</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {rows.map((row) => (
                    <AgentTableRow
                      key={row.address}
                      row={row}
                      notAdmin={notAdmin}
                      busy={busy}
                      onAction={(action, state) => {
                        if (action === "register") {
                          openDialog({ kind: "register", agent: row.address });
                        } else if (action === "retire") {
                          openDialog({ kind: "retire", agent: row.address });
                        } else if (action === "reactivate") {
                          openDialog({ kind: "reactivate", agent: row.address });
                        } else if (action === "revoke") {
                          openDialog({ kind: "revoke", agent: row.address, state });
                        }
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Action Dialog / Modal */}
      {activeDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-title"
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-outline-variant rounded-xl max-w-lg w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-outline-variant pb-3">
              <h3 id="dialog-title" className="font-headline-sm text-headline-sm capitalize">
                {activeDialog.kind === "revoke"
                  ? "Revoke Agent (Retroactive)"
                  : `${activeDialog.kind} Agent`}
              </h3>
              <button
                type="button"
                onClick={closeDialog}
                className="text-on-surface-variant hover:text-on-surface text-sm"
              >
                Cancel
              </button>
            </div>

            <ErrorSummary
              errors={actionForm.errors}
              formError={actionForm.formError}
              summaryRef={actionForm.summaryRef}
            />

            <form onSubmit={handleActionSubmit} className="space-y-4">
              <div className="text-sm space-y-1">
                <span className="text-xs uppercase text-on-surface-variant font-label-caps">
                  Agent Address
                </span>
                <p className="font-data-mono text-xs break-all bg-surface p-2 rounded border border-outline-variant">
                  {activeDialog.agent}
                </p>
              </div>

              {activeDialog.kind === "retire" && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-800 text-xs">
                  Retiring stops future publishes immediately. Traces already published remain
                  valid and verifiable.
                </div>
              )}

              {activeDialog.kind === "reactivate" && (
                <div className="p-3 bg-secondary/10 border border-secondary/20 rounded-lg text-secondary text-xs">
                  Reactivating returns this retired agent to Active status, allowing it to publish
                  traces again.
                </div>
              )}

              {activeDialog.kind === "revoke" && (
                <div className="space-y-3">
                  <div className="p-3 bg-error/10 border border-error/30 rounded-lg text-error text-xs">
                    Revoking retroactively invalidates all traces published at or after the
                    effective time. This cannot be undone (revocation is terminal).
                  </div>

                  <Field>
                    <label
                      className="block text-xs font-label-caps text-on-surface-variant mb-1"
                      htmlFor={actionForm.ids.effectiveFrom.input}
                    >
                      EFFECTIVE FROM (LEDGER TIMESTAMP)
                    </label>
                    <input
                      id={actionForm.ids.effectiveFrom.input}
                      type="text"
                      value={revokeEffectiveStr}
                      onChange={(e) => setRevokeEffectiveStr(e.target.value)}
                      className="w-full bg-surface border border-outline-variant rounded p-2 font-data-mono text-sm outline-none focus:ring-2 focus:ring-primary"
                      aria-invalid={Boolean(
                        actionForm.errors.effectiveFrom && actionForm.touched.effectiveFrom,
                      )}
                      aria-describedby={actionForm.ids.effectiveFrom.error}
                      onBlur={actionForm.handleBlur("effectiveFrom")}
                    />
                    <FieldError
                      id={actionForm.ids.effectiveFrom.error}
                      message={
                        actionForm.touched.effectiveFrom
                          ? actionForm.errors.effectiveFrom
                          : undefined
                      }
                    />
                  </Field>

                  {/* Impact preview */}
                  <div className="text-xs text-on-surface-variant bg-surface-container-low p-2 rounded border border-outline-variant">
                    <span className="font-semibold">Impact preview: </span>
                    {revokeImpact.isLoading ? (
                      <span className="animate-pulse">Calculating affected traces…</span>
                    ) : (
                      <span>{revokeImpact.data?.note ?? "No traces affected."}</span>
                    )}
                  </div>

                  <Field>
                    <label
                      className="block text-xs font-label-caps text-on-surface-variant mb-1"
                      htmlFor={actionForm.ids.reason.input}
                    >
                      REVOCATION REASON
                    </label>
                    <input
                      id={actionForm.ids.reason.input}
                      type="text"
                      value={revokeReason}
                      onChange={(e) => setRevokeReason(e.target.value)}
                      placeholder="e.g. Key compromise or protocol violation"
                      className="w-full bg-surface border border-outline-variant rounded p-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                      aria-invalid={Boolean(
                        actionForm.errors.reason && actionForm.touched.reason,
                      )}
                      aria-describedby={actionForm.ids.reason.error}
                      onBlur={actionForm.handleBlur("reason")}
                    />
                    <FieldError
                      id={actionForm.ids.reason.error}
                      message={
                        actionForm.touched.reason ? actionForm.errors.reason : undefined
                      }
                    />
                  </Field>
                </div>
              )}

              {(activeDialog.kind === "retire" || activeDialog.kind === "revoke") && (
                <Field>
                  <label
                    className="block text-xs font-label-caps text-on-surface-variant mb-1"
                    htmlFor={actionForm.ids.confirm.input}
                  >
                    TYPE LAST 6 CHARACTERS ({activeDialog.agent.slice(-6)}) TO CONFIRM
                  </label>
                  <input
                    id={actionForm.ids.confirm.input}
                    value={typedConfirm}
                    onChange={(e) => setTypedConfirm(e.target.value)}
                    className="w-full bg-surface border border-outline-variant rounded p-2 font-data-mono text-sm outline-none focus:ring-2 focus:ring-primary"
                    placeholder={activeDialog.agent.slice(-6)}
                    aria-invalid={Boolean(
                      actionForm.errors.confirm && actionForm.touched.confirm,
                    )}
                    aria-describedby={actionForm.ids.confirm.error}
                    onBlur={actionForm.handleBlur("confirm")}
                  />
                  <FieldError
                    id={actionForm.ids.confirm.error}
                    message={
                      actionForm.touched.confirm ? actionForm.errors.confirm : undefined
                    }
                  />
                </Field>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeDialog}
                  className="flex-1 border border-outline text-on-surface px-4 py-2.5 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className={`flex-1 px-4 py-2.5 rounded-lg font-label-caps text-xs disabled:opacity-50 ${
                    activeDialog.kind === "revoke"
                      ? "bg-error text-error-foreground"
                      : "bg-primary text-primary-foreground"
                  }`}
                >
                  {busy ? "SUBMITTING…" : `CONFIRM ${activeDialog.kind.toUpperCase()}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

function AgentTableRow({
  row,
  notAdmin,
  busy,
  onAction,
}: {
  row: AgentRow;
  notAdmin: boolean;
  busy: boolean;
  onAction: (action: AgentAction, state: AgentState) => void;
}) {
  const agentQuery = useAgentRecord(row.address);
  const state: AgentState = agentQuery.data ?? { kind: "Unregistered" };
  const actions = allowedActions(state);

  const traceId = row.lastTraceId ? parseOnChainTraceId(row.lastTraceId) : null;

  return (
    <tr className="align-top">
      <td className="px-4 py-4">
        <a
          href={explorerAccount(row.address) ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="font-data-mono text-xs break-all text-primary hover:underline"
        >
          {row.address}
        </a>
        {traceId ? (
          <div className="mt-1 flex items-center gap-2">
            <Link
              href={routes.reasoningVerify({ onChainTraceId: traceId })}
              className="underline text-xs text-on-surface-variant hover:text-primary"
            >
              Trace #{row.lastTraceId}
            </Link>
            <TraceStatusBadge traceId={row.lastTraceId ?? undefined} agentAddr={row.address} />
          </div>
        ) : null}
      </td>
      <td className="px-4 py-4 max-w-[190px]">
        {row.sources.map((source) => (
          <SourceBadge key={source} source={source} />
        ))}
      </td>
      <td className="px-4 py-4">
        <AgentStatusChip state={state} row={row} />
      </td>
      <td className="px-4 py-4 font-data-mono">{row.tracesInWindow}</td>
      <td className="px-4 py-4 whitespace-nowrap text-on-surface-variant">
        {row.lastPublishedAt ? new Date(row.lastPublishedAt * 1000).toLocaleString() : "—"}
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-wrap gap-2">
          {actions.map((act) => (
            <button
              key={act}
              type="button"
              disabled={notAdmin || busy}
              onClick={() => onAction(act, state)}
              className={`text-xs underline capitalize disabled:opacity-40 disabled:no-underline ${
                act === "revoke"
                  ? "text-error"
                  : act === "retire"
                  ? "text-warning-on"
                  : "text-primary"
              }`}
            >
              {act}
            </button>
          ))}
        </div>
      </td>
    </tr>
  );
}
