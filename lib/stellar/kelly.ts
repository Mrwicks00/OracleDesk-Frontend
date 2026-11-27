/**
 * Impact-aware Kelly stake solver for binary FPMM markets.
 *
 * Mathematical background (documented and tested in kelly.test.ts):
 *
 *   Let W = wallet balance (base units), p = agent probability for chosen side (bps).
 *   Let s(c) = calcBuy(rBought, rOther, c, feeBps).sharesOut.
 *   A winning outcome pays 1 base unit per share (USDC with 7 decimals).
 *
 *   G(c) = p · ln(W - c + s(c)) + (1 - p) · ln(W - c)
 *
 *   G is strictly concave on [0, W) because s is concave and increasing
 *   (calcBuy's monotonicity proof in lib/stellar/quote.ts). Therefore G has
 *   a unique maximizer c*.
 *
 * Integer-exact bisection on the derivative sign:
 *   The first-order condition at c is:
 *     p · s'(c) · (W - c) > (1 - p) · (W - c + s(c))
 *   where s'(c) ≈ (s(c + δ) - s(c)) / δ, δ = max(USDC/100, c/1000).
 *   We test this by bigint cross-multiplication to avoid logarithms:
 *     p · ds · (W - c) vs (BPS - p) · δ · (W - c + s(c))
 *   ~40 iterations for a 40-bit bisection range. Time: O(log(W/δ)).
 *
 * All caps:
 *   suggested = min(floor(full * fractionNum / fractionDen),
 *                   floor(W * maxShareBps / BPS),
 *                   maxBySetsHeadroom)
 */

import { BPS, calcBuy, MAX_SETS, MathError } from "./generated/fpmm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KellyInput {
  /** Wallet USDC balance in base units (7 decimals). */
  walletUsdc: bigint;
  /** Agent's YES probability for the chosen side, in bps [0, 10_000]. */
  pYesBps: bigint;
  /** Whether the trade is on YES or NO. */
  side: "Yes" | "No";
  reserveYes: bigint;
  reserveNo: bigint;
  feeBps: bigint;
  setsMinted: bigint;
  /** Fractional Kelly: num/den. E.g. 1/4 for quarter-Kelly. */
  fractionNum: bigint;
  fractionDen: bigint;
  /** Maximum share of balance in bps. E.g. 1000 = 10%. */
  maxShareBps: bigint;
  /** Minimum edge after trade (bps). Default 0 = any positive EV. */
  minEdgeAfterBps?: bigint;
}

export interface KellyResult {
  /** Full-Kelly optimal collateral before any cap (may exceed balance). */
  fullKellyCollateral: bigint;
  /** Suggested collateral after all caps and edge check. */
  suggestedCollateral: bigint;
  /** Shares out at suggested collateral. */
  sharesOut: bigint;
  /**
   * Expected value of the suggested trade in base units.
   * evRaw = floor(p * sharesOut / BPS) - suggestedCollateral.
   */
  evRaw: bigint;
  /** Edge remaining after price impact, in bps. */
  edgeAfterBps: bigint;
  /** Non-null when no suggestion is available and why. */
  noSuggestionReason: string | null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Safe calcBuy: returns 0n instead of throwing MathError. */
function safeSharesOut(
  rBought: bigint,
  rOther: bigint,
  collateral: bigint,
  feeBps: bigint,
): bigint {
  if (collateral <= 0n) return 0n;
  try {
    return calcBuy(rBought, rOther, collateral, feeBps).sharesOut;
  } catch (err) {
    if (err instanceof MathError) return 0n;
    throw err;
  }
}

/** Safe calcBuy: returns null on MathError (pool capacity exceeded). */
function safeCalcBuy(
  rBought: bigint,
  rOther: bigint,
  collateral: bigint,
  feeBps: bigint,
): { sharesOut: bigint; net: bigint } | null {
  if (collateral <= 0n) return null;
  try {
    const r = calcBuy(rBought, rOther, collateral, feeBps);
    return { sharesOut: r.sharesOut, net: r.net };
  } catch (err) {
    if (err instanceof MathError) return null;
    throw err;
  }
}

/** Maximum collateral before hitting the MAX_SETS minting cap. */
function maxCollateralByHeadroom(setsMinted: bigint, feeBps: bigint): bigint {
  const headroom = MAX_SETS - setsMinted;
  if (headroom <= 0n) return 0n;
  // net = floor(collateral * (BPS - feeBps) / BPS), so collateral = ceil(net * BPS / (BPS - feeBps))
  if (feeBps >= BPS) return 0n;
  return (headroom * BPS + (BPS - feeBps) - 1n) / (BPS - feeBps);
}

/**
 * Derivative sign at c: positive means G is still increasing (c < c*).
 * Uses bigint cross-multiplication to avoid floating point.
 *   positive iff: p · ds · (W - c) > (BPS - p) · δ · (W - c + s)
 */
function derivativePositive(
  rBought: bigint,
  rOther: bigint,
  feeBps: bigint,
  W: bigint,
  c: bigint,
  p: bigint,     // in BPS
  delta: bigint,
): boolean {
  if (c >= W) return false;
  const s = safeSharesOut(rBought, rOther, c, feeBps);
  const sPlusDelta = safeSharesOut(rBought, rOther, c + delta, feeBps);
  const ds = sPlusDelta - s; // s is concave, so ds/dc is non-negative and decreasing
  if (ds <= 0n) return false;

  const Wc = W - c;
  const lhs = p * ds * Wc;
  const rhs = (BPS - p) * delta * (Wc + s);
  return lhs > rhs;
}

// ─── Main solver ──────────────────────────────────────────────────────────────

/**
 * Solves the impact-aware Kelly stake with ~40 bigint calcBuy calls.
 */
export function solveKelly(input: KellyInput): KellyResult {
  const {
    walletUsdc: W,
    pYesBps,
    side,
    reserveYes,
    reserveNo,
    feeBps,
    setsMinted,
    fractionNum,
    fractionDen,
    maxShareBps,
    minEdgeAfterBps = 0n,
  } = input;

  const noSugg = (reason: string): KellyResult => ({
    fullKellyCollateral: 0n,
    suggestedCollateral: 0n,
    sharesOut: 0n,
    evRaw: 0n,
    edgeAfterBps: 0n,
    noSuggestionReason: reason,
  });

  if (W <= 0n) return noSugg("Wallet balance is zero.");
  if (feeBps < 0n || feeBps >= BPS) return noSugg("Invalid fee.");
  if (pYesBps < 0n || pYesBps > BPS) return noSugg("Invalid probability.");

  // Translate side: NO means we invert the probability and swap reserves
  const [rBought, rOther] =
    side === "Yes" ? [reserveYes, reserveNo] : [reserveNo, reserveYes];
  const p = side === "Yes" ? pYesBps : BPS - pYesBps; // agent prob for the chosen side

  if (rBought <= 0n || rOther <= 0n) return noSugg("Pool reserves are empty.");

  // Current spot price of chosen side (before trade)
  const spotBps = (rOther * BPS) / (rBought + rOther);
  if (p <= spotBps) {
    return noSugg("No positive-EV size at the current price.");
  }

  const maxByHeadroom = maxCollateralByHeadroom(setsMinted, feeBps);
  const high = W - 1n < maxByHeadroom ? W - 1n : maxByHeadroom;
  if (high <= 0n) return noSugg("No collateral headroom in the pool.");

  // Bisect on derivative sign to find c*
  // delta = max(1_000_000n ≈ 0.1 USDC, c/1000)
  let low = 0n;
  let hiBound = high;

  // Check if even c=1 has a positive derivative
  const delta1 = 1_000_000n > 1n ? 1_000_000n : 1n;
  if (!derivativePositive(rBought, rOther, feeBps, W, 0n, p, delta1)) {
    return noSugg("No positive-EV size at the current price.");
  }

  for (let iter = 0; iter < 50 && hiBound - low > 1n; iter++) {
    const mid = (low + hiBound) / 2n;
    const delta = mid / 1000n > 1_000_000n ? mid / 1000n : 1_000_000n;
    if (derivativePositive(rBought, rOther, feeBps, W, mid, p, delta)) {
      low = mid;
    } else {
      hiBound = mid;
    }
  }

  const fullKellyCollateral = low;

  // Apply caps
  const capFraction = (fullKellyCollateral * fractionNum) / fractionDen;
  const capBalance = (W * maxShareBps) / BPS;
  let suggested = capFraction < capBalance ? capFraction : capBalance;
  if (suggested > maxByHeadroom) suggested = maxByHeadroom;
  if (suggested <= 0n) return noSugg("Suggested size rounds down to zero.");

  // Compute quote at suggested size
  const quote = safeCalcBuy(rBought, rOther, suggested, feeBps);
  if (!quote) return noSugg("Pool capacity exceeded at suggested size.");

  const sharesOut = quote.sharesOut;
  if (sharesOut <= 0n) return noSugg("No shares at suggested size.");

  // Edge after trade: agent prob - average price paid (avg price = collateral/shares in bps)
  const avgPriceBps = (suggested * BPS + sharesOut - 1n) / sharesOut; // ceil
  const edgeAfterBps = p - avgPriceBps;

  if (edgeAfterBps <= minEdgeAfterBps) {
    return noSugg("No positive-EV size at the current price.");
  }

  // EV: p * sharesOut / BPS - suggestedCollateral
  const evRaw = (p * sharesOut) / BPS - suggested;

  return {
    fullKellyCollateral,
    suggestedCollateral: suggested,
    sharesOut,
    evRaw,
    edgeAfterBps,
    noSuggestionReason: null,
  };
}
