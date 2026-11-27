/**
 * Lightweight diagnostics counters for cross-tab sync message drops.
 * Shown in the ?debug=1 panel. Never logs message contents.
 */

export type SyncDropReason = "schema" | "network" | "epoch" | "self";

const counts: Record<SyncDropReason, number> = {
  schema: 0,
  network: 0,
  epoch: 0,
  self: 0,
};

export function countDroppedSyncMessage(reason: SyncDropReason): void {
  counts[reason]++;
}

export function getSyncDiagnostics(): Readonly<Record<SyncDropReason, number>> {
  return { ...counts };
}

export function resetSyncDiagnostics(): void {
  counts.schema = 0;
  counts.network = 0;
  counts.epoch = 0;
  counts.self = 0;
}
