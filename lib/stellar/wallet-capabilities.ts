/**
 * Which Soroban wallet features each Stellar Wallets Kit module supports.
 *
 * The kit gives every module the same method signatures, but a module that lacks
 * a feature throws `{ code: -3, message: '<Product> does not support "<method>"' }`
 * only at call time. This registry lets the app explain that before a flow starts,
 * and learns real outcomes so a wrong static entry self-corrects.
 */

export type Cap = "signAuthEntry" | "getNetwork" | "signMessage" | "preservesExistingSignatures";
export type Tri = "yes" | "no" | "unknown";

/** Kit version the static table was checked against. A bump must review the table. */
export const KIT_VERSION = "2.5.0";

/** Static support by kit module id (lowercase product id). Absent modules are "unknown". */
export const STATIC_CAPS: Record<string, Partial<Record<Cap, Tri>>> = {
  albedo: { signAuthEntry: "no", getNetwork: "no", signMessage: "no" },
  bitget: { signAuthEntry: "no" },
  fordefi: { signAuthEntry: "no" },
  hana: { getNetwork: "no" },
  lobstr: { signAuthEntry: "no", getNetwork: "no" },
  onekey: { getNetwork: "no" },
  rabet: { signAuthEntry: "no", getNetwork: "no", signMessage: "no" },
  xbull: { signAuthEntry: "no", getNetwork: "no" },
  ledger: { signAuthEntry: "no" },
  trezor: { signAuthEntry: "no" },
  walletconnect: { getNetwork: "no" },
  freighter: { signAuthEntry: "yes", getNetwork: "yes", signMessage: "yes" },
};

const STORAGE_KEY = "oracledesk_wallet_caps:v1";
/** Learned negatives expire so an outdated "unsupported" never locks a user out for good. */
export const LEARNED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type LearnedOutcome = "ok" | "unsupported";
interface LearnedEntry {
  kit: string;
  ext?: string;
  caps: Partial<Record<Cap, LearnedOutcome>>;
  at: number;
}
type LearnedStore = Record<string, LearnedEntry>;

function readStore(): LearnedStore {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as LearnedStore) : {};
  } catch {
    return {};
  }
}

function writeStore(store: LearnedStore): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage disabled or full: the registry simply does not learn this session.
  }
}

/**
 * Records a real outcome for a module feature. Only user-initiated calls may
 * feed the registry; probing a supported method would open a wallet prompt.
 */
export function recordOutcome(
  moduleId: string,
  cap: Cap,
  outcome: LearnedOutcome,
  ctx: { extensionVersion?: string; now?: number } = {},
): void {
  const store = readStore();
  const now = ctx.now ?? Date.now();
  const previous = store[moduleId];
  const sameBuild = previous !== undefined && previous.kit === KIT_VERSION && previous.ext === ctx.extensionVersion;
  store[moduleId] = {
    kit: KIT_VERSION,
    ...(ctx.extensionVersion ? { ext: ctx.extensionVersion } : {}),
    caps: { ...(sameBuild ? previous.caps : {}), [cap]: outcome },
    at: now,
  };
  writeStore(store);
}

/**
 * Effective support for a module. Precedence: a fresh learned "unsupported"
 * overrides a static "yes"; a learned "ok" fills in a static "unknown". Learned
 * entries from another kit version, another extension build, or older than the
 * TTL are ignored.
 */
export function effectiveCaps(
  moduleId: string | null | undefined,
  opts: { extensionVersion?: string; now?: number } = {},
): Record<Cap, Tri> {
  const base: Record<Cap, Tri> = {
    signAuthEntry: "unknown",
    getNetwork: "unknown",
    signMessage: "unknown",
    preservesExistingSignatures: "unknown",
  };
  if (!moduleId) return base;
  const staticCaps = STATIC_CAPS[moduleId] ?? {};
  for (const cap of Object.keys(base) as Cap[]) base[cap] = staticCaps[cap] ?? "unknown";

  const learned = readStore()[moduleId];
  const now = opts.now ?? Date.now();
  if (!learned || learned.kit !== KIT_VERSION || learned.ext !== opts.extensionVersion) return base;
  if (now - learned.at > LEARNED_TTL_MS) return base;

  for (const cap of Object.keys(base) as Cap[]) {
    const outcome = learned.caps[cap];
    if (outcome === "unsupported") base[cap] = "no";
    else if (outcome === "ok" && base[cap] === "unknown") base[cap] = "yes";
  }
  return base;
}

/** Kit error code -3: the selected module does not implement the called method. */
export function isKitUnsupported(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  const message = (err as { message?: unknown }).message;
  return code === -3 || (typeof message === "string" && /do(?:es)? not support/i.test(message));
}

/** Modules the static table says can sign Soroban authorization entries. */
export function modulesSupporting(cap: Cap): string[] {
  return Object.keys(STATIC_CAPS).filter((id) => STATIC_CAPS[id][cap] === "yes");
}
