"use client";
import { Icon, type IconName } from "@/components/ui/icon";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/contexts/WalletContext";
import { TimingSettings } from "@/components/settings/timing-settings";
import { usePaymentEvents, useSetSpendingAllowance, useSpendingAllowance } from "@/lib/hooks/useTraces";
import { apiNumberToRaw, computeTodayUsage, rawToApiNumber, validateAllowance } from "@/lib/format/allowance";
import { formatUsdc, tryParseUsdc } from "@/lib/stellar/units";
import { UsdcInput } from "@/components/ui/usdc-input";
import { useFormErrors, ErrorSummary, FormStatus } from "@/components/ui/form-errors";
import { mapErrorToField } from "@/lib/forms/error-map";
import { NETWORK_LABEL } from "@/lib/stellar/config";
import { shortAddress } from "@/lib/stellar/units";
import { getReportingConsent, isReportingConfigured, setReportingConsent } from "@/lib/observability/report";
import { getAnalyticsConsent, isAnalyticsConfigured, setAnalyticsConsent } from "@/lib/observability/analytics";
import { storageStatus, ensureHeadroom, type StorageStatus } from "@/lib/storage/quota";

function SettingsSection({ title, icon, children }: { title: string; icon: IconName; children: React.ReactNode }) {
  return <section className="rounded-lg border border-outline-variant bg-surface-container-lowest p-6"><h2 className="mb-6 flex items-center gap-2 font-headline-sm text-headline-sm"><Icon name={icon} className="text-primary" />{title}</h2>{children}</section>;
}

const notificationRows = [
  { key: "execution", label: "Trade confirmations", sublabel: "Submitted and confirmed fills." },
  { key: "news", label: "Price and market updates", sublabel: "New reasoning traces or outcome changes." },
  { key: "shifts", label: "Probability shifts", sublabel: "When a market moves more than 5%." },
] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StorageSection() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState<string | null>(null);

  useEffect(() => {
    storageStatus().then(setStatus).catch(() => null);
  }, []);

  async function clearCaches() {
    setClearing(true);
    setClearMsg(null);
    try {
      const { freedBytes } = await ensureHeadroom(0);
      setClearMsg(`Freed ${formatBytes(freedBytes)} of disposable cache data.`);
      setStatus(await storageStatus());
    } catch {
      setClearMsg("Could not clear caches.");
    } finally {
      setClearing(false);
    }
  }

  if (!status) return <p className="text-sm text-on-surface-variant">Loading storage information…</p>;

  const usagePercent = status.quota > 0 ? Math.min(100, Math.round((status.usage / status.quota) * 100)) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded border border-outline-variant bg-surface-container-low p-4">
        <div className="flex-1">
          <p className="text-sm font-medium text-on-surface">Persistent storage</p>
          <p className="text-xs text-on-surface-variant">
            {status.persisted
              ? "Granted — your payment records are safe from automatic eviction."
              : status.persistSupported
                ? "Not granted — payment records may be evicted under storage pressure. Complete a payment to request persistence."
                : "Not supported on this browser."}
          </p>
        </div>
        <span className={`text-xs font-medium ${status.persisted ? "text-green-600" : "text-amber-600"}`}>
          {status.persisted ? "Persistent" : "Best-effort"}
        </span>
      </div>

      <div>
        <div className="mb-1 flex justify-between text-xs text-on-surface-variant">
          <span>Storage used</span>
          <span>{formatBytes(status.usage)} of {formatBytes(status.quota)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded bg-surface-container">
          <div className="h-full bg-primary transition-all" style={{ width: `${usagePercent}%` }} />
        </div>
      </div>

      <div className="space-y-1">
        {status.stores.map((s) => (
          <div key={s.id} className="flex items-center justify-between text-xs text-on-surface-variant">
            <span>{s.id} <span className="ms-1 text-outline">({s.cls})</span></span>
            <span>{formatBytes(s.bytes)}</span>
          </div>
        ))}
      </div>

      <button
        disabled={clearing}
        onClick={() => void clearCaches()}
        className="rounded border border-outline px-4 py-2 text-sm text-on-surface hover:bg-surface-container disabled:opacity-50"
      >
        {clearing ? "Clearing…" : "Clear disposable caches"}
      </button>
      {clearMsg && <p className="text-xs text-on-surface-variant" aria-live="polite">{clearMsg}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const wallet = useWallet();
  const allowance = useSpendingAllowance();
  const payments = usePaymentEvents();
  const save = useSetSpendingAllowance();
  const [daily, setDaily] = useState("");
  const [perTrace, setPerTrace] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [errorReports, setErrorReports] = useState(() => getReportingConsent());
  const [analytics, setAnalytics] = useState(() => getAnalyticsConsent() === "granted");

  const form = useFormErrors(["daily", "perTrace"] as const);

  // Sync the form with the fetched allowance once; the effect mirrors external server state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (allowance.data) {
      setDaily(formatUsdc(apiNumberToRaw(allowance.data.dailyLimit).raw));
      setPerTrace(formatUsdc(apiNumberToRaw(allowance.data.perTraceLimit).raw));
    }
  }, [allowance.data]);

  const dailyRaw = tryParseUsdc(daily);
  const perTraceRaw = tryParseUsdc(perTrace);
  const usage = computeTodayUsage(payments.data ?? []);
  const usageLimit = dailyRaw ?? 0n;
  const usagePercent = usageLimit > 0n ? Math.min(100, Number((usage * 100n) / usageLimit)) : 0;

  async function submit() {
    setMessage(null);
    form.clearStatus();
    const valid = form.attemptSubmit(() => {
      const d = tryParseUsdc(daily);
      const p = tryParseUsdc(perTrace);
      const v = validateAllowance(d, p);
      const res: Partial<Record<"daily" | "perTrace", string>> = {};
      if (v.daily) res.daily = v.daily;
      if (v.perTrace) res.perTrace = v.perTrace;
      return res;
    });

    if (!valid || dailyRaw === null || perTraceRaw === null) return;
    const dailyApi = rawToApiNumber(dailyRaw);
    const perTraceApi = rawToApiNumber(perTraceRaw);
    if (!dailyApi.ok || !perTraceApi.ok) return;

    try {
      await save.mutateAsync({ dailyLimit: dailyApi.value, perTraceLimit: perTraceApi.value, currency: "USDC" });
      form.announceSettled("save", "Limits saved");
      setMessage("Your trace spending limits were saved.");
    } catch (error) {
      const mapped = mapErrorToField(error, {
        DAILY_LIMIT_EXCEEDED: "daily",
        PER_TRACE_LIMIT_EXCEEDED: "perTrace",
      });
      if ("field" in mapped.target) {
        form.setErrors({ [mapped.target.field]: mapped.message });
      } else {
        form.setFormError(mapped.message);
      }
      setMessage(mapped.message);
    }
  }
  return (
    <main className="mx-auto w-full max-w-container-max-width flex-grow px-gutter pb-20 pt-8">
      <header className="mb-10">
        <h1 className="mb-2 font-headline-md text-headline-md text-on-surface">Settings</h1>
        <p className="text-body-md text-on-surface-variant">Control wallet-scoped preferences and trace spending limits.</p>
      </header>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
        <div className="space-y-8 md:col-span-7">
          <SettingsSection title="Privacy" icon="shield">
            <div className="space-y-3">
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded border border-outline-variant bg-surface-container-low p-4">
                <div>
                  <p className="text-sm font-medium text-on-surface">Send anonymous error reports</p>
                  <p className="text-xs text-on-surface-variant">Helps fix crashes and failed transactions. Reports never contain your wallet address, tokens or transaction data.</p>
                </div>
                <input type="checkbox" checked={errorReports} disabled={!isReportingConfigured()} onChange={(event) => { setErrorReports(event.target.checked); setReportingConsent(event.target.checked); }} className="h-5 w-5 accent-[#005f73]" />
              </label>
              {!isReportingConfigured() && <p className="text-xs text-on-surface-variant">Error reporting is not configured on this deployment, so nothing is ever sent.</p>}
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded border border-outline-variant bg-surface-container-low p-4">
                <div>
                  <p className="text-sm font-medium text-on-surface">Send anonymous usage analytics</p>
                  <p className="text-xs text-on-surface-variant">Funnel events only: wallet module, coarse amount buckets and outcomes — never your address, exact amounts or transaction hashes.</p>
                </div>
                <input type="checkbox" checked={analytics} disabled={!isAnalyticsConfigured()} onChange={(event) => { setAnalytics(event.target.checked); setAnalyticsConsent(event.target.checked ? "granted" : "denied"); }} className="h-5 w-5 accent-[#005f73]" />
              </label>
              {!isAnalyticsConfigured() && <p className="text-xs text-on-surface-variant">Usage analytics are not configured on this deployment, so nothing is ever collected.</p>}
              <p className="text-xs text-on-surface-variant">Do Not Track and Global Privacy Control are always honoured as off. <Link href="/privacy" className="text-primary underline">What is collected</Link></p>
            </div>
          </SettingsSection>
          <SettingsSection title="Wallet" icon="account_balance_wallet">
            {wallet.isConnected && wallet.address
              ? <div className="flex items-center justify-between rounded border border-outline-variant bg-surface-container-low p-4"><div><p className="text-xs text-on-surface-variant">Connected wallet</p><p className="font-data-mono">{shortAddress(wallet.address, 6, 6)} <span className="ms-2 text-xs text-secondary">{NETWORK_LABEL}</span></p></div><Link href="/portfolio/wallets" className="text-primary hover:underline">Manage</Link></div>
              : <button onClick={() => void wallet.openModal()} className="rounded bg-primary px-4 py-2 text-white">Connect wallet</button>}
          </SettingsSection>
          <SettingsSection title="Trace spending limits" icon="payments">
            {!wallet.isConnected
              ? <p className="text-sm text-on-surface-variant">Connect your wallet to manage spending limits.</p>
              : !wallet.isAuthenticated
                ? <div><p className="mb-3 text-sm text-on-surface-variant">Sign in to view and change your limits.</p><button onClick={() => void wallet.ensureSession()} className="rounded bg-primary px-4 py-2 text-white">Sign in</button></div>
                : <div className="space-y-5">
                    <p className="text-sm text-on-surface-variant">Payments are blocked until you set a positive daily and per-trace limit.</p>
                    <ErrorSummary
                      errors={form.errors}
                      formError={form.formError}
                      ids={form.ids}
                      labels={{ daily: "Daily limit", perTrace: "Per-trace limit" }}
                      summaryRef={form.summaryRef}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <UsdcInput
                        id={form.ids.daily.input}
                        label="Daily limit (USDC)"
                        value={daily}
                        onValueChange={(_, text) => setDaily(text)}
                        onBlur={() => form.handleBlur("daily")}
                        error={form.errors.daily}
                      />
                      <UsdcInput
                        id={form.ids.perTrace.input}
                        label="Per-trace limit (USDC)"
                        value={perTrace}
                        onValueChange={(_, text) => setPerTrace(text)}
                        onBlur={() => form.handleBlur("perTrace")}
                        error={form.errors.perTrace}
                      />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-on-surface-variant"><span>Used today</span><span>{formatUsdc(usage)}{usageLimit ? ` of ${formatUsdc(usageLimit)} USDC` : " USDC"}</span></div>
                      <div className="h-2 overflow-hidden rounded bg-surface-container"><div className="h-full bg-primary" style={{ width: `${usagePercent}%` }} /></div>
                    </div>
                    <button disabled={save.isPending} onClick={() => void submit()} className="rounded bg-primary px-5 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50">{save.isPending ? "Saving…" : "Save limits"}</button>
                    <FormStatus message={form.statusMessage} />
                    {message && <p aria-live="polite" className="text-sm text-on-surface-variant">{message}</p>}
                  </div>}
          </SettingsSection>
          {/* Issue #228: storage section */}
          <SettingsSection title="Storage on this device" icon="storage">
            <StorageSection />
          </SettingsSection>
        </div>
        <div className="space-y-8 md:col-span-5">
          <SettingsSection title="Trading defaults" icon="settings_input_component">
            <TimingSettings address={wallet.address} />
          </SettingsSection>
        </div>
      </div>
    </main>
  );
}
