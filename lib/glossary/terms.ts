/**
 * Canonical Glossary Data for Prediction-Market, Stellar, and OracleDesk Protocol terms.
 * Complies with WCAG 2.2 AAA (3.1.3 Unusual Words, 3.1.4 Abbreviations).
 */

export type TermCategory = "market" | "stellar" | "protocol";

export type TermId =
  | "slippage"
  | "limit-price"
  | "order-book"
  | "amm"
  | "liquidity-pool"
  | "share"
  | "payout"
  | "settlement"
  | "resolution"
  | "void"
  | "oracle"
  | "dispute-window"
  | "claimable-balance"
  | "trustline"
  | "base-reserve"
  | "xlm"
  | "usdc"
  | "sac"
  | "stroop"
  | "sequence-number"
  | "time-bounds"
  | "source-account"
  | "soroban-entry-ttl"
  | "restore-footprint"
  | "reasoning-agent"
  | "trace-hash"
  | "trace-cid"
  | "attestation"
  | "calibration-score"
  | "copy-trade"
  | "watch-only";

export interface GlossaryTerm {
  id: TermId;
  term: string;
  aliases?: string[];
  /** Plain text plain-language definition of 140 characters or fewer. */
  short: string;
  /** Comprehensive markdown explanation. */
  long: string;
  category: TermCategory;
  seeAlso?: TermId[];
  /** Valid repository path or technical spec link. */
  source?: string;
}

export const GLOSSARY_TERMS: Record<TermId, GlossaryTerm> = {
  slippage: {
    id: "slippage",
    term: "Slippage",
    aliases: ["price slippage", "slippage tolerance"],
    short: "The difference between expected quote price and actual execution price due to pool movements.",
    long: "When trading in automated market maker (AMM) pools, trades shift token balances and alter prices. Slippage is the difference between the quoted price and the execution price. Traders set a maximum slippage tolerance (e.g. 1% or 100 bps) to protect against adverse price movements.",
    category: "market",
    seeAlso: ["limit-price", "amm"],
    source: "lib/stellar/trade-v2.ts",
  },
  "limit-price": {
    id: "limit-price",
    term: "Limit Price",
    aliases: ["min_shares_out", "price bound"],
    short: "The worst acceptable price or minimum share quantity agreed upon before executing a trade.",
    long: "A limit price defines a contractual boundary on trade execution: buying guarantees a minimum quantity of shares received (`min_shares_out`), while selling enforces a maximum quantity of shares given up (`max_shares_in`). Transactions fail on-chain if this limit cannot be satisfied.",
    category: "market",
    seeAlso: ["slippage", "amm"],
    source: "lib/stellar/trade-v2.ts",
  },
  "order-book": {
    id: "order-book",
    term: "Order Book",
    aliases: ["CLOB", "bids and asks"],
    short: "A ledger of active buy and sell orders sorted by price, distinct from automated liquidity pools.",
    long: "Unlike automated market maker pools where trades execute against algorithmic mathematical formulas, an order book matches discrete buy bids and sell asks submitted by market participants. OracleDesk utilizes on-chain FPMM pools with off-chain order verification.",
    category: "market",
    seeAlso: ["amm", "liquidity-pool"],
    source: "docs/architecture.md",
  },
  amm: {
    id: "amm",
    term: "Automated Market Maker (AMM)",
    aliases: ["FPMM", "constant product pool"],
    short: "A smart contract pool providing continuous automated trading quotes based on mathematical formulas.",
    long: "An Automated Market Maker prices outcomes algorithmically according to relative reserve ratios rather than matching buyers with individual sellers. OracleDesk employs a Fixed Product Market Maker (FPMM) model adapted for binary prediction market contracts on Soroban.",
    category: "market",
    seeAlso: ["liquidity-pool", "share"],
    source: "lib/stellar/generated/fpmm.ts",
  },
  "liquidity-pool": {
    id: "liquidity-pool",
    term: "Liquidity Pool",
    aliases: ["pool reserves", "reserve pool"],
    short: "Collateral and outcome tokens deposited in a contract to facilitate instant trading.",
    long: "Liquidity pools hold the underlying reserves (such as USDC collateral alongside YES and NO outcome tokens). Market creators and liquidity providers deposit initial capital, enabling traders to buy and sell instantly without counterparty delays.",
    category: "market",
    seeAlso: ["amm", "share"],
    source: "lib/stellar/generated/market-core.ts",
  },
  share: {
    id: "share",
    term: "Outcome Share",
    aliases: ["position share", "contracts"],
    short: "A digital token representing a claim to 1 USDC if its designated outcome resolves as correct.",
    long: "Prediction market contracts issue binary outcome shares (YES or NO). Each winning share entitles the owner to redeem 1 USDC upon successful market resolution, while losing shares settle with zero redeemable payout.",
    category: "market",
    seeAlso: ["payout", "settlement"],
    source: "lib/stellar/generated/market-core.ts",
  },
  payout: {
    id: "payout",
    term: "Payout",
    aliases: ["redemption payout", "winnings"],
    short: "The collateral amount redeemed by holders holding shares of the winning outcome.",
    long: "Upon resolution, winning outcome shares can be redeemed for collateral at a 1:1 ratio (1 full share = 1.00 USDC). Payouts are claimed on-chain directly from the market-core smart contract via `redeem` or `redeem_many`.",
    category: "market",
    seeAlso: ["share", "settlement"],
    source: "lib/stellar/redeem-all.ts",
  },
  settlement: {
    id: "settlement",
    term: "Settlement",
    aliases: ["market settlement", "final outcome"],
    short: "The conclusive final state of a market determining which outcome shares redeem collateral.",
    long: "Settlement marks the end of market trading. The contract records the official resolution (YES, NO, or VOID) delivered by verified resolvers or oracles, locking reserve ratios and enabling payouts.",
    category: "market",
    seeAlso: ["resolution", "void", "payout"],
    source: "lib/stellar/generated/market-core.ts",
  },
  resolution: {
    id: "resolution",
    term: "Resolution",
    aliases: ["market resolution", "resolve"],
    short: "The on-chain determination of the real-world answer to a prediction question.",
    long: "Resolution occurs when authorized resolvers or cryptographic reasoning agents inspect real-world evidence and record the definitive outcome on-chain. Resolution triggers the settlement phase and opens the redemption horizon.",
    category: "market",
    seeAlso: ["settlement", "oracle", "dispute-window"],
    source: "lib/stellar/generated/resolver.ts",
  },
  void: {
    id: "void",
    term: "Void",
    aliases: ["cancelled market", "invalidated"],
    short: "A cancelled market state where all traders can reclaim their original invested collateral.",
    long: "When a market's underlying question is ambiguous, unanswerable, or disrupted by external events, it resolves as VOID. In a voided market, outcome shares are redeemed proportionally to return original collateral rather than paying 1.00 USDC to one side.",
    category: "market",
    seeAlso: ["settlement", "resolution"],
    source: "lib/stellar/generated/market-core.ts",
  },
  oracle: {
    id: "oracle",
    term: "Oracle",
    aliases: ["data feed", "price feed"],
    short: "A data service providing external real-world facts and event outcomes to smart contracts.",
    long: "Blockchains cannot natively fetch off-chain internet information. Oracles serve as secure bridges, verifying off-chain results (e.g. election outcomes or asset prices) and submitting cryptographic attestations on-chain.",
    category: "market",
    seeAlso: ["resolution", "attestation", "reasoning-agent"],
    source: "docs/architecture.md",
  },
  "dispute-window": {
    id: "dispute-window",
    term: "Dispute Window",
    aliases: ["challenge period", "settlement horizon"],
    short: "A time buffer after a preliminary resolution allowing participants to challenge incorrect results.",
    long: "To prevent fraudulent or inaccurate resolutions, a dispute window enforces a waiting period before outcomes become irreversible. If no valid challenge is raised within the horizon, the market finalizes.",
    category: "market",
    seeAlso: ["resolution", "settlement"],
    source: "docs/architecture.md",
  },
  "claimable-balance": {
    id: "claimable-balance",
    term: "Claimable Balance",
    aliases: ["escrow balance", "contingent transfer"],
    short: "A Stellar ledger entry holding assets that can only be claimed by designated recipients under set rules.",
    long: "Stellar Claimable Balances lock funds on-chain until specific conditions (such as time predicates or claimant addresses) are met. They provide trust-minimized escrow and safe asset delivery without requiring existing trustlines.",
    category: "stellar",
    seeAlso: ["trustline", "base-reserve"],
    source: "lib/stellar/fees.ts",
  },
  trustline: {
    id: "trustline",
    term: "Trustline",
    aliases: ["asset trustline", "token authorization"],
    short: "An explicit Stellar ledger entry allowing an account to hold and transact a specific asset.",
    long: "Unlike native XLM, holding custom tokens (such as USDC) on Stellar requires creating a trustline. Establishing a trustline reserves 0.5 XLM from your balance as part of Stellar's minimum reserve policy.",
    category: "stellar",
    seeAlso: ["base-reserve", "usdc", "sac"],
    source: "lib/stellar/trustline.ts",
  },
  "base-reserve": {
    id: "base-reserve",
    term: "Base Reserve",
    aliases: ["minimum balance", "reserve requirement"],
    short: "The minimum XLM an account must hold for each ledger entry (currently 0.5 XLM per entry).",
    long: "Stellar prevents ledger spam by requiring accounts to reserve a small amount of XLM for their account entry, trustlines, signers, and contract data entries. The base reserve is currently 0.5 XLM (5,000,000 stroops).",
    category: "stellar",
    seeAlso: ["trustline", "xlm", "stroop"],
    source: "lib/stellar/fees.ts",
  },
  xlm: {
    id: "xlm",
    term: "Lumens (XLM)",
    aliases: ["native asset", "gas token"],
    short: "The native cryptocurrency of the Stellar network used to pay transaction fees and reserve storage.",
    long: "XLM is the native asset on Stellar. It is used to pay network transaction fees (fractions of a cent) and lock base reserves for accounts, trustlines, and smart contract storage footprints.",
    category: "stellar",
    seeAlso: ["base-reserve", "stroop"],
    source: "lib/stellar/config.ts",
  },
  usdc: {
    id: "usdc",
    term: "USD Coin (USDC)",
    aliases: ["collateral", "stablecoin"],
    short: "A regulated fiat-backed stablecoin pegged 1:1 to the US Dollar, used as trading collateral.",
    long: "USDC issued on Stellar is the standard settlement collateral for OracleDesk prediction markets. All trades, liquidity deposits, and market winnings are denominated and paid in USDC.",
    category: "stellar",
    seeAlso: ["trustline", "sac"],
    source: "lib/stellar/config.ts",
  },
  sac: {
    id: "sac",
    term: "Stellar Asset Contract (SAC)",
    aliases: ["token wrapper", "SEP-41"],
    short: "A built-in Soroban smart contract interface allowing classic Stellar assets to be used in contracts.",
    long: "The Stellar Asset Contract bridges classic Stellar tokens (like USDC) into Soroban smart contracts, implementing the SEP-41 standard so contracts can hold, transfer, and escrow tokens with instant compatibility.",
    category: "stellar",
    seeAlso: ["usdc", "trustline"],
    source: "lib/stellar/clients.ts",
  },
  stroop: {
    id: "stroop",
    term: "Stroop",
    aliases: ["micro-lumen", "fractional XLM"],
    short: "The smallest indivisible fraction of a Lumen: 1 XLM equals 10,000,000 stroops (0.0000001 XLM).",
    long: "Similar to a satoshi on Bitcoin, a stroop is one ten-millionth (10^-7) of an XLM. Stellar on-chain transaction fees and base reserves are calculated and paid internally in stroops.",
    category: "stellar",
    seeAlso: ["xlm", "base-reserve"],
    source: "lib/stellar/fees.ts",
  },
  "sequence-number": {
    id: "sequence-number",
    term: "Sequence Number",
    aliases: ["account nonce", "tx sequence"],
    short: "A monotonically increasing counter on every Stellar account preventing transaction replay attacks.",
    long: "Every Stellar transaction specifies the source account's sequence number incremented by one. Once consumed on-chain, identical transactions cannot be re-executed, ensuring strictly ordered and non-replayable execution.",
    category: "stellar",
    seeAlso: ["source-account", "time-bounds"],
    source: "lib/stellar/tx-decode.ts",
  },
  "time-bounds": {
    id: "time-bounds",
    term: "Time Bounds",
    aliases: ["valid until", "valid from", "transaction deadline"],
    short: "A unix timestamp window outside which a transaction is invalid and cannot be processed.",
    long: "Time bounds specify the minimum and maximum ledger times during which a transaction can be included in a ledger block. If network congestion or delay exceeds `maxTime`, the transaction expires safely without executing.",
    category: "stellar",
    seeAlso: ["sequence-number"],
    source: "lib/stellar/deadline.ts",
  },
  "source-account": {
    id: "source-account",
    term: "Source Account",
    aliases: ["tx signer", "fee payer"],
    short: "The Stellar account paying transaction fees and supplying the sequence number for execution.",
    long: "The source account signs a transaction to authorize fee payment and consume its sequence number. In contract invocations, the source account may also sign authorization entries for contract state modifications.",
    category: "stellar",
    seeAlso: ["sequence-number"],
    source: "lib/stellar/tx-decode.ts",
  },
  "soroban-entry-ttl": {
    id: "soroban-entry-ttl",
    term: "Soroban Entry TTL",
    aliases: ["time-to-live", "rent", "storage lifetime"],
    short: "The ledger lifespan of a contract data entry before it archives and requires restoration.",
    long: "Soroban state entries require rent based on size and retention duration. Each entry maintains a time-to-live (TTL) measured in ledger sequences. Proactively extending TTL prevents entries from archiving.",
    category: "stellar",
    seeAlso: ["restore-footprint", "base-reserve"],
    source: "lib/stellar/ttl.ts",
  },
  "restore-footprint": {
    id: "restore-footprint",
    term: "Restore Footprint",
    aliases: ["entry restoration", "unarchive"],
    short: "An on-chain operation restoring an archived Soroban entry back into active ledger storage.",
    long: "When a Soroban entry's TTL lapses, it becomes archived and inaccessible. A `RestoreFootprint` operation restores the entry to active state by paying the required restoration fee, allowing contracts to read and write it again.",
    category: "stellar",
    seeAlso: ["soroban-entry-ttl"],
    source: "lib/stellar/ttl.ts",
  },
  "reasoning-agent": {
    id: "reasoning-agent",
    term: "Reasoning Agent",
    aliases: ["oracle agent", "AI verifier"],
    short: "An automated autonomous model that analyses market evidence and publishes verifiable reasoning traces.",
    long: "Reasoning agents evaluate real-world evidence, compute probabilistic forecasts, and submit cryptographically verified reasoning traces on-chain to inform traders and resolve prediction markets transparently.",
    category: "protocol",
    seeAlso: ["trace-hash", "trace-cid", "attestation"],
    source: "docs/architecture.md",
  },
  "trace-hash": {
    id: "trace-hash",
    term: "Trace Hash",
    aliases: ["reasoning hash", "sha256 digest"],
    short: "A cryptographic 32-byte SHA-256 digest anchoring an agent's reasoning content to the chain.",
    long: "The trace hash is committed directly to the reasoning registry smart contract. When retrieving the agent's full explanation from decentralized storage, the client recalculates the SHA-256 hash to guarantee untampered provenance.",
    category: "protocol",
    seeAlso: ["trace-cid", "reasoning-agent"],
    source: "lib/stellar/trace.ts",
  },
  "trace-cid": {
    id: "trace-cid",
    term: "Trace CID",
    aliases: ["IPFS CID", "content identifier"],
    short: "An IPFS Content Identifier locating the full text and rationale of an agent's verification trace.",
    long: "Full agent reasoning explanations and references are stored off-chain on IPFS to minimize blockchain state bloat. The CID provides a content-addressed URI that clients use to download and verify the trace.",
    category: "protocol",
    seeAlso: ["trace-hash", "reasoning-agent"],
    source: "lib/stellar/trace.ts",
  },
  attestation: {
    id: "attestation",
    term: "Attestation",
    aliases: ["cryptographic statement", "agent verdict"],
    short: "A signed on-chain statement affirming an event's resolution verdict with cryptographic evidence.",
    long: "Attestations represent formal statements made by authorized reasoning agents or resolvers. They link the agent's public key, the market identifier, the decided outcome, and the supporting reasoning trace.",
    category: "protocol",
    seeAlso: ["reasoning-agent", "calibration-score"],
    source: "lib/stellar/generated/reasoning-registry.ts",
  },
  "calibration-score": {
    id: "calibration-score",
    term: "Calibration Score",
    aliases: ["Brier score", "accuracy rating"],
    short: "A statistical metric measuring how accurately an agent's probabilistic predictions match reality.",
    long: "Calibration evaluates probability truthfulness: an agent assigning an 80% likelihood to outcomes should see those events occur roughly 80% of the time. Lower Brier scores and higher calibration indicate superior reliability.",
    category: "protocol",
    seeAlso: ["reasoning-agent"],
    source: "docs/architecture.md",
  },
  "copy-trade": {
    id: "copy-trade",
    term: "Copy Trade",
    aliases: ["social trading", "agent mirror"],
    short: "A feature automatically mirroring trading allocations and decisions from top-performing agents.",
    long: "Copy trading allows users to allocate capital following verified reasoning agents. When the agent initiates positions within defined risk limits, the client prepares matching transactions for the user's wallet.",
    category: "protocol",
    seeAlso: ["reasoning-agent", "watch-only"],
    source: "components/copy-trade/PendingCopyTrades.tsx",
  },
  "watch-only": {
    id: "watch-only",
    term: "Watch-Only Mode",
    aliases: ["inspect address", "read-only view"],
    short: "A security mode allowing users to inspect any public Stellar portfolio without signing capabilities.",
    long: "Watch-only mode allows users to view positions, balances, and history of any public Stellar address without exposing private keys. All write actions (buying, selling, withdrawing) are strictly disabled while watching.",
    category: "protocol",
    seeAlso: ["copy-trade"],
    source: "lib/hooks/useViewedAddress.tsx",
  },
};

/** List of all glossary terms sorted alphabetically. */
export const ALL_GLOSSARY_TERMS: GlossaryTerm[] = Object.values(GLOSSARY_TERMS).sort((a, b) =>
  a.term.localeCompare(b.term),
);

/** Retrieves a term by its TermId or returns undefined. */
export function getTerm(id: string): GlossaryTerm | undefined {
  if (id in GLOSSARY_TERMS) {
    return GLOSSARY_TERMS[id as TermId];
  }
  return undefined;
}

/** Searches terms by matching queries against term name, aliases, short description, and long text. */
export function searchTerms(query: string, category?: TermCategory | "all"): GlossaryTerm[] {
  const q = query.trim().toLowerCase();
  return ALL_GLOSSARY_TERMS.filter((t) => {
    if (category && category !== "all" && t.category !== category) {
      return false;
    }
    if (!q) return true;
    if (t.term.toLowerCase().includes(q)) return true;
    if (t.short.toLowerCase().includes(q)) return true;
    if (t.long.toLowerCase().includes(q)) return true;
    if (t.aliases?.some((a) => a.toLowerCase().includes(q))) return true;
    return false;
  });
}
