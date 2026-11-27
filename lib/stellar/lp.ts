import { StrKey } from "@stellar/stellar-sdk";
import { BPS, priceYesBps, seedReserves, settleValue, type Settlement } from "./generated/fpmm";
import type { Market } from "./generated/market-core";
import { mulDivCeil } from "./units";

/** Basis-point denominator used by the contract's fee split. */
const FEE_BPS_DENOMINATOR = 10_000n;

export interface LpSeed { amount: bigint; initialYesBps: bigint }
export interface LpView {
  isFinal: boolean;
  settlement: Settlement | null;
  poolYes: bigint; poolNo: bigint;
  poolValue: bigint;
  claimable: bigint | null;
  claimed: boolean;
  /** Protocol share of trading fees (`market.fees_accrued`). Not creator income. */
  feesAccrued: bigint;
  /** Unclaimed LP share of trading fees, when the fee balance was read; 0 otherwise. */
  lpFees: bigint;
  /** Remainder plus unclaimed LP fees, when final and unclaimed; null otherwise. */
  remainderWithFees: bigint | null;
  seed?: LpSeed & { creatorYes: bigint; creatorNo: bigint };
}

/** Per-market fee snapshot the contract stores at creation (`FeeTerms`) and the LP fee balance (`LpFees`). */
export interface LpFeesView {
  terms: { recipient: string; protocolShareBps: bigint } | null;
  accrued: bigint;
  claimedLifetime: bigint | null;
}

/**
 * Exact split of one trade fee, matching the contract's `math::split_fee`: the
 * protocol portion rounds up, so `protocol + lp === fee` always holds.
 */
export function splitFee(fee: bigint, protocolShareBps: bigint): { protocol: bigint; lp: bigint } {
  if (fee < 0n) throw new RangeError("fee must be non-negative");
  if (protocolShareBps < 0n || protocolShareBps > FEE_BPS_DENOMINATOR) {
    throw new RangeError("protocolShareBps must be within 0..10000");
  }
  const protocol = mulDivCeil(fee, protocolShareBps, FEE_BPS_DENOMINATOR);
  return { protocol, lp: fee - protocol };
}

/**
 * Checks a transfer_lp recipient before any transaction is built. Returns a
 * user-facing reason, or null when the recipient is acceptable.
 */
export function validateLpRecipient(recipient: string, currentLp: string | null | undefined): string | null {
  const value = recipient.trim();
  if (value === "") return "Enter the new LP's account address.";
  if (!StrKey.isValidEd25519PublicKey(value)) return "Enter a G… account address.";
  if (value === currentLp) return "That address already holds the LP role.";
  return null;
}
export function settlementOf(status: Market["status"]): Settlement | null {
  if (status.tag === "Open") return null;
  if (status.tag === "Void") return "void";
  return status.values[0].tag === "Yes" ? "yes" : "no";
}

/** Only show backend seed metadata when this exact on-chain snapshot proves it. */
export function verifiedSeed(market: Market, seed?: LpSeed): LpView["seed"] {
  if (!seed || market.lp_claimed || market.sets_minted !== seed.amount) return undefined;
  try {
    const initial = seedReserves(seed.amount, seed.initialYesBps);
    if (initial.reserveYes !== market.reserve_yes || initial.reserveNo !== market.reserve_no) return undefined;
    return { ...seed, creatorYes: initial.creatorYes, creatorNo: initial.creatorNo };
  } catch { return undefined; }
}

/** Floats are used only for the backend probability -> integer bps boundary. */
export function backendSeed(market: Market, backend?: { seedAmountRaw: string | null; initialYesProb: number } | null): LpSeed | undefined {
  if (!backend?.seedAmountRaw || !/^\d+$/.test(backend.seedAmountRaw) || !Number.isFinite(backend.initialYesProb)) return undefined;
  const seed = { amount: BigInt(backend.seedAmountRaw), initialYesBps: BigInt(Math.round(backend.initialYesProb * 10_000)) };
  return verifiedSeed(market, seed) ? seed : undefined;
}

/** Contract-exact base-unit math. Protocol fees are a treasury liability; LP fees are the creator's. */
export function lpView(market: Market, seed?: LpSeed, fees?: LpFeesView): LpView {
  const settlement = settlementOf(market.status);
  const poolYes = market.reserve_yes; const poolNo = market.reserve_no;
  const price = settlement === null && poolYes + poolNo > 0n ? priceYesBps(poolYes, poolNo) : 0n;
  const poolValue = settlement === null ? (poolYes * price + poolNo * (BPS - price)) / BPS : settleValue(settlement, poolYes, poolNo);
  return {
    isFinal: settlement !== null, settlement, poolYes, poolNo, poolValue,
    claimable: settlement === null ? null : market.lp_claimed ? 0n : settleValue(settlement, poolYes, poolNo),
    claimed: market.lp_claimed, feesAccrued: market.fees_accrued,
    lpFees: fees?.accrued ?? 0n,
    remainderWithFees:
      settlement === null || market.lp_claimed ? null : settleValue(settlement, poolYes, poolNo) + (fees?.accrued ?? 0n),
    seed: verifiedSeed(market, seed),
  };
}

export function isWalletCreator(market: Market, address: string | null | undefined): boolean {
  return Boolean(address?.startsWith("G") && market.creator === address);
}
