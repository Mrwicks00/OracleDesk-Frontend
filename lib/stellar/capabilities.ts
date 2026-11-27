import { marketCore } from "./clients";

/**
 * Whether the deployed market-core exposes a function. The generated bindings
 * only carry the methods of the pinned contract spec, so a method missing here
 * means the deployment predates it and the UI must not offer the action.
 */
export function marketCoreSupports(fn: "claim_lp_fees" | "transfer_lp"): boolean {
  try {
    return typeof (marketCore() as unknown as Record<string, unknown>)[fn] === "function";
  } catch {
    return false;
  }
}
