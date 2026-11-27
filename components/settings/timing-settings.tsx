"use client";

import { useSettings } from "@/lib/settings/useSettings";
import { TIMING_LIMITS, type TimingMode } from "@/lib/settings/settings";

const MODE_LABEL: Record<TimingMode, string> = {
  standard: "Standard",
  extended: "Extended",
};

/**
 * Timing preference (WCAG 2.2.1 and 2.2.2) and the "Time limits" help panel.
 * Lists which limits the app sets and which are imposed by the protocol.
 */
export function TimingSettings({ address }: { address: string | null | undefined }) {
  const { settings, update } = useSettings(address);
  const { mode, pauseAutoUpdates } = settings.timing;

  return (
    <div className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="text-sm font-bold mb-2">Signing time</legend>
        {(Object.keys(TIMING_LIMITS) as TimingMode[]).map((option) => (
          <label key={option} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="timing-mode"
              value={option}
              checked={mode === option}
              onChange={() => update((current) => ({ ...current, timing: { ...current.timing, mode: option } }))}
              className="mt-1"
            />
            <span>
              <span className="font-bold">{MODE_LABEL[option]}</span> — {TIMING_LIMITS[option].txTimeoutS} seconds to sign in your wallet.
              {option === "extended" && " Price can move more during a longer window; your slippage limit still applies."}
            </span>
          </label>
        ))}
      </fieldset>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={pauseAutoUpdates}
          onChange={(event) =>
            update((current) => ({ ...current, timing: { ...current.timing, pauseAutoUpdates: event.target.checked } }))
          }
          className="mt-1"
        />
        <span>Pause the home ticker, live trade feeds and trade tape when the page loads.</span>
      </label>

      <section aria-labelledby="time-limits-heading" className="text-sm space-y-2">
        <h3 id="time-limits-heading" className="font-bold">Time limits</h3>
        <ul className="list-disc ps-5 space-y-1">
          <li>
            <span className="font-bold">Trade signing window (you set this):</span> {TIMING_LIMITS[mode].txTimeoutS} seconds. The app warns 20 seconds before it closes.
          </li>
          <li>
            <span className="font-bold">Market close (protocol):</span> trades cannot be placed in the last seconds before a market closes. This cannot be extended.
          </li>
          <li>
            <span className="font-bold">x402 payment authorization (protocol):</span> expires at a fixed ledger shown on the unlock panel. This cannot be extended.
          </li>
          <li>
            <span className="font-bold">Multisig session (protocol):</span> expires at a fixed ledger. This cannot be extended.
          </li>
        </ul>
      </section>
    </div>
  );
}
