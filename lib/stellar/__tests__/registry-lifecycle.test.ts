import { describe, it, expect } from "vitest";
import {
  allowedActions,
  validateRevoke,
  traceVerdictLocal,
  FLAG_HISTORY_CAP,
  type AgentState,
  type TraceFlag,
} from "../registry-lifecycle";

// ─── allowedActions ───────────────────────────────────────────────────────────

describe("allowedActions", () => {
  it("Unregistered → register only", () => {
    expect(allowedActions({ kind: "Unregistered" })).toEqual(["register"]);
  });

  it("Active → retire | revoke", () => {
    const actions = allowedActions({ kind: "Active", registeredAt: 100n });
    expect(actions).toContain("retire");
    expect(actions).toContain("revoke");
    expect(actions).not.toContain("register");
    expect(actions).not.toContain("reactivate");
  });

  it("Retired → reactivate | revoke", () => {
    const actions = allowedActions({ kind: "Retired", at: 200n, registeredAt: 100n });
    expect(actions).toContain("reactivate");
    expect(actions).toContain("revoke");
    expect(actions).not.toContain("retire");
    expect(actions).not.toContain("register");
  });

  it("Revoked → revoke only (adjust effectiveFrom)", () => {
    const actions = allowedActions({
      kind: "Revoked",
      effectiveFrom: 150n,
      reason: "Misbehaviour",
      registeredAt: 100n,
    });
    expect(actions).toEqual(["revoke"]);
  });
});

// ─── validateRevoke ───────────────────────────────────────────────────────────

describe("validateRevoke", () => {
  const active: AgentState = { kind: "Active", registeredAt: 100n };

  it("returns null for valid effectiveFrom in [registeredAt, ledgerNow]", () => {
    expect(validateRevoke(active, 150n, 200n)).toBeNull();
  });

  it("returns null for effectiveFrom === registeredAt", () => {
    expect(validateRevoke(active, 100n, 200n)).toBeNull();
  });

  it("returns null for effectiveFrom === ledgerNow", () => {
    expect(validateRevoke(active, 200n, 200n)).toBeNull();
  });

  it("errors when effectiveFrom < registeredAt", () => {
    const err = validateRevoke(active, 50n, 200n);
    expect(err).toBeTruthy();
    expect(err).toMatch(/before.*registration/i);
  });

  it("errors when effectiveFrom > ledgerNow", () => {
    const err = validateRevoke(active, 300n, 200n);
    expect(err).toBeTruthy();
    expect(err).toMatch(/future|invalid.*effective/i);
  });

  it("errors for Unregistered agent", () => {
    const err = validateRevoke({ kind: "Unregistered" }, 100n, 200n);
    expect(err).toBeTruthy();
  });

  it("validates for Revoked agent (adjusting effectiveFrom is allowed)", () => {
    const revoked: AgentState = {
      kind: "Revoked",
      effectiveFrom: 150n,
      reason: "Test",
      registeredAt: 100n,
    };
    expect(validateRevoke(revoked, 120n, 200n)).toBeNull();
  });
});

// ─── traceVerdictLocal ────────────────────────────────────────────────────────

describe("traceVerdictLocal", () => {
  const noFlag: TraceFlag | null = null;
  const activeFlag: TraceFlag = { active: true, reason: "Bad trace" };
  const inactiveFlag: TraceFlag = { active: false, reason: "Previously flagged" };
  const activeAgent: AgentState = { kind: "Active", registeredAt: 100n };

  it("Priority 1: returns HashMismatch when hashOk is false", () => {
    const result = traceVerdictLocal({ publishedAt: 200n, hashOk: false }, activeFlag, activeAgent);
    expect(result).toBe("HashMismatch");
  });

  it("Priority 2: returns Flagged when flag is active, even for valid hash", () => {
    const result = traceVerdictLocal({ publishedAt: 200n, hashOk: true }, activeFlag, activeAgent);
    expect(result).toEqual({ Flagged: "Bad trace" });
  });

  it("Inactive flag is not Flagged", () => {
    const result = traceVerdictLocal({ publishedAt: 200n, hashOk: true }, inactiveFlag, activeAgent);
    expect(result).toBe("Valid");
  });

  it("Priority 3: returns AgentRevokedAfter when agent is Revoked and publishedAt >= effectiveFrom", () => {
    const revoked: AgentState = {
      kind: "Revoked",
      effectiveFrom: 150n,
      reason: "Test",
      registeredAt: 100n,
    };
    const result = traceVerdictLocal({ publishedAt: 200n, hashOk: true }, noFlag, revoked);
    expect(result).toEqual({ AgentRevokedAfter: 150n });
  });

  it("publishedAt exactly at effectiveFrom is covered by revocation", () => {
    const revoked: AgentState = {
      kind: "Revoked",
      effectiveFrom: 200n,
      reason: "Test",
      registeredAt: 100n,
    };
    const result = traceVerdictLocal({ publishedAt: 200n, hashOk: true }, noFlag, revoked);
    expect(result).toEqual({ AgentRevokedAfter: 200n });
  });

  it("publishedAt before effectiveFrom is Valid despite revocation", () => {
    const revoked: AgentState = {
      kind: "Revoked",
      effectiveFrom: 300n,
      reason: "Test",
      registeredAt: 100n,
    };
    const result = traceVerdictLocal({ publishedAt: 200n, hashOk: true }, noFlag, revoked);
    expect(result).toBe("Valid");
  });

  it("Priority 4: returns Valid when all checks pass", () => {
    const result = traceVerdictLocal({ publishedAt: 200n, hashOk: true }, noFlag, activeAgent);
    expect(result).toBe("Valid");
  });

  it("HashMismatch wins over active flag (priority 1 > 2)", () => {
    const result = traceVerdictLocal({ publishedAt: 200n, hashOk: false }, activeFlag, activeAgent);
    expect(result).toBe("HashMismatch");
  });
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe("FLAG_HISTORY_CAP", () => {
  it("is 16 as per contract spec", () => {
    expect(FLAG_HISTORY_CAP).toBe(16);
  });
});
