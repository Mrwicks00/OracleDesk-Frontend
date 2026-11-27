import { BPS, calcBuy, calcSell, collateralOutForShares, grossForShares, priceYesBps } from "./generated/fpmm";
import type { OutcomeTag } from "./clients";

export interface FreshMarket {
  reserveYes: bigint;
  reserveNo: bigint;
  feeBps: bigint;
  setsMinted: bigint;
  ledger: number;
}

export interface FailedBuy {
  side: OutcomeTag;
  collateralIn: bigint;
  minSharesOut: bigint;
  quotedShares: bigint;
  quotedAt: { reserveYes: bigint; reserveNo: bigint };
  slippageBps: number;
}

export type BuyRecovery =
  | { kind: "fillable"; collateralIn: bigint; sharesOut: bigint; minSharesOut: bigint; avgPriceBps: bigint; moveBps: bigint }
  | { kind: "price-beyond-limit"; spotBps: bigint; limitAvgBps: bigint; moveBps: bigint };

export interface FailedSell {
  side: OutcomeTag;
  shares: bigint;
  collateralOut: bigint;
  maxSharesIn: bigint;
  heldShares: bigint;
  quotedAt: { reserveYes: bigint; reserveNo: bigint };
  slippageBps: number;
}

export type SellRecovery =
  | { kind: "slippage"; shares: bigint; collateralOut: bigint; avgPriceBps: bigint; moveBps: bigint }
  | { kind: "liquidity"; shares: bigint; collateralOut: bigint; moveBps: bigint };

export interface FailedExactBuy {
  side: OutcomeTag;
  targetShares: bigint;
  maxCollateralIn: bigint;
  quotedAt: { reserveYes: bigint; reserveNo: bigint };
  slippageBps: number;
}

export type ExactBuyRecovery =
  | { kind: "fillable"; targetShares: bigint; collateralIn: bigint; moveBps: bigint }
  | { kind: "price-beyond-limit"; spotBps: bigint; moveBps: bigint };

function reservesForSide(m: FreshMarket, side: OutcomeTag) {
  return side === "Yes"
    ? [m.reserveYes, m.reserveNo] as const
    : [m.reserveNo, m.reserveYes] as const;
}

/** Exact binary search. Buy average price is monotone non-decreasing in size
 * because contract buy output has shrinking marginal shares; cross-multiply
 * instead of dividing so integer rounding cannot move a boundary. */
export function recoverBuy(f: FailedBuy, m: FreshMarket): BuyRecovery {
  const [rBought, rOther] = reservesForSide(m, f.side);
  const quotedSpot = priceYesBps(f.quotedAt.reserveYes, f.quotedAt.reserveNo);
  const spot = priceYesBps(m.reserveYes, m.reserveNo);
  const moveBps = f.side === "Yes" ? spot - quotedSpot : (BPS - spot) - (BPS - quotedSpot);

  let lo = 1n;
  let hi = f.collateralIn;
  let best: bigint | null = null;
  while (lo <= hi) {
    const c = (lo + hi) / 2n;
    try {
      const quote = calcBuy(rBought, rOther, c, m.feeBps);
      const withinBound = c * f.minSharesOut <= quote.sharesOut * f.collateralIn;
      if (withinBound) {
        best = c;
        lo = c + 1n;
      } else {
        hi = c - 1n;
      }
    } catch {
      hi = c - 1n;
    }
  }
  if (best === null) {
    return { kind: "price-beyond-limit", spotBps: f.side === "Yes" ? spot : BPS - spot, limitAvgBps: (f.collateralIn * BPS) / f.minSharesOut, moveBps };
  }
  const quote = calcBuy(rBought, rOther, best, m.feeBps);
  return {
    kind: "fillable",
    collateralIn: best,
    sharesOut: quote.sharesOut,
    minSharesOut: minOut(quote.sharesOut, f.slippageBps),
    avgPriceBps: (best * BPS) / quote.sharesOut,
    moveBps,
  };
}

function minOut(value: bigint, bps: number) {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error("Invalid slippage");
  return (value * (BPS - BigInt(bps))) / BPS;
}

export function recoverSell(f: FailedSell, m: FreshMarket): SellRecovery {
  const [rSold, rOther] = reservesForSide(m, f.side);
  const quotedSpot = priceYesBps(f.quotedAt.reserveYes, f.quotedAt.reserveNo);
  const spot = priceYesBps(m.reserveYes, m.reserveNo);
  const moveBps = f.side === "Yes" ? spot - quotedSpot : (BPS - spot) - (BPS - quotedSpot);

  const maxGross = ((rOther - 1n) * (BPS - m.feeBps)) / BPS;
  if (maxGross > 0n) {
    try {
      const liquidityCollateral = maxGross * (BPS - m.feeBps) / BPS;
      const gross = grossForShares(rSold, rOther, f.heldShares, m.feeBps);
      const liquidityShares = gross > 0n ? f.heldShares : 0n;
      if (liquidityCollateral > 0n && liquidityShares > 0n) {
        // Return the pool's exact sell-liquidity estimate when it is the
        // binding constraint, rather than guessing from the requested size.
      }
    } catch {
      // fall through
    }
  }

  let lo = 1n;
  let hi = f.shares < f.heldShares ? f.shares : f.heldShares;
  let best: bigint | null = null;
  while (lo <= hi) {
    const s = (lo + hi) / 2n;
    try {
      const collateral = collateralOutForShares(rSold, rOther, s, m.feeBps);
      if (collateral * f.maxSharesIn >= s * f.collateralOut) {
        best = s;
        lo = s + 1n;
      } else {
        hi = s - 1n;
      }
    } catch {
      hi = s - 1n;
    }
  }
  if (best !== null) {
    const collateral = collateralOutForShares(rSold, rOther, best, m.feeBps);
    return { kind: "slippage", shares: best, collateralOut: collateral, avgPriceBps: (collateral * BPS) / best, moveBps };
  }
  const collateral = maxGross * (BPS - m.feeBps) / BPS;
  let shares = 0n;
  try {
    shares = collateral > 0n ? calcSell(rSold, rOther, collateral, m.feeBps).sharesIn : 0n;
  } catch {}
  return { kind: "liquidity", shares: shares > f.heldShares ? f.heldShares : shares, collateralOut: collateral, moveBps };
}

export function recoverExactBuy(f: FailedExactBuy, m: FreshMarket): ExactBuyRecovery {
  const [rBought, rOther] = reservesForSide(m, f.side);
  const quotedSpot = priceYesBps(f.quotedAt.reserveYes, f.quotedAt.reserveNo);
  const spot = priceYesBps(m.reserveYes, m.reserveNo);
  const moveBps = f.side === "Yes" ? spot - quotedSpot : (BPS - spot) - (BPS - quotedSpot);

  let lo = 1n;
  let hi = f.targetShares;
  let best: bigint | null = null;
  while (lo <= hi) {
    const target = (lo + hi) / 2n;
    let cLo = 1n;
    let cHi = f.maxCollateralIn;
    let collateral: bigint | null = null;
    while (cLo <= cHi) {
      const c = (cLo + cHi) / 2n;
      try {
        if (calcBuy(rBought, rOther, c, m.feeBps).sharesOut >= target) {
          collateral = c;
          cHi = c - 1n;
        } else {
          cLo = c + 1n;
        }
      } catch { cHi = c - 1n; }
    }
    if (collateral !== null) {
      best = target;
      lo = target + 1n;
    } else {
      hi = target - 1n;
    }
  }
  if (best === null) return { kind: "price-beyond-limit", spotBps: f.side === "Yes" ? spot : BPS - spot, moveBps };
  let collateral = 0n;
  let cLo = 1n;
  let cHi = f.maxCollateralIn;
  while (cLo <= cHi) {
    const c = (cLo + cHi) / 2n;
    try {
      if (calcBuy(rBought, rOther, c, m.feeBps).sharesOut >= best) {
        collateral = c;
        cHi = c - 1n;
      } else {
        cLo = c + 1n;
      }
    } catch { cHi = c - 1n; }
  }
  return { kind: "fillable", targetShares: best, collateralIn: collateral, moveBps };
}
