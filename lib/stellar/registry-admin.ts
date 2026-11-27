import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";
import { rpcServer, reasoningRegistry } from "./clients";
import { CONTRACTS } from "./config";
import { read } from "./typed-call";

/**
 * Reads a value from a contract's instance storage.
 * Matches instance keys encoded either as bare `scvSymbol(name)` or as
 * unit enum variants `scvVec([scvSymbol(name)])` (e.g. `DataKey::Admin`).
 * Returns null when the entry or key is absent.
 */
export async function readInstanceValue(
  contractId: string,
  keyName: string,
  server = rpcServer(),
): Promise<unknown | null> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const response = await server.getLedgerEntries(key);
  const entry = response.entries[0];
  if (!entry) return null;
  const value = entry.val.contractData().val();
  if (value.switch().name !== "scvContractInstance") return null;
  const storage = value.instance().storage();
  if (!storage) return null;
  for (const item of storage) {
    const itemKey = item.key();
    // 1. Bare scvSymbol
    if (itemKey.switch().name === "scvSymbol" && itemKey.sym().toString() === keyName) {
      return scValToNative(item.val());
    }
    // 2. Enum unit variant: scvVec([scvSymbol(keyName)])
    if (itemKey.switch().name === "scvVec") {
      const vec = itemKey.vec();
      if (
        vec &&
        vec.length === 1 &&
        vec[0].switch().name === "scvSymbol" &&
        vec[0].sym().toString() === keyName
      ) {
        return scValToNative(item.val());
      }
    }
  }
  return null;
}

/**
 * The reasoning registry's admin address, or null if it cannot be read.
 * Prefers reading via `reasoningRegistry().admin()` if available on the contract,
 * and falls back to instance storage inspection.
 */
export async function readRegistryAdmin(server = rpcServer()): Promise<string | null> {
  try {
    const client = reasoningRegistry() as unknown as Record<string, unknown>;
    if (typeof client.admin === "function") {
      const res = await read(await (client.admin as () => Promise<unknown>)());
      if (typeof res === "string") return res;
      if (res && typeof (res as { toString(): string }).toString === "function") {
        return (res as { toString(): string }).toString();
      }
    }
  } catch {
    // contract admin() method not available on this spec/wasm, fallback to instance storage
  }

  const value = await readInstanceValue(CONTRACTS.reasoningRegistry, "Admin", server);
  if (typeof value === "string") return value;
  if (value && typeof (value as { toString(): string }).toString === "function") {
    const s = (value as { toString(): string }).toString();
    if (typeof s === "string" && s.startsWith("G")) return s;
  }
  return null;
}
