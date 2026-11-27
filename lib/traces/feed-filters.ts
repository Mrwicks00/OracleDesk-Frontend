import type { AgentType, ListTracesParams, ReasoningTrace } from "@/lib/api/traces";

/**
 * Trace feed filters. Server-side parts go to `GET /traces` (`agentType`,
 * backend `marketId`). Client-side predicates are applied to each loaded page,
 * so they can only use data the backend already returns for the trace.
 */
export type Verification = "verified" | "unchecked";

export interface TraceFeedFilters {
  /** Server: agent type. */
  agentType?: AgentType;
  /** Server: backend market UUID. */
  marketId?: string;
  /** Client: backend agent id (`ReasoningTrace.agentId`) equal to this value. */
  agent?: string;
  /** Client: `onChain: "yes"` keeps traces with an on-chain registry id; `"no"` keeps the rest. */
  onChain?: "yes" | "no";
  /**
   * Client: `verified` keeps traces the backend marks verified; `unchecked` keeps the rest.
   * The backend claim is used as-is. Full IPFS hash checks run only on the trace page.
   */
  verification?: Verification[];
  /** Client: keep traces on markets where the connected wallet holds a position. Ignored without a wallet. */
  held?: boolean;
}

export const EMPTY_FILTERS: TraceFeedFilters = {};

export function isEmptyFilters(filters: TraceFeedFilters): boolean {
  return (
    filters.agentType === undefined &&
    filters.marketId === undefined &&
    filters.onChain === undefined &&
    filters.agent === undefined &&
    (filters.verification === undefined || filters.verification.length === 0) &&
    !filters.held
  );
}

/** Server-side query parameters for `useInfiniteTraces`. */
export function serverParams(filters: TraceFeedFilters): Omit<ListTracesParams, "page"> {
  return {
    ...(filters.agentType ? { agentType: filters.agentType } : {}),
    ...(filters.marketId ? { marketId: filters.marketId } : {}),
  };
}

/**
 * Whether one loaded trace passes the client-side predicates. `heldMarketIds`
 * is the set of on-chain market ids the wallet holds, or null when no wallet is
 * connected (the held predicate then does not filter).
 */
export function matches(
  trace: ReasoningTrace,
  filters: TraceFeedFilters,
  heldMarketIds: ReadonlySet<string> | null,
): boolean {
  if (filters.agent && trace.agentId !== filters.agent) return false;
  if (filters.onChain === "yes" && !trace.onChainTraceId) return false;
  if (filters.onChain === "no" && trace.onChainTraceId) return false;

  if (filters.verification && filters.verification.length > 0) {
    const status: Verification = trace.verified ? "verified" : "unchecked";
    if (!filters.verification.includes(status)) return false;
  }

  if (filters.held && heldMarketIds) {
    const onChainId = trace.market?.onChainMarketId;
    if (!onChainId || !heldMarketIds.has(onChainId)) return false;
  }

  return true;
}
