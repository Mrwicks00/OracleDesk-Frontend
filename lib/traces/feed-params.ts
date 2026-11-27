import type { AgentType } from "@/lib/api/traces";
import type { TraceFeedFilters, Verification } from "./feed-filters";

/** Short, stable URL keys: type, market, onchain, v (verification list), held. */
const AGENT_TYPES: AgentType[] = ["MARKET_MAKER", "TRADER"];
const VERIFICATION: Verification[] = ["verified", "unchecked"];
const MARKET_ID = /^[A-Za-z0-9-]{1,64}$/;

/** Reads filters from the URL. Invalid values are dropped, never trusted. */
export function parseTraceFilters(sp: URLSearchParams): TraceFeedFilters {
  const filters: TraceFeedFilters = {};

  const type = sp.get("type");
  if (type && (AGENT_TYPES as string[]).includes(type)) filters.agentType = type as AgentType;

  const market = sp.get("market");
  if (market && MARKET_ID.test(market)) filters.marketId = market;

  const agent = sp.get("agent");
  if (agent && /^G[A-Z2-7]{55}$/.test(agent)) filters.agent = agent;

  const onchain = sp.get("onchain");
  if (onchain === "yes" || onchain === "no") filters.onChain = onchain;

  const verification = (sp.get("v") ?? "")
    .split(",")
    .filter((value): value is Verification => (VERIFICATION as string[]).includes(value));
  if (verification.length > 0) filters.verification = [...new Set(verification)];

  if (sp.get("held") === "1") filters.held = true;

  return filters;
}

/** Writes filters in a stable key order, leaving out defaults. */
export function serializeTraceFilters(filters: TraceFeedFilters): string {
  const sp = new URLSearchParams();
  if (filters.agentType) sp.set("type", filters.agentType);
  if (filters.marketId) sp.set("market", filters.marketId);
  if (filters.agent) sp.set("agent", filters.agent);
  if (filters.onChain) sp.set("onchain", filters.onChain);
  if (filters.verification && filters.verification.length > 0) {
    const ordered = VERIFICATION.filter((value) => filters.verification!.includes(value));
    sp.set("v", ordered.join(","));
  }
  if (filters.held) sp.set("held", "1");
  return sp.toString();
}
