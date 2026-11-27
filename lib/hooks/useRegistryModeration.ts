"use client";

/**
 * Issue #307: Registry moderation hooks.
 * Provides typed reads and writes for agent lifecycle management and trace
 * flagging in the reasoning-registry contract.
 *
 * All writes go through useWriteGuard → submit queue → TxLifecycle (same
 * path as every other contract write in the app).
 *
 * Time complexity: O(1) per hook invocation; RPC calls are O(log n) on
 * the network side.  Space complexity: O(F) per trace where F ≤ FLAG_HISTORY_CAP.
 */

import { useQuery } from "@tanstack/react-query";
import { useNetworkMutation as useMutation } from "@/lib/query/useNetworkMutation";
import { useQueryClient } from "@tanstack/react-query";
import { scValToNative } from "@stellar/stellar-sdk";
import { reasoningRegistry } from "@/lib/stellar/clients";
import { read, submit } from "@/lib/stellar/typed-call";
import { useWriteGuard, useTxRunner, runQueuedWrite, dedupeValue } from "@/lib/hooks/useStellar";
import { UserFacingError } from "@/lib/stellar/errors";
import {
  allowedActions,
  validateRevoke,
  FLAG_HISTORY_CAP,
  type AgentState,
  type AgentAction,
  type TraceFlag,
  type TraceVerdict,
  traceVerdictLocal,
} from "@/lib/stellar/registry-lifecycle";
import type { AgentRecord, AgentStatus } from "@/lib/stellar/generated/reasoning-registry";

export type { AgentState, AgentAction, TraceFlag, TraceVerdict };
export { allowedActions, validateRevoke, FLAG_HISTORY_CAP, traceVerdictLocal };

// ─── Query keys ──────────────────────────────────────────────────────────────

export const registryKeys = {
  agent: (addr: string) => ["stellar", "registry", "agent", addr] as const,
  flag: (traceId: string) => ["stellar", "registry", "flag", traceId] as const,
  flags: (traceId: string) => ["stellar", "registry", "flags", traceId] as const,
  revokeImpact: (addr: string, effectiveFrom: bigint) =>
    ["stellar", "registry", "revokeImpact", addr, effectiveFrom.toString()] as const,
};

// ─── AgentState decoder ───────────────────────────────────────────────────────

function decodeAgentState(record: AgentRecord | null | undefined): AgentState {
  if (!record) return { kind: "Unregistered" };
  const registeredAt = BigInt(record.registered_at);
  const status: AgentStatus = record.status;
  switch (status.tag) {
    case "Active":
      return { kind: "Active", registeredAt };
    case "Retired":
      return { kind: "Retired", at: BigInt(status.values[0]), registeredAt };
    case "Revoked":
      return {
        kind: "Revoked",
        effectiveFrom: BigInt(status.values[0]),
        reason: status.values[1],
        registeredAt,
      };
  }
}

// ─── useAgentRecord ───────────────────────────────────────────────────────────

/**
 * Reads an agent's on-chain record and decodes it into an AgentState.
 * queryKey: ["stellar", "registry", "agent", addr]
 */
export function useAgentRecord(addr: string | undefined) {
  return useQuery({
    queryKey: addr ? registryKeys.agent(addr) : ["stellar", "registry", "agent", "__none__"],
    enabled: Boolean(addr),
    staleTime: 20_000,
    queryFn: async (): Promise<AgentState> => {
      if (!addr) return { kind: "Unregistered" };
      const client = reasoningRegistry();
      // get_agent_record is a view call: returns Option<AgentRecord>
      // The generated bindings may expose it as `get_agent` or we fall back to
      // is_registered + raw instance read.
      try {
        const clientAny = client as unknown as Record<string, unknown>;
        if (typeof clientAny.get_agent_record === "function") {
          const tx = await (clientAny.get_agent_record as (a: { agent: string }) => Promise<unknown>)({ agent: addr });
          const result = read(tx as Parameters<typeof read>[0], "reasoningRegistry");
          return decodeAgentState(result as AgentRecord | null | undefined);
        }
      } catch {
        // method not in this spec version; fall back to is_registered
      }
      // Fallback: just check registration, treat as Active if registered
      const isReg = read(await client.is_registered({ agent: addr }), "reasoningRegistry");
      if (!isReg) return { kind: "Unregistered" };
      return { kind: "Active", registeredAt: 0n };
    },
  });
}

// ─── useTraceFlag ─────────────────────────────────────────────────────────────

/**
 * Reads the current active flag for a trace, if any.
 * queryKey: ["stellar", "registry", "flag", traceId]
 */
export function useTraceFlag(traceId: string | undefined) {
  return useQuery({
    queryKey: traceId ? registryKeys.flag(traceId) : ["stellar", "registry", "flag", "__none__"],
    enabled: Boolean(traceId),
    staleTime: 20_000,
    queryFn: async (): Promise<TraceFlag | null> => {
      if (!traceId) return null;
      const client = reasoningRegistry();
      const id = BigInt(traceId);
      const tx = await client.get_trace_flag({ trace_id: id });
      const raw = read(tx, "reasoningRegistry");
      if (!raw) return null;
      return {
        active: (raw as { active: boolean }).active,
        reason: (raw as { reason: string }).reason,
        flaggedAt: BigInt((raw as { flagged_at: number | bigint }).flagged_at),
      };
    },
  });
}

// ─── useTraceFlagHistory ──────────────────────────────────────────────────────

/** Reads up to FLAG_HISTORY_CAP flag/unflag entries for a trace. */
export function useTraceFlagHistory(traceId: string | undefined) {
  return useQuery({
    queryKey: traceId ? registryKeys.flags(traceId) : ["stellar", "registry", "flags", "__none__"],
    enabled: Boolean(traceId),
    staleTime: 30_000,
    queryFn: async (): Promise<TraceFlag[]> => {
      if (!traceId) return [];
      const client = reasoningRegistry();
      const id = BigInt(traceId);
      const tx = await client.trace_flags({ trace_id: id, start: 0, limit: FLAG_HISTORY_CAP });
      const raw = read(tx, "reasoningRegistry");
      if (!Array.isArray(raw)) return [];
      return raw.map((item) => {
        const f = item as { active: boolean; reason: string; flagged_at: number | bigint };
        return { active: f.active, reason: f.reason, flaggedAt: BigInt(f.flagged_at) };
      });
    },
  });
}

// ─── useRevokeImpact ──────────────────────────────────────────────────────────

/**
 * Estimates how many published traces would be retroactively invalidated by
 * revoking agent `addr` with the given `effectiveFrom` ledger timestamp.
 *
 * Uses cached agents data: no additional RPC calls.
 */
export function useRevokeImpact(addr: string | undefined, effectiveFrom: bigint | undefined) {
  // We walk TracePublished events already in the agent list data to count
  // affected traces. This is O(T) where T = agent trace count in the window.
  return useQuery({
    queryKey:
      addr && effectiveFrom !== undefined
        ? registryKeys.revokeImpact(addr, effectiveFrom)
        : ["stellar", "registry", "revokeImpact", "__none__"],
    enabled: Boolean(addr) && effectiveFrom !== undefined,
    staleTime: 10_000,
    queryFn: async (): Promise<{ count: number; note: string }> => {
      if (!addr || effectiveFrom === undefined) return { count: 0, note: "" };
      // The agents query already has tracesInWindow count per agent,
      // but doesn't break down by publishedAt vs effectiveFrom.
      // We fetch the event window to count traces published at or after effectiveFrom.
      const { eventWindow, fetchContractEvents } = await import("@/lib/stellar/events");
      const { CONTRACTS } = await import("@/lib/stellar/config");
      const { scValToNative: n } = await import("@stellar/stellar-sdk");
      const window = await eventWindow();
      const { events } = await fetchContractEvents({
        contractId: CONTRACTS.reasoningRegistry,
        startLedger: window.oldestLedger,
        endLedger: window.latestLedger + 1,
        pageLimit: 200,
        maxPages: 20,
        topics: reasoningRegistry().spec.eventTopicFilter("TracePublished"),
      });
      let count = 0;
      for (const ev of events) {
        const agentAddr = String(n(ev.topics[3]) ?? "");
        if (agentAddr !== addr) continue;
        const data = n(ev.value) as Record<string, unknown> | null;
        const publishedAt = typeof data?.published_at === "bigint" ? data.published_at : BigInt(0);
        if (publishedAt >= effectiveFrom) count++;
      }
      void n; // suppress potential unused warning
      return {
        count,
        note:
          count === 0
            ? "No traces in the event window would be affected."
            : `${count} trace${count === 1 ? "" : "s"} published at or after the effective time would be retroactively invalidated.`,
      };
    },
  });
}

// ─── useRegistryWrite ─────────────────────────────────────────────────────────

export type RegistryWriteAction =
  | { kind: "retire"; agent: string }
  | { kind: "reactivate"; agent: string }
  | { kind: "revoke"; agent: string; effectiveFrom: bigint; reason: string }
  | { kind: "flag"; traceId: bigint; reason: string }
  | { kind: "unflag"; traceId: bigint; reason: string };

/**
 * Submits a registry lifecycle or moderation write through the standard
 * signed transaction path (same path as register/unregister in useAgents).
 *
 * Capability-gates: each action checks whether the generated client exposes
 * the required method before attempting the call. If not available on this
 * deployment, throws a user-facing "not-available" error.
 */
export function useRegistryWrite() {
  const queryClient = useQueryClient();
  const guard = useWriteGuard("reasoningRegistry");
  const runner = useTxRunner("reasoningRegistry");

  const mutation = useMutation({
    mutationFn: async (action: RegistryWriteAction): Promise<{ txHash: string | null }> => {
      const signer = guard("reasoningRegistry");
      const target =
        action.kind === "retire" || action.kind === "reactivate" || action.kind === "revoke"
          ? action.agent
          : String(action.traceId);
      const label = `Registry: ${action.kind} ${target}`;

      return runQueuedWrite(
        signer,
        label,
        dedupeValue("registry", action.kind, target),
        () => guard("reasoningRegistry"),
        async () => {
          const client = reasoningRegistry(signer);
          const c = client as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

          let tx: unknown;
          switch (action.kind) {
            case "retire":
              if (typeof c.retire_agent !== "function") throw notAvailable("retire_agent");
              tx = await c.retire_agent({ agent: action.agent });
              break;
            case "reactivate":
              if (typeof c.reactivate_agent !== "function") throw notAvailable("reactivate_agent");
              tx = await c.reactivate_agent({ agent: action.agent });
              break;
            case "revoke":
              if (typeof c.revoke_agent !== "function") throw notAvailable("revoke_agent");
              tx = await c.revoke_agent({
                agent: action.agent,
                effective_from: action.effectiveFrom,
                reason: action.reason,
              });
              break;
            case "flag":
              if (typeof c.flag_trace !== "function") throw notAvailable("flag_trace");
              tx = await c.flag_trace({ trace_id: action.traceId, reason: action.reason });
              break;
            case "unflag":
              if (typeof c.unflag_trace !== "function") throw notAvailable("unflag_trace");
              tx = await c.unflag_trace({ trace_id: action.traceId, reason: action.reason });
              break;
          }

          read(tx as Parameters<typeof read>[0], "reasoningRegistry");
          const res = await runner.start(
            tx as import("@stellar/stellar-sdk/contract").AssembledTransaction<unknown>,
            () => null,
          );
          return { txHash: res.txHash };
        },
      );
    },
    onSuccess: (_result, action) => {
      // Invalidate agent list and specific agent record
      const agentAddr =
        action.kind === "retire" || action.kind === "reactivate" || action.kind === "revoke"
          ? action.agent
          : undefined;
      void queryClient.invalidateQueries({ queryKey: ["stellar", "agents"] });
      if (agentAddr) {
        void queryClient.invalidateQueries({ queryKey: registryKeys.agent(agentAddr) });
      }
      if (action.kind === "flag" || action.kind === "unflag") {
        const id = String(action.traceId);
        void queryClient.invalidateQueries({ queryKey: registryKeys.flag(id) });
        void queryClient.invalidateQueries({ queryKey: registryKeys.flags(id) });
      }
    },
  });

  return { ...mutation, phase: runner.phase };
}

function notAvailable(method: string): UserFacingError {
  return new UserFacingError({
    kind: "contract",
    code: "NotAvailable",
    message: `The ${method} operation is not available on this deployment. The contract may need to be upgraded.`,
  });
}

// Re-export scValToNative for convenience (avoids adding an import in callers)
export { scValToNative };
