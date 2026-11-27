/**
 * Pure state machine mirroring contracts/reasoning-registry/src/lib.rs
 * agent lifecycle states, moderation flags, and trace validation rules.
 */

export type AgentState =
  | { kind: "Unregistered" }
  | { kind: "Active"; registeredAt: bigint }
  | { kind: "Retired"; at: bigint; registeredAt: bigint }
  | {
      kind: "Revoked";
      effectiveFrom: bigint;
      reason: string;
      registeredAt: bigint;
    };

export type AgentAction = "register" | "retire" | "reactivate" | "revoke";

/**
 * Returns allowed admin actions based on the contract lifecycle state:
 * - Unregistered: can only register.
 * - Active: can retire or revoke.
 * - Retired: can reactivate or revoke.
 * - Revoked: terminal state; reactivate/retire return CannotReactivateRevoked,
 *   but revoke is permitted to adjust effective_from to an earlier bound.
 */
export function allowedActions(s: AgentState): AgentAction[] {
  switch (s.kind) {
    case "Unregistered":
      return ["register"];
    case "Active":
      return ["retire", "revoke"];
    case "Retired":
      return ["reactivate", "revoke"];
    case "Revoked":
      return ["revoke"];
  }
}

/**
 * Validates revoke parameters against contract invariants:
 * registered_at <= effective_from <= ledger_now
 */
export function validateRevoke(
  s: AgentState,
  effectiveFrom: bigint,
  ledgerNow: bigint
): string | null {
  if (s.kind === "Unregistered") {
    return "Agent is not registered.";
  }
  if (effectiveFrom < s.registeredAt) {
    return "Effective time cannot be before the agent's registration timestamp.";
  }
  if (effectiveFrom > ledgerNow) {
    return "Effective time cannot be in the future (InvalidEffectiveTime).";
  }
  return null;
}

export interface TraceFlag {
  active: boolean;
  reason: string;
  flaggedAt?: bigint;
}

export type TraceVerdict =
  | "Valid"
  | "HashMismatch"
  | { Flagged: string }
  | { AgentRevokedAfter: bigint };

/**
 * Evaluates the verdict of a trace locally matching contract trace_verdict:
 * 1. Cryptographic content hash integrity (hashOk).
 * 2. Active trace flag (moderation reason).
 * 3. Retroactive agent revocation (publishedAt >= effectiveFrom).
 * 4. Valid.
 */
export function traceVerdictLocal(
  trace: { publishedAt: bigint; hashOk: boolean },
  flag: TraceFlag | null,
  agent: AgentState
): TraceVerdict {
  if (!trace.hashOk) {
    return "HashMismatch";
  }
  if (flag && flag.active) {
    return { Flagged: flag.reason };
  }
  if (agent.kind === "Revoked" && trace.publishedAt >= agent.effectiveFrom) {
    return { AgentRevokedAfter: agent.effectiveFrom };
  }
  return "Valid";
}

/** Maximum number of flag entries preserved in contract ring buffer */
export const FLAG_HISTORY_CAP = 16;
