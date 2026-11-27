import { rpcServer } from "./clients";
import { NETWORK_PASSPHRASE, TESTNET_PASSPHRASE } from "./config";
import { parseStrictToml, TomlParseError } from "./toml";

/**
 * SEP-1 collateral asset issuer verification (issue #263).
 *
 * Performs a two-way check:
 * 1. Reads the issuer account's `home_domain` from Stellar RPC.
 * 2. Strictly validates the domain (plain public hostname, no IP/localhost/private).
 * 3. Fetches `https://<domain>/.well-known/stellar.toml` over HTTPS only,
 *    with `credentials: "omit"`, bounded body size, timeout, and same-host
 *    HTTPS-only redirects.
 * 4. Parses the TOML strictly and requires a `[[CURRENCIES]]` entry matching
 *    BOTH `code` and `issuer`.
 *
 * Network/CORS/timeout failures produce `"unverifiable"` (distinct from
 * `"unverified"`).
 */

export const DEFAULT_TOML_TIMEOUT_MS = 5_000;
export const MAX_TOML_BYTES = 64 * 1024; // 64 KiB
export const MAX_REDIRECTS = 3;
export const VERIFIED_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
export const FAILURE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_CACHE_ENTRIES = 64;
export const MAX_ORG_NAME_LENGTH = 120;

export type IssuerVerificationResult =
  | {
      status: "verified";
      issuer: string;
      code: string;
      homeDomain: string;
      orgName: string | null;
      checkedAt: number;
    }
  | {
      status: "unverified";
      reason:
        | "no-home-domain"
        | "invalid-domain"
        | "missing-currency"
        | "issuer-mismatch"
        | "malformed-toml"
        | "oversized"
        | "bad-redirect"
        | "http-error";
      detail: string;
      homeDomain?: string;
      checkedAt: number;
    }
  | {
      status: "unverifiable";
      reason: "network-or-cors" | "timeout" | "account-unavailable";
      detail: string;
      homeDomain?: string;
      checkedAt: number;
    };

export interface VerifyIssuerDeps {
  loadHomeDomain?: (issuer: string) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  maxBytes?: number;
  verifiedTtlMs?: number;
  failureTtlMs?: number;
  bypassCache?: boolean;
}

const HOST_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const INT_OR_HEX_IP_RE = /^(?:0x[0-9a-f]+|\d+)$/i;

/**
 * Strictly validates a Stellar `home_domain` value:
 * - Plain hostname only (no scheme, userinfo, port, path, query, fragment)
 * - Rejects IPv4, IPv6, integer/hex IPs, localhost, `.local`, `.internal`, `.arpa`
 */
export function validateHomeDomain(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 253) return null;
  if (/[\s/:?#@\\[\]]/.test(trimmed)) return null;
  if (trimmed.startsWith(".") || trimmed.endsWith(".")) return null;

  const lower = trimmed.toLowerCase();
  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".localdomain") ||
    lower.endsWith(".internal") ||
    lower.endsWith(".arpa")
  ) {
    return null;
  }

  if (IPV4_RE.test(lower) || INT_OR_HEX_IP_RE.test(lower)) return null;

  const labels = lower.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((label) => HOST_LABEL_RE.test(label))) return null;
  // TLD must not be all-numeric (prevents numeric IPv4 lookalikes)
  if (/^\d+$/.test(labels[labels.length - 1])) return null;

  return lower;
}

export function isMainnetPassphrase(passphrase: string = NETWORK_PASSPHRASE): boolean {
  return passphrase !== TESTNET_PASSPHRASE;
}

async function defaultLoadHomeDomain(issuer: string): Promise<string | null> {
  const account = await rpcServer().getAccountEntry(issuer);
  const raw = account.homeDomain();
  if (typeof raw === "string") return raw.trim() || null;
  if (raw && typeof (raw as Uint8Array).length === "number") {
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(raw as Uint8Array).replace(/\0+$/, "").trim();
    return decoded || null;
  }
  return null;
}

async function readBoundedText(res: Response, maxBytes: number): Promise<string> {
  const contentLength = res.headers.get("content-length");
  if (contentLength !== null) {
    const len = Number(contentLength);
    if (Number.isFinite(len) && len > maxBytes) {
      throw new Error("OVERSIZED");
    }
  }

  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > maxBytes) {
            void reader.cancel();
            throw new Error("OVERSIZED");
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8").decode(merged);
  }

  const text = await res.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error("OVERSIZED");
  }
  return text;
}

async function fetchStellarToml(
  domain: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; result: Omit<IssuerVerificationResult, "checkedAt"> }> {
  let currentUrl = `https://${domain}/.well-known/stellar.toml`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let res: Response;
      try {
        res = await fetchImpl(currentUrl, {
          method: "GET",
          credentials: "omit",
          redirect: "manual",
          signal: controller.signal,
          headers: { Accept: "text/plain, application/toml, */*;q=0.1" },
        });
      } catch (err) {
        if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
          return {
            ok: false,
            result: {
              status: "unverifiable",
              reason: "timeout",
              homeDomain: domain,
              detail: `Timed out fetching stellar.toml from ${domain}.`,
            },
          };
        }
        return {
          ok: false,
          result: {
            status: "unverifiable",
            reason: "network-or-cors",
            homeDomain: domain,
            detail: `Could not fetch stellar.toml from ${domain} (network or CORS restriction).`,
          },
        };
      }

      if (res.type === "opaqueredirect") {
        return {
          ok: false,
          result: {
            status: "unverified",
            reason: "bad-redirect",
            homeDomain: domain,
            detail: `stellar.toml on ${domain} returned an opaque redirect.`,
          },
        };
      }

      if (res.status >= 300 && res.status < 400) {
        if (hop >= MAX_REDIRECTS) {
          return {
            ok: false,
            result: {
              status: "unverified",
              reason: "bad-redirect",
              homeDomain: domain,
              detail: `Too many redirects fetching stellar.toml from ${domain}.`,
            },
          };
        }
        const location = res.headers.get("location");
        if (!location) {
          return {
            ok: false,
            result: {
              status: "unverified",
              reason: "bad-redirect",
              homeDomain: domain,
              detail: `Redirect without Location header from ${domain}.`,
            },
          };
        }
        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          return {
            ok: false,
            result: {
              status: "unverified",
              reason: "bad-redirect",
              homeDomain: domain,
              detail: `Malformed redirect URL from ${domain}.`,
            },
          };
        }
        if (nextUrl.protocol !== "https:" || nextUrl.hostname.toLowerCase() !== domain) {
          return {
            ok: false,
            result: {
              status: "unverified",
              reason: "bad-redirect",
              homeDomain: domain,
              detail: `stellar.toml redirect to ${nextUrl.protocol}//${nextUrl.hostname} is not allowed.`,
            },
          };
        }
        currentUrl = nextUrl.toString();
        continue;
      }

      if (!res.ok) {
        return {
          ok: false,
          result: {
            status: "unverified",
            reason: "http-error",
            homeDomain: domain,
            detail: `${domain} returned HTTP ${res.status} for stellar.toml.`,
          },
        };
      }

      try {
        const text = await readBoundedText(res, maxBytes);
        return { ok: true, text };
      } catch (err) {
        if (err instanceof Error && err.message === "OVERSIZED") {
          return {
            ok: false,
            result: {
              status: "unverified",
              reason: "oversized",
              homeDomain: domain,
              detail: `stellar.toml on ${domain} exceeded the ${maxBytes}-byte limit.`,
            },
          };
        }
        return {
          ok: false,
          result: {
            status: "unverifiable",
            reason: "network-or-cors",
            homeDomain: domain,
            detail: `Failed reading stellar.toml response from ${domain}.`,
          },
        };
      }
    }

    return {
      ok: false,
      result: {
        status: "unverified",
        reason: "bad-redirect",
        homeDomain: domain,
        detail: `Too many redirects fetching stellar.toml from ${domain}.`,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

interface CacheEntry {
  result: IssuerVerificationResult;
  expiresAt: number;
}

const verificationCache = new Map<string, CacheEntry>();

export function clearIssuerVerificationCache(): void {
  verificationCache.clear();
}

function setBoundedCache(key: string, entry: CacheEntry): void {
  if (verificationCache.has(key)) {
    verificationCache.delete(key);
  } else if (verificationCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = verificationCache.keys().next().value;
    if (oldestKey !== undefined) verificationCache.delete(oldestKey);
  }
  verificationCache.set(key, entry);
}

/**
 * Verifies a classic Stellar asset issuer against its `home_domain`'s
 * `/.well-known/stellar.toml` (SEP-1).
 */
export async function verifyAssetIssuer(
  code: string,
  issuer: string,
  deps: VerifyIssuerDeps = {},
): Promise<IssuerVerificationResult> {
  const now = deps.now ?? Date.now;
  const cacheKey = `${code}:${issuer}`;
  const currentTime = now();

  if (!deps.bypassCache) {
    const cached = verificationCache.get(cacheKey);
    if (cached && currentTime < cached.expiresAt) {
      return cached.result;
    }
  }

  const verifiedTtlMs = deps.verifiedTtlMs ?? VERIFIED_CACHE_TTL_MS;
  const failureTtlMs = deps.failureTtlMs ?? FAILURE_CACHE_TTL_MS;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TOML_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? MAX_TOML_BYTES;
  const loadHomeDomain = deps.loadHomeDomain ?? defaultLoadHomeDomain;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;

  const cacheAndReturn = (result: IssuerVerificationResult): IssuerVerificationResult => {
    if (!deps.bypassCache) {
      const ttl = result.status === "verified" ? verifiedTtlMs : failureTtlMs;
      setBoundedCache(cacheKey, { result, expiresAt: currentTime + ttl });
    }
    return result;
  };

  let rawDomain: string | null;
  try {
    rawDomain = await loadHomeDomain(issuer);
  } catch {
    return cacheAndReturn({
      status: "unverifiable",
      reason: "account-unavailable",
      detail: "Could not load the issuer account from Stellar RPC.",
      checkedAt: currentTime,
    });
  }

  if (!rawDomain) {
    return cacheAndReturn({
      status: "unverified",
      reason: "no-home-domain",
      detail: "The asset issuer account has no home_domain set.",
      checkedAt: currentTime,
    });
  }

  const domain = validateHomeDomain(rawDomain);
  if (!domain) {
    return cacheAndReturn({
      status: "unverified",
      reason: "invalid-domain",
      detail: "The issuer account's home_domain is not a valid public hostname.",
      checkedAt: currentTime,
    });
  }

  const fetched = await fetchStellarToml(domain, fetchImpl, timeoutMs, maxBytes);
  if (!fetched.ok) {
    return cacheAndReturn({ ...fetched.result, checkedAt: currentTime });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseStrictToml(fetched.text);
  } catch (err) {
    return cacheAndReturn({
      status: "unverified",
      reason: "malformed-toml",
      homeDomain: domain,
      detail: err instanceof TomlParseError ? err.message : "Invalid stellar.toml syntax.",
      checkedAt: currentTime,
    });
  }

  const currencies = Array.isArray(parsed.CURRENCIES) ? parsed.CURRENCIES : [];
  let sawSameCodeDifferentIssuer = false;
  let matchedCurrency = false;

  for (const item of currencies) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (entry.code === code) {
      if (entry.issuer === issuer) {
        matchedCurrency = true;
        break;
      }
      sawSameCodeDifferentIssuer = true;
    }
  }

  if (!matchedCurrency) {
    return cacheAndReturn({
      status: "unverified",
      reason: sawSameCodeDifferentIssuer ? "issuer-mismatch" : "missing-currency",
      homeDomain: domain,
      detail: sawSameCodeDifferentIssuer
        ? `${domain}'s stellar.toml lists ${code} under a different issuer.`
        : `${domain}'s stellar.toml does not list ${code} for this issuer.`,
      checkedAt: currentTime,
    });
  }

  const doc = parsed.DOCUMENTATION;
  let orgName: string | null = null;
  if (doc && typeof doc === "object" && typeof (doc as Record<string, unknown>).ORG_NAME === "string") {
    const rawOrg = ((doc as Record<string, unknown>).ORG_NAME as string).trim();
    if (rawOrg) {
      orgName = rawOrg.slice(0, MAX_ORG_NAME_LENGTH);
    }
  }

  return cacheAndReturn({
    status: "verified",
    issuer,
    code,
    homeDomain: domain,
    orgName,
    checkedAt: currentTime,
  });
}
