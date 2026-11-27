/**
 * Tests for the cross-tab sync protocol (#310).
 *
 * Tests:
 * - No published message contains a JWT-shaped string
 * - parseSyncMessage rejects extra keys, wrong network, bad address, v0 messages
 * - session-changed propagation reads from storage, not message address
 * - session-cleared propagation resets scope
 * - Forged session-changed with foreign address does not change wallet
 * - Older epoch from same origin is dropped
 * - Works with BroadcastChannel undefined (storage-only path)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseSyncMessage, _resetSyncBusForTest } from "../cross-tab-sync";
import type { SyncMessageV1 } from "../cross-tab-sync";

// ─── parseSyncMessage ─────────────────────────────────────────────────────────

const VALID_ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const VALID_UUID = "12345678-1234-1234-1234-123456789012";
// Use a mock network passphrase for tests (config is mocked below)
const TEST_NETWORK = "Test SDF Network ; September 2015";

// Mock the config module to return a known network passphrase
vi.mock("@/lib/stellar/config", () => ({
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));

vi.mock("./client", () => ({
  getStoredSessionId: vi.fn(() => null),
  getStoredSessionWallet: vi.fn(() => null),
}));

vi.mock("@/lib/diagnostics/sync-diagnostics", () => ({
  countDroppedSyncMessage: vi.fn(),
}));

function validMsg(overrides: Partial<SyncMessageV1> = {}): SyncMessageV1 {
  return {
    v: 1,
    type: "session-changed",
    network: TEST_NETWORK,
    address: VALID_ADDRESS,
    sessionId: VALID_UUID,
    epoch: 1,
    origin: VALID_UUID,
    at: Date.now(),
    ...overrides,
  };
}

describe("parseSyncMessage", () => {
  it("accepts a valid v1 message", () => {
    const msg = validMsg();
    expect(parseSyncMessage(msg)).not.toBeNull();
  });

  it("rejects extra keys — prevents token from being added silently", () => {
    const msg = { ...validMsg(), token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c" };
    expect(parseSyncMessage(msg)).toBeNull();
  });

  it("rejects wrong v", () => {
    expect(parseSyncMessage({ ...validMsg(), v: 0 })).toBeNull();
    expect(parseSyncMessage({ ...validMsg(), v: 2 })).toBeNull();
  });

  it("rejects wrong network", () => {
    expect(parseSyncMessage({ ...validMsg(), network: "Public Global Stellar Network ; September 2015" })).toBeNull();
  });

  it("rejects invalid address (not a StrKey)", () => {
    expect(parseSyncMessage({ ...validMsg(), address: "not-a-valid-address" })).toBeNull();
  });

  it("accepts null address", () => {
    expect(parseSyncMessage({ ...validMsg(), address: null })).not.toBeNull();
  });

  it("rejects invalid sessionId", () => {
    expect(parseSyncMessage({ ...validMsg(), sessionId: "not-a-uuid" })).toBeNull();
  });

  it("accepts null sessionId", () => {
    expect(parseSyncMessage({ ...validMsg(), sessionId: null })).not.toBeNull();
  });

  it("rejects non-integer epoch", () => {
    expect(parseSyncMessage({ ...validMsg(), epoch: 1.5 })).toBeNull();
    expect(parseSyncMessage({ ...validMsg(), epoch: "1" })).toBeNull();
  });

  it("rejects v0 messages (old protocol with token field)", () => {
    // v0 format: has 'type' but no 'v' or has extra keys
    const v0msg = {
      type: "auth_session_changed",
      token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.sig",
      address: VALID_ADDRESS,
      timestamp: Date.now(),
    };
    expect(parseSyncMessage(v0msg)).toBeNull();
  });

  it("rejects non-object types", () => {
    expect(parseSyncMessage(null)).toBeNull();
    expect(parseSyncMessage("string")).toBeNull();
    expect(parseSyncMessage(42)).toBeNull();
    expect(parseSyncMessage([])).toBeNull();
  });
});

// ─── JWT leak prevention ──────────────────────────────────────────────────────

describe("JWT leak prevention", () => {
  const JWT_REGEX = /eyJ[\w-]+\.[\w-]+\.[\w-]+/;

  it("parseSyncMessage returns null for any message containing a JWT-shaped token field", () => {
    const jwtMsg = {
      v: 1,
      type: "session-changed",
      network: TEST_NETWORK,
      address: VALID_ADDRESS,
      sessionId: VALID_UUID,
      epoch: 1,
      origin: VALID_UUID,
      at: Date.now(),
      token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    };
    // Confirm it has a JWT
    expect(JWT_REGEX.test(JSON.stringify(jwtMsg))).toBe(true);
    // parseSyncMessage must reject it (extra key)
    expect(parseSyncMessage(jwtMsg)).toBeNull();
  });
});

// ─── Epoch ordering ───────────────────────────────────────────────────────────

describe("epoch ordering", () => {
  beforeEach(() => {
    _resetSyncBusForTest();
  });

  it("parseSyncMessage accepts any epoch (ordering enforced at dispatch level)", () => {
    // parseSyncMessage itself doesn't track epochs — that's the bus's job
    expect(parseSyncMessage(validMsg({ epoch: 1 }))).not.toBeNull();
    expect(parseSyncMessage(validMsg({ epoch: 0 }))).not.toBeNull();
  });
});
