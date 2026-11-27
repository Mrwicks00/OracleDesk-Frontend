"use client";

import { LiveRegion } from "@/components/ui/live-region";
import { WARN_BEFORE_EXPIRY_S, type TransactionDeadline } from "@/lib/stellar/deadline";
import { useLedgerNow } from "@/lib/stellar/ledger-clock";

/**
 * Remaining signing window while the wallet prompt is open. Time comes from
 * ledger time (never the device clock). The countdown is silent except for one
 * polite announcement when the warning threshold is reached.
 */
export function SigningCountdown({
  deadline,
  onNeedMoreTime,
}: {
  deadline: TransactionDeadline;
  onNeedMoreTime?: () => void;
}) {
  const { now } = useLedgerNow();

  if (now === null) {
    return <p className="text-[11px] text-on-surface-variant">Time left to sign: unknown (ledger clock unavailable).</p>;
  }

  const remaining = Math.max(0, deadline.maxTime - Math.floor(now));
  const warning = remaining <= WARN_BEFORE_EXPIRY_S && remaining > 0;
  // Announce once, at the threshold, so a screen reader is not interrupted every second.
  const announcement =
    remaining === WARN_BEFORE_EXPIRY_S
      ? `${WARN_BEFORE_EXPIRY_S} seconds left to sign. Choose Need more time to rebuild with a fresh deadline.`
      : "";

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] font-data-mono text-on-surface-variant" aria-live="off">
      <span>Time left to sign: {remaining} s</span>
      {warning && onNeedMoreTime && (
        <button type="button" onClick={onNeedMoreTime} className="underline font-bold">
          Need more time
        </button>
      )}
      <LiveRegion message={announcement} />
    </div>
  );
}
