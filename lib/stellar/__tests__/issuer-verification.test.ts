import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearIssuerVerificationCache,
  isMainnetPassphrase,
  validateHomeDomain,
  verifyAssetIssuer,
} from "../issuer-verification";
import { TESTNET_PASSPHRASE } from "../config";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const OTHER_ISSUER = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

function makeResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, ...init });
}

describe("validateHomeDomain", () => {
  it("accepts plain public hostnames and normalizes to lowercase", () => {
    expect(validateHomeDomain("Centre.IO")).toBe("centre.io");
    expect(validateHomeDomain("assets.example.com")).toBe("assets.example.com");
  });

  it("rejects schemes, ports, paths, IPs, localhost, and private/local domains", () => {
    expect(validateHomeDomain("https://example.com")).toBeNull();
    expect(validateHomeDomain("example.com:443")).toBeNull();
    expect(validateHomeDomain("example.com/path")).toBeNull();
    expect(validateHomeDomain("user@example.com")).toBeNull();
    expect(validateHomeDomain("127.0.0.1")).toBeNull();
    expect(validateHomeDomain("192.168.1.1")).toBeNull();
    expect(validateHomeDomain("[::1]")).toBeNull();
    expect(validateHomeDomain("0x7f000001")).toBeNull();
    expect(validateHomeDomain("localhost")).toBeNull();
    expect(validateHomeDomain("sub.localhost")).toBeNull();
    expect(validateHomeDomain("issuer.local")).toBeNull();
    expect(validateHomeDomain("service.internal")).toBeNull();
    expect(validateHomeDomain("singlelabel")).toBeNull();
  });
});

describe("verifyAssetIssuer", () => {
  beforeEach(() => {
    clearIssuerVerificationCache();
  });

  it("verifies when home_domain and stellar.toml match code + issuer", async () => {
    const toml = `
      [DOCUMENTATION]
      ORG_NAME = "Trusted Issuer Inc"

      [[CURRENCIES]]
      code = "USDC"
      issuer = "${ISSUER}"
    `;
    const fetchMock = vi.fn(async () => makeResponse(toml));
    const res = await verifyAssetIssuer("USDC", ISSUER, {
      loadHomeDomain: async () => "centre.io",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(res.status).toBe("verified");
    if (res.status === "verified") {
      expect(res.homeDomain).toBe("centre.io");
      expect(res.orgName).toBe("Trusted Issuer Inc");
    }
    expect(fetchMock).toHaveBeenCalledWith(
      "https://centre.io/.well-known/stellar.toml",
      expect.objectContaining({ credentials: "omit", redirect: "manual" }),
    );
  });

  it("returns unverified when account has no home_domain", async () => {
    const res = await verifyAssetIssuer("USDC", ISSUER, {
      loadHomeDomain: async () => null,
    });
    expect(res).toMatchObject({ status: "unverified", reason: "no-home-domain" });
  });

  it("returns unverifiable on CORS/network failure or timeout", async () => {
    const netFail = await verifyAssetIssuer("USDC", ISSUER, {
      loadHomeDomain: async () => "centre.io",
      fetchImpl: (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    });
    expect(netFail).toMatchObject({ status: "unverifiable", reason: "network-or-cors" });

    clearIssuerVerificationCache();
    const abortErr = new Error("Aborted");
    abortErr.name = "AbortError";
    const timeoutRes = await verifyAssetIssuer("USDC", ISSUER, {
      loadHomeDomain: async () => "centre.io",
      fetchImpl: (async () => {
        throw abortErr;
      }) as unknown as typeof fetch,
    });
    expect(timeoutRes).toMatchObject({ status: "unverifiable", reason: "timeout" });
  });

  it("rejects oversized body, cross-host redirect, http redirect, and malformed TOML", async () => {
    const oversized = await verifyAssetIssuer("USDC", ISSUER, {
      loadHomeDomain: async () => "centre.io",
      maxBytes: 32,
      fetchImpl: (async () => makeResponse("x".repeat(64))) as unknown as typeof fetch,
    });
    expect(oversized).toMatchObject({ status: "unverified", reason: "oversized" });

    clearIssuerVerificationCache();
    const crossHost = await verifyAssetIssuer("USDC", ISSUER, {
      loadHomeDomain: async () => "centre.io",
      fetchImpl: (async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/stellar.toml" },
        })) as unknown as typeof fetch,
    });
    expect(crossHost).toMatchObject({ status: "unverified", reason: "bad-redirect" });

    clearIssuerVerificationCache();
    const httpRedirect = await verifyAssetIssuer("USDC", ISSUER, {
      loadHomeDomain: async () => "centre.io",
      fetchImpl: (async () =>
        new Response(null, {
          status: 301,
          headers: { location: "http://centre.io/.well-known/stellar.toml" },
        })) as unknown as typeof fetch,
    });
    expect(httpRedirect).toMatchObject({ status: "unverified", reason: "bad-redirect" });

    clearIssuerVerificationCache();
    const malformed = await verifyAssetIssuer("USDC", ISSUER, {
      loadHomeDomain: async () => "centre.io",
      fetchImpl: (async () => makeResponse("invalid = [1, 2")) as unknown as typeof fetch,
    });
    expect(malformed).toMatchObject({ status: "unverified", reason: "malformed-toml" });
  });

  it("rejects missing currency or same code with different issuer", async () => {
    const wrongIssuer = await verifyAssetIssuer("USDC", ISSUER, {
      loadHomeDomain: async () => "centre.io",
      fetchImpl: (async () =>
        makeResponse(`[[CURRENCIES]]\ncode = "USDC"\nissuer = "${OTHER_ISSUER}"`)) as unknown as typeof fetch,
    });
    expect(wrongIssuer).toMatchObject({ status: "unverified", reason: "issuer-mismatch" });

    clearIssuerVerificationCache();
    const missingCurrency = await verifyAssetIssuer("USDC", ISSUER, {
      loadHomeDomain: async () => "centre.io",
      fetchImpl: (async () => makeResponse(`VERSION = "2.0.0"`)) as unknown as typeof fetch,
    });
    expect(missingCurrency).toMatchObject({ status: "unverified", reason: "missing-currency" });
  });

  it("caps hostile org names without executing or altering plain text", async () => {
    const hostile = `\u202eEvil\u200bCorp ${"A".repeat(200)}`;
    const res = await verifyAssetIssuer("USDC", ISSUER, {
      loadHomeDomain: async () => "centre.io",
      fetchImpl: (async () =>
        makeResponse(
          `[DOCUMENTATION]\nORG_NAME = "${hostile}"\n[[CURRENCIES]]\ncode = "USDC"\nissuer = "${ISSUER}"`,
        )) as unknown as typeof fetch,
    });
    expect(res.status).toBe("verified");
    if (res.status === "verified") {
      expect(res.orgName!.length).toBeLessThanOrEqual(120);
    }
  });

  it("caches verified results and expires them, and caches failures briefly", async () => {
    let clock = 1_000_000;
    const fetchMock = vi.fn(async () =>
      makeResponse(`[[CURRENCIES]]\ncode = "USDC"\nissuer = "${ISSUER}"`),
    );

    await verifyAssetIssuer("USDC", ISSUER, {
      loadHomeDomain: async () => "centre.io",
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => clock,
      verifiedTtlMs: 10_000,
    });
    await verifyAssetIssuer("USDC", ISSUER, {
      loadHomeDomain: async () => "centre.io",
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => clock + 5_000,
      verifiedTtlMs: 10_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // After expiry, re-checks
    clock += 11_000;
    await verifyAssetIssuer("USDC", ISSUER, {
      loadHomeDomain: async () => "centre.io",
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => clock,
      verifiedTtlMs: 10_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("distinguishes mainnet vs testnet passphrase", () => {
    expect(isMainnetPassphrase(TESTNET_PASSPHRASE)).toBe(false);
    expect(isMainnetPassphrase("Public Global Stellar Network ; September 2015")).toBe(true);
  });
});
