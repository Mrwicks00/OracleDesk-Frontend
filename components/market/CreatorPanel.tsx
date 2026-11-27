"use client";

import { useState } from "react";
import { useWalletAddress, useWalletNetwork } from "@/lib/contexts/WalletContext";
import { useClaimLpFees, useClaimPoolRemainder, useTransferLp, type OnChainMarketView } from "@/lib/hooks/useStellar";
import { isWalletCreator, lpView, validateLpRecipient, type LpSeed } from "@/lib/stellar/lp";
import { marketCoreSupports } from "@/lib/stellar/capabilities";
import { formatUsdc, bpsToPercent } from "@/lib/stellar/units";
import { explorerAccount, explorerTx } from "@/lib/stellar/config";
import { UserFacingError } from "@/lib/stellar/errors";

export function CreatorPanel({ view, seed }: { view: OnChainMarketView; seed?: LpSeed }) {
  const { address } = useWalletAddress();
  const { isWrongNetwork, rpcNetwork } = useWalletNetwork();
  const claim = useClaimPoolRemainder();
  const claimFees = useClaimLpFees();
  const transfer = useTransferLp();
  const [newLp, setNewLp] = useState("");
  const [transferProblem, setTransferProblem] = useState<string | null>(null);
  if (!isWalletCreator(view.market, address) || isWrongNetwork || rpcNetwork?.status === "mismatch") return null;
  const lp = lpView(view.market, seed);
  const lpActions = marketCoreSupports("claim_lp_fees") && marketCoreSupports("transfer_lp");
  const claimed = lp.claimed || claim.isSuccess;
  const code = claim.error instanceof UserFacingError ? claim.error.described.code : undefined;
  const error = code === "AlreadyClaimed" ? "This pool has already been claimed." : code === "NotFinal" ? "Available after the market resolves or is voided." : claim.error?.message;
  const onClaim = async () => { try { await claim.mutateAsync({ marketId: view.id }); } catch { /* shown below */ } };
  const onClaimFees = async () => { try { await claimFees.mutateAsync({ marketId: view.id }); } catch { /* shown below */ } };
  const onTransfer = async () => {
    const problem = validateLpRecipient(newLp, address);
    setTransferProblem(problem);
    if (problem) return;
    try { await transfer.mutateAsync({ marketId: view.id, newCreator: newLp }); } catch { /* shown below */ }
  };
  return (
    <section aria-label="Your market liquidity" className="rounded-lg border border-outline-variant bg-surface-container-low p-4 text-sm space-y-3">
      <h2 className="font-bold">Your market liquidity <span className="text-xs font-normal text-on-surface-variant">chain</span></h2>
      {lp.seed && <div>
        <p>Seed: {formatUsdc(lp.seed.amount)} USDC at {bpsToPercent(lp.seed.initialYesBps)} YES</p>
        <p className="text-on-surface-variant">Seed shares added to your position: {formatUsdc(lp.seed.creatorYes)} YES · {formatUsdc(lp.seed.creatorNo)} NO</p>
      </div>}
      <p>Pool now: {formatUsdc(lp.poolYes)} YES · {formatUsdc(lp.poolNo)} NO</p>
      <p>{lp.isFinal ? "Pool settlement value" : "Estimated pool value"}: {formatUsdc(lp.poolValue)} USDC</p>
      {!lp.isFinal && <p className="text-xs text-on-surface-variant">Estimate if the market settled at today&apos;s price; the final value depends on the outcome.</p>}
      <div>
        <p>Protocol fees: {formatUsdc(lp.feesAccrued)} USDC</p>
        <p className="text-xs text-on-surface-variant">The protocol&apos;s share of trading fees, sent to the OracleDesk treasury. It is not part of your pool claim.</p>
      </div>
      {claimed ? <p role="status">Claimed. <a href={explorerAccount(view.market.creator) ?? undefined} target="_blank" rel="noopener noreferrer" className="underline">Account history</a></p> : <>
        {lp.claimable !== null && <p>Claimable now: {formatUsdc(lp.claimable)} USDC</p>}
        {lp.remainderWithFees !== null && lp.lpFees > 0n && <p>Pool remainder with unclaimed LP fees: {formatUsdc(lp.remainderWithFees)} USDC</p>}
        {lp.claimable === 0n && <p className="text-xs text-on-surface-variant">0 USDC: claiming only marks the pool as settled.</p>}
        <button type="button" disabled={!lp.isFinal || claim.isPending} onClick={() => void onClaim()} className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">
          {claim.isPending ? "Claiming…" : "Claim pool remainder"}
        </button>
        {!lp.isFinal && <p className="text-xs text-on-surface-variant">Available after the market resolves or is voided.</p>}
      </>}
      {claim.isPending && <p role="status">{claim.phase.name === "awaiting-signature" ? "Asking your wallet to sign…" : "Waiting for the network…"}</p>}
      {error && <p role="alert" className="text-error">{error}</p>}
      {claim.data && <p role="status">Received {formatUsdc(claim.data.payout)} USDC. <a href={explorerTx(claim.data.txHash) ?? undefined} target="_blank" rel="noopener noreferrer" className="underline">View transaction</a></p>}
      {lpActions && !lp.claimed && <div className="space-y-2 border-t border-outline-variant pt-3">
        <h3 className="font-bold">LP fees</h3>
        <p className="text-xs text-on-surface-variant">You can claim LP fees at any time. Unclaimed LP fees move with the LP role if you transfer it, so claim them first.</p>
        <button type="button" disabled={claimFees.isPending} onClick={() => void onClaimFees()} className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">
          {claimFees.isPending ? "Claiming LP fees…" : "Claim LP fees"}
        </button>
        {claimFees.data && <p role="status">Claimed {formatUsdc(claimFees.data.amount)} USDC in LP fees.</p>}
        {claimFees.error && <p role="alert" className="text-error">{claimFees.error.message}</p>}
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void onTransfer(); }}>
          <label htmlFor={`lp-transfer-${view.id}`} className="block font-bold">Transfer the LP role</label>
          <p className="text-xs text-on-surface-variant">The new LP receives the pool remainder and all unclaimed LP fees, plus all future fees. Your seed shares do not move.</p>
          <input
            id={`lp-transfer-${view.id}`}
            value={newLp}
            onChange={(event) => setNewLp(event.target.value)}
            placeholder="G… account address"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={transferProblem ? true : undefined}
            aria-describedby={transferProblem ? `lp-transfer-error-${view.id}` : undefined}
            className="w-full rounded border border-outline-variant bg-surface px-2 py-1 font-data-mono text-xs"
          />
          <button type="submit" disabled={transfer.isPending} className="rounded border border-primary px-4 py-2 text-primary disabled:opacity-50">
            {transfer.isPending ? "Transferring…" : "Transfer LP role"}
          </button>
          {transferProblem && <p id={`lp-transfer-error-${view.id}`} role="alert" className="text-error">{transferProblem}</p>}
          {transfer.error && <p role="alert" className="text-error">{transfer.error.message}</p>}
          {transfer.isSuccess && <p role="status">LP role transferred to {transfer.data.newCreator}.</p>}
        </form>
      </div>}
      <p className="text-xs text-on-surface-variant">Seed shares are part of your ordinary position. Redeem those separately; this action only claims the pool remainder.</p>
    </section>
  );
}
