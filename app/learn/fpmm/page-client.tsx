"use client";

import React, { useId, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Slider } from "radix-ui";
import {
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Calculator,
  ShieldCheck,
  TrendingUp,
  Sliders,
  Sparkles,
  Info,
} from "lucide-react";
import { useOnChainMarkets, useOnChainMarket } from "@/lib/hooks/useStellar";
import {
  buyWalkthrough,
  sellWalkthrough,
  type PoolState,
  type BuyWalkthrough,
  type SellWalkthrough,
} from "@/lib/learn/fpmm-walkthrough";
import { useContractCheck } from "@/lib/learn/useContractCheck";
import { depthCurve } from "@/lib/stellar/depth";
import { seedReserves, BPS } from "@/lib/stellar/generated/fpmm";
import { formatUsdc, USDC_UNIT } from "@/lib/stellar/units";
import { formatUsdcDisplay, formatBps } from "@/lib/format/money";
import { LiveRegion } from "@/components/ui/live-region";
import { parseFpmmParams } from "@/lib/routes";

export default function FpmmExplainerClient() {
  const searchParams = useSearchParams();
  const parsed = parseFpmmParams(searchParams);
  const initialMarket = parsed.ok && parsed.market ? parsed.market : "";
  const initialSide = parsed.ok && parsed.side === "No" ? "No" : "Yes";
  const initialAmountRaw = parsed.ok ? parsed.amount : null;
  const initialSlippage = parsed.ok && parsed.slippage !== null ? parsed.slippage : 100; // 1% default

  const [selectedMarketId, setSelectedMarketId] = useState<string>(initialMarket);
  const [sandboxMode, setSandboxMode] = useState<boolean>(!initialMarket);
  const [tradeType, setTradeType] = useState<"buy" | "sell">("buy");
  const [side, setSide] = useState<"Yes" | "No">(initialSide);

  // Default to 10 USDC input if not provided
  const [amountInput, setAmountInput] = useState<string>(
    initialAmountRaw && BigInt(initialAmountRaw) > 0n
      ? (Number(initialAmountRaw) / 10_000_000).toString()
      : "10"
  );
  const [slippageBps, setSlippageBps] = useState<number>(initialSlippage);

  // Sandbox inputs
  const [sandboxYes, setSandboxYes] = useState<string>("1000");
  const [sandboxNo, setSandboxNo] = useState<string>("1000");
  const [sandboxFeeBps, setSandboxFeeBps] = useState<string>("100");

  const [announcement, setAnnouncement] = useState<string>("");

  const marketsQuery = useOnChainMarkets(20);
  const liveMarketQuery = useOnChainMarket(selectedMarketId || null);

  const amountRaw = useMemo(() => {
    try {
      const num = parseFloat(amountInput);
      if (Number.isNaN(num) || num <= 0) return 10n * USDC_UNIT;
      return BigInt(Math.floor(num * 10_000_000));
    } catch {
      return 10n * USDC_UNIT;
    }
  }, [amountInput]);

  const pool: PoolState = useMemo(() => {
    if (sandboxMode || !selectedMarketId || !liveMarketQuery.data) {
      const y = parseFloat(sandboxYes) || 1000;
      const n = parseFloat(sandboxNo) || 1000;
      const f = parseInt(sandboxFeeBps, 10) || 100;
      return {
        reserveYes: BigInt(Math.floor(y * 10_000_000)),
        reserveNo: BigInt(Math.floor(n * 10_000_000)),
        feeBps: BigInt(Math.min(9900, Math.max(0, f))),
      };
    }
    const m = liveMarketQuery.data;
    return {
      reserveYes: m.reserve_yes,
      reserveNo: m.reserve_no,
      feeBps: BigInt(m.fee_bps),
    };
  }, [sandboxMode, selectedMarketId, liveMarketQuery.data, sandboxYes, sandboxNo, sandboxFeeBps]);

  const walkthrough = useMemo<
    { kind: "buy"; data: BuyWalkthrough } | { kind: "sell"; data: SellWalkthrough } | { kind: "error"; message: string }
  >(() => {
    try {
      if (tradeType === "buy") {
        const data = buyWalkthrough(pool, side, amountRaw, BigInt(slippageBps));
        return { kind: "buy", data };
      } else {
        const data = sellWalkthrough(pool, side, { collateralOut: amountRaw }, BigInt(slippageBps));
        return { kind: "sell", data };
      }
    } catch (err) {
      return { kind: "error", message: (err as Error).message || "Calculation failed" };
    }
  }, [pool, tradeType, side, amountRaw, slippageBps]);

  const expectedVal =
    walkthrough.kind === "buy"
      ? walkthrough.data.steps[4].result
      : walkthrough.kind === "sell"
      ? walkthrough.data.sharesIn
      : 0n;

  const contractCheck = useContractCheck({
    marketId: sandboxMode ? null : selectedMarketId,
    side,
    isBuy: tradeType === "buy",
    amount: amountRaw,
    expectedSharesOrCollateral: expectedVal,
  });

  const curve = useMemo(() => {
    try {
      return depthCurve({
        reserve_yes: pool.reserveYes,
        reserve_no: pool.reserveNo,
        fee_bps: Number(pool.feeBps),
        sets_minted: 100_000n * USDC_UNIT,
      });
    } catch {
      return null;
    }
  }, [pool]);

  const curveSummary = useMemo(() => {
    if (walkthrough.kind === "error") return "Trade input invalid";
    const beforePct = (Number(walkthrough.data.marginalBeforeBps) / 100).toFixed(1);
    const afterPct = (Number(walkthrough.data.marginalAfterBps) / 100).toFixed(1);
    const amtStr = (Number(amountRaw) / 10_000_000).toFixed(2);
    return `${tradeType === "buy" ? "Buying" : "Selling"} ${amtStr} USDC moves ${side} price from ${beforePct}% to ${afterPct}%.`;
  }, [walkthrough, tradeType, amountRaw, side]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      <LiveRegion message={announcement} />

      {/* Header */}
      <div className="border-b border-outline-variant pb-6 space-y-2">
        <div className="flex items-center gap-2 text-primary font-mono text-xs uppercase tracking-wider">
          <Calculator className="w-4 h-4" />
          <span>Interactive FPMM Explainer</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Fixed-Product Market Maker Math</h1>
        <p className="text-on-surface-variant text-sm max-w-3xl">
          Every price, fee, and slippage guarantee on OracleDesk derives directly from the pinned constant-product
          invariant $k = r_{Yes} \cdot r_{No}$. Step through any trade in exact bigint precision, cross-checked live
          against contract simulations.
        </p>
      </div>

      {/* Controls & Mode Select */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Source Configuration */}
        <div className="p-5 bg-surface-container-low border border-outline-variant rounded-xl space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Market Source</span>
            <button
              type="button"
              onClick={() => setSandboxMode(!sandboxMode)}
              className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
            >
              <Sliders className="w-3.5 h-3.5" />
              {sandboxMode ? "Use Live Market" : "Switch to Sandbox"}
            </button>
          </div>

          {!sandboxMode ? (
            <div className="space-y-3">
              <label className="block text-xs text-on-surface-variant font-medium">Select On-Chain Market</label>
              <select
                value={selectedMarketId}
                onChange={(e) => setSelectedMarketId(e.target.value)}
                className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Choose a recent market…</option>
                {marketsQuery.data?.map((m) => (
                  <option key={m.id} value={m.id}>
                    #{m.id} · {m.question.slice(0, 42)}…
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-on-surface-variant uppercase font-bold">YES Reserve</label>
                  <input
                    type="number"
                    value={sandboxYes}
                    onChange={(e) => setSandboxYes(e.target.value)}
                    className="w-full bg-surface border border-outline-variant rounded-md px-2 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-on-surface-variant uppercase font-bold">NO Reserve</label>
                  <input
                    type="number"
                    value={sandboxNo}
                    onChange={(e) => setSandboxNo(e.target.value)}
                    className="w-full bg-surface border border-outline-variant rounded-md px-2 py-1.5 text-xs font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-on-surface-variant uppercase font-bold">Fee (bps)</label>
                <input
                  type="number"
                  value={sandboxFeeBps}
                  onChange={(e) => setSandboxFeeBps(e.target.value)}
                  className="w-full bg-surface border border-outline-variant rounded-md px-2 py-1.5 text-xs font-mono"
                />
              </div>
            </div>
          )}
        </div>

        {/* Trade Inputs */}
        <div className="lg:col-span-2 p-5 bg-surface-container-low border border-outline-variant rounded-xl space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Trade Parameters</span>
            <div className="flex rounded-lg border border-outline-variant overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setTradeType("buy")}
                className={`px-3 py-1 font-semibold ${tradeType === "buy" ? "bg-primary text-primary-foreground" : "bg-surface"}`}
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => setTradeType("sell")}
                className={`px-3 py-1 font-semibold ${tradeType === "sell" ? "bg-primary text-primary-foreground" : "bg-surface"}`}
              >
                Sell
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-on-surface-variant font-medium mb-1">Target Side</label>
              <div className="grid grid-cols-2 gap-1 bg-surface p-1 rounded-lg border border-outline-variant">
                <button
                  type="button"
                  onClick={() => setSide("Yes")}
                  className={`py-1 text-xs font-bold rounded ${side === "Yes" ? "bg-emerald-600 text-white" : "text-on-surface"}`}
                >
                  YES
                </button>
                <button
                  type="button"
                  onClick={() => setSide("No")}
                  className={`py-1 text-xs font-bold rounded ${side === "No" ? "bg-rose-600 text-white" : "text-on-surface"}`}
                >
                  NO
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-on-surface-variant font-medium mb-1">Amount (USDC)</label>
              <input
                type="number"
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  setAnnouncement(`Updated trade amount to ${e.target.value} USDC`);
                }}
                className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-xs text-on-surface-variant font-medium mb-1">
                Slippage Limit: {(slippageBps / 100).toFixed(1)}%
              </label>
              <Slider.Root
                value={[slippageBps]}
                min={10}
                max={500}
                step={10}
                aria-label="Slippage tolerance"
                aria-valuetext={`${(slippageBps / 100).toFixed(1)} percent`}
                onValueChange={([val]) => setSlippageBps(val)}
                className="relative flex items-center select-none touch-none w-full h-7"
              >
                <Slider.Track className="bg-surface relative grow rounded-full h-2 border border-outline-variant">
                  <Slider.Range className="absolute bg-primary rounded-full h-full" />
                </Slider.Track>
                <Slider.Thumb
                  aria-label="Slippage slider"
                  className="block w-4 h-4 bg-primary border-2 border-white rounded-full shadow hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </Slider.Root>
            </div>
          </div>
        </div>
      </div>

      {/* Contract Simulation Cross-Check Banner */}
      {!sandboxMode && selectedMarketId && (
        <div
          role="status"
          className={`px-4 py-3 rounded-xl border flex items-center justify-between text-xs font-mono ${
            contractCheck.status === "matches"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
              : contractCheck.status === "differs"
              ? "bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-300"
              : "bg-surface-container-low border-outline-variant text-on-surface-variant"
          }`}
        >
          <div className="flex items-center gap-2">
            {contractCheck.status === "matches" && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
            {contractCheck.status === "differs" && <AlertTriangle className="w-4 h-4 text-rose-500" />}
            {contractCheck.status === "checking" && <span className="w-3 h-3 rounded-full bg-primary animate-ping" />}
            <span>
              On-Chain Cross-Check: <strong>{contractCheck.status.toUpperCase()}</strong> ·{" "}
              {contractCheck.message ?? "Verifying against contract simulator…"}
            </span>
          </div>
          {contractCheck.simulatedValue !== undefined && (
            <span>Simulated Output: {formatUsdcDisplay(contractCheck.simulatedValue)}</span>
          )}
        </div>
      )}

      {/* Walkthrough Content */}
      {walkthrough.kind === "error" ? (
        <div className="p-6 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-700 text-sm">
          <strong>Cannot execute walkthrough:</strong> {walkthrough.message}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Step 1: Pre-Trade State */}
          <div className="p-5 bg-surface-container-low border border-outline-variant rounded-xl space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-2">
              <span>1. Pool Reserves Before Trade</span>
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
              <div className="p-3 bg-surface rounded-lg border border-outline-variant">
                <span className="text-on-surface-variant block text-[10px] uppercase">YES Reserve</span>
                <span className="text-base font-bold text-on-surface">{formatUsdc(pool.reserveYes, { maxDecimals: 2 })}</span>
              </div>
              <div className="p-3 bg-surface rounded-lg border border-outline-variant">
                <span className="text-on-surface-variant block text-[10px] uppercase">NO Reserve</span>
                <span className="text-base font-bold text-on-surface">{formatUsdc(pool.reserveNo, { maxDecimals: 2 })}</span>
              </div>
              <div className="p-3 bg-surface rounded-lg border border-outline-variant">
                <span className="text-on-surface-variant block text-[10px] uppercase">Marginal Spot Price</span>
                <span className="text-base font-bold text-primary">{formatBps(walkthrough.data.marginalBeforeBps)}</span>
              </div>
              <div className="p-3 bg-surface rounded-lg border border-outline-variant">
                <span className="text-on-surface-variant block text-[10px] uppercase">Invariant Product (k)</span>
                <span className="text-xs font-bold text-on-surface truncate block" title={walkthrough.data.before.k.toString()}>
                  {walkthrough.data.before.k.toString()}
                </span>
              </div>
            </div>
          </div>

          {/* Step 2: Numbered Execution Steps */}
          <div className="p-5 bg-surface-container-low border border-outline-variant rounded-xl space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">
              2. Step-by-Step Contract Math
            </h2>
            <div className="space-y-3">
              {walkthrough.data.steps.map((st, i) => (
                <div key={i} className="p-4 bg-surface rounded-lg border border-outline-variant space-y-1.5 font-mono text-xs">
                  <div className="flex items-center justify-between text-on-surface">
                    <span className="font-bold flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[11px]">
                        {i + 1}
                      </span>
                      {st.label}
                    </span>
                    <span className="text-primary font-bold text-sm">{formatUsdcDisplay(st.result)}</span>
                  </div>
                  <div className="text-[11px] text-on-surface-variant flex items-center gap-2">
                    <span className="bg-surface-container px-2 py-0.5 rounded font-mono">{st.formula}</span>
                    {st.rounding && (
                      <span className="text-amber-600 dark:text-amber-400 font-bold uppercase text-[10px]">
                        ({st.rounding} rounded)
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Step 3: Post-Trade State & Impact */}
          <div className="p-5 bg-surface-container-low border border-outline-variant rounded-xl space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">
              3. Outcome & Price Impact
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
              <div className="p-3 bg-surface rounded-lg border border-outline-variant">
                <span className="text-on-surface-variant block text-[10px] uppercase">New Marginal Price</span>
                <span className="text-base font-bold text-on-surface">{formatBps(walkthrough.data.marginalAfterBps)}</span>
              </div>
              <div className="p-3 bg-surface rounded-lg border border-outline-variant">
                <span className="text-on-surface-variant block text-[10px] uppercase">Effective Average Price</span>
                <span className="text-base font-bold text-on-surface">{formatBps(walkthrough.data.avgPriceBps)}</span>
              </div>
              <div className="p-3 bg-surface rounded-lg border border-outline-variant">
                <span className="text-on-surface-variant block text-[10px] uppercase">Price Impact</span>
                <span className="text-base font-bold text-amber-600">{formatBps(walkthrough.data.impactBps)}</span>
              </div>
              <div className="p-3 bg-surface rounded-lg border border-outline-variant">
                <span className="text-on-surface-variant block text-[10px] uppercase">Post-Trade k</span>
                <span className="text-xs font-bold text-on-surface truncate block" title={walkthrough.data.after.k.toString()}>
                  {walkthrough.data.after.k.toString()}
                </span>
              </div>
            </div>
          </div>

          {/* Step 4: Slippage Protection & Settlement */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-5 bg-surface-container-low border border-outline-variant rounded-xl space-y-3 font-mono text-xs">
              <h3 className="font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <span>On-Chain Slippage Guarantee</span>
              </h3>
              <p className="text-on-surface-variant font-sans text-xs">
                The transaction submits with an exact lower bound. If concurrent trades move the pool such that you
                receive fewer than this minimum, the invocation throws error 12 (<code>SlippageExceeded</code>) and reverts.
              </p>
              <div className="p-3 bg-surface rounded-lg border border-outline-variant">
                <span className="text-on-surface-variant block text-[10px] uppercase">Guaranteed Output Minimum</span>
                <span className="text-lg font-bold text-primary">
                  {walkthrough.kind === "buy"
                    ? `${formatUsdc(walkthrough.data.minSharesOut, { maxDecimals: 2 })} shares`
                    : `${formatUsdc(walkthrough.data.minCollateralOut ?? 0n, { maxDecimals: 2 })} USDC`}
                </span>
              </div>
            </div>

            <div className="p-5 bg-surface-container-low border border-outline-variant rounded-xl space-y-3 font-mono text-xs">
              <h3 className="font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                <span>Value at Market Resolution</span>
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2.5 bg-surface rounded border border-outline-variant text-center">
                  <span className="text-[10px] uppercase text-emerald-600 font-bold block">If YES Wins</span>
                  <span className="font-bold text-sm">{formatUsdcDisplay(walkthrough.data.settlement.yes)}</span>
                </div>
                <div className="p-2.5 bg-surface rounded border border-outline-variant text-center">
                  <span className="text-[10px] uppercase text-rose-600 font-bold block">If NO Wins</span>
                  <span className="font-bold text-sm">{formatUsdcDisplay(walkthrough.data.settlement.no)}</span>
                </div>
                <div className="p-2.5 bg-surface rounded border border-outline-variant text-center">
                  <span className="text-[10px] uppercase text-amber-600 font-bold block">If Voided</span>
                  <span className="font-bold text-sm">{formatUsdcDisplay(walkthrough.data.settlement.void)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Step 5: Curve & Accessible Table */}
          <div className="p-5 bg-surface-container-low border border-outline-variant rounded-xl space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">
              Depth Curve & Price Trajectory
            </h3>
            <p className="text-xs text-on-surface-variant" aria-describedby="depth-table">
              {curveSummary}
            </p>

            {curve && (
              <div className="overflow-x-auto">
                <table id="depth-table" className="w-full text-xs font-mono border-collapse text-start">
                  <thead>
                    <tr className="border-b border-outline-variant bg-surface text-on-surface-variant">
                      <th className="py-2 px-3 text-start">PROBABILITY</th>
                      <th className="py-2 px-3 text-start">SIDE</th>
                      <th className="py-2 px-3 text-end">CUMULATIVE COLLATERAL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {curve.levels.slice(0, 10).map((lvl, idx) => (
                      <tr key={idx} className="hover:bg-surface/50">
                        <td className="py-1.5 px-3 font-bold">{formatBps(lvl.bps)}</td>
                        <td className="py-1.5 px-3">{lvl.side}</td>
                        <td className="py-1.5 px-3 text-end">{formatUsdcDisplay(lvl.cumulative)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
