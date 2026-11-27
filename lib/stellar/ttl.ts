import {
  Account,
  BASE_FEE,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { rpcServer } from "./clients";
import { NETWORK_PASSPHRASE } from "./config";
import type { PreparedWrite } from "@/lib/hooks/useStellar";
import { UserFacingError } from "./errors";

export interface EntryTtl {
  key: xdr.LedgerKey;
  kind: "market" | "position";
  marketId: bigint;
  liveUntil: number | null;
  latestLedger: number;
}

export interface TtlEstimate {
  ledgersLeft: number;
  archived: boolean;
  etaSeconds: number;
  etaRangeSeconds: [number, number];
}

/**
 * Estimates remaining TTL in wall-clock seconds from ledger sequence differences.
 * Uses session-derived min/max/mean close times rather than false-precision calendar dates.
 */
export function estimateTtl(
  e: EntryTtl,
  ledgerSecs: { mean: number; min: number; max: number } = { mean: 5, min: 4, max: 7 },
): TtlEstimate {
  if (e.liveUntil === null || e.liveUntil === undefined) {
    return {
      ledgersLeft: 0,
      archived: false,
      etaSeconds: 0,
      etaRangeSeconds: [0, 0],
    };
  }

  const archived = e.liveUntil <= e.latestLedger;
  const ledgersLeft = archived ? 0 : Math.max(0, e.liveUntil - e.latestLedger);
  const etaSeconds = Math.round(ledgersLeft * ledgerSecs.mean);
  const etaRangeSeconds: [number, number] = [
    Math.round(ledgersLeft * ledgerSecs.min),
    Math.round(ledgersLeft * ledgerSecs.max),
  ];

  return {
    ledgersLeft,
    archived,
    etaSeconds,
    etaRangeSeconds,
  };
}

/**
 * Reads the network's maximum entry TTL in ledgers from Soroban ConfigSettingStateArchival.
 * Falls back to 3,110,400 ledgers (~180 days at 5 s/ledger) if unavailable.
 */
export async function fetchNetworkMaxEntryTtl(server: rpc.Server = rpcServer()): Promise<number> {
  try {
    const configKey = xdr.LedgerKey.configSetting(
      new xdr.LedgerKeyConfigSetting({
        configSettingId: xdr.ConfigSettingId.configSettingStateArchival(),
      }),
    );
    const resp = await server.getLedgerEntries(configKey);
    if (resp.entries && resp.entries.length > 0) {
      const entry = resp.entries[0];
      const settings = entry.val.configSetting().stateArchivalSettings();
      return settings.maxEntryTtl();
    }
  } catch {
    // Non-fatal fallback
  }
  return 3_110_400;
}

export interface PrepareExtendTtlOptions {
  server?: rpc.Server;
  networkPassphrase?: string;
  knownLiveUntil?: Map<string, number>;
  timeoutInSeconds?: number;
}

/**
 * Prepares a batched ExtendFootprintTTL transaction with all target keys in the read-only footprint.
 * Clamps `extendTo` to the network's maximum entry TTL and splits batches in halves on simulation
 * resource limits. Skips keys that already live past `extendTo`.
 */
export async function prepareExtendTtl(
  source: string,
  keys: xdr.LedgerKey[],
  extendToLedgers: number,
  opts?: PrepareExtendTtlOptions,
): Promise<PreparedWrite> {
  const server = opts?.server ?? rpcServer();
  const networkPassphrase = opts?.networkPassphrase ?? NETWORK_PASSPHRASE;

  const [maxEntryTtl, latestLedgerResp, accountResp] = await Promise.all([
    fetchNetworkMaxEntryTtl(server),
    server.getLatestLedger(),
    server.getAccount(source),
  ]);

  const latestLedger = latestLedgerResp.sequence;
  const clampedExtendTo = Math.min(extendToLedgers, latestLedger + maxEntryTtl);

  // Filter out no-op keys whose current TTL is already >= clampedExtendTo
  const effectiveKeys = keys.filter((key) => {
    if (!opts?.knownLiveUntil) return true;
    const currentLiveUntil = opts.knownLiveUntil.get(key.toXDR("base64"));
    if (currentLiveUntil !== undefined && currentLiveUntil >= clampedExtendTo) {
      return false;
    }
    return true;
  });

  if (effectiveKeys.length === 0) {
    throw new UserFacingError({
      kind: "unknown",
      message: "Selected entries already meet or exceed the target lifetime. No extension needed.",
    });
  }

  // Batch splitting algorithm: simulate all keys; on resource errors, split in halves
  async function simulateBatch(batch: xdr.LedgerKey[]): Promise<{
    batch: xdr.LedgerKey[];
    simResponse: rpc.Api.SimulateTransactionResponse;
    txBuilder: TransactionBuilder;
  }> {
    if (batch.length === 0) {
      throw new Error("No keys to simulate.");
    }

    const sorobanData = new SorobanDataBuilder().setReadOnly(batch).build();
    const account = new Account(source, accountResp.sequenceNumber());
    const txBuilder = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .setSorobanData(sorobanData)
      .addOperation(Operation.extendFootprintTtl({ extendTo: clampedExtendTo }))
      .setTimeout(opts?.timeoutInSeconds ?? 60);

    const built = txBuilder.build();
    const simResponse = await server.simulateTransaction(built);

    if (rpc.Api.isSimulationError(simResponse)) {
      if (batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        return simulateBatch(batch.slice(0, mid));
      }
      throw new UserFacingError({
        kind: "unknown",
        message: `Simulation failed for TTL extension: ${simResponse.error}`,
      });
    }

    return { batch, simResponse, txBuilder };
  }

  const { batch, simResponse } = await simulateBatch(effectiveKeys);
  const simAny = simResponse as { minResourceFee?: string | number; transactionData?: { build: () => xdr.SorobanTransactionData } };
  const minResourceFee = simAny.minResourceFee ? BigInt(simAny.minResourceFee) : 0n;
  const totalFee = (BigInt(BASE_FEE) + minResourceFee).toString();

  // Rebuild with updated fee and transactionData
  const account = new Account(source, accountResp.sequenceNumber());
  const finalTxBuilder = new TransactionBuilder(account, {
    fee: totalFee,
    networkPassphrase,
  })
    .setSorobanData(simAny.transactionData ? simAny.transactionData.build() : undefined)
    .addOperation(Operation.extendFootprintTtl({ extendTo: clampedExtendTo }))
    .setTimeout(opts?.timeoutInSeconds ?? 60);

  const finalTx = finalTxBuilder.build();
  const assembled = {
    options: {
      server,
      networkPassphrase,
      method: "extendFootprintTtl",
    },
    built: finalTx,
    simulation: simResponse,
    signAndSend: async () => {
      throw new Error("Use useTxRunner for signing and submitting.");
    },
    toJSON: () => ({}),
  } as unknown as AssembledTransaction<null>;

  return {
    tx: assembled,
    kind: "extend-ttl",
    contract: "none",
    derived: {},
    intent: {
      action: "extend-ttl",
      entriesCount: String(batch.length),
      extendTo: String(clampedExtendTo),
    },
    builtAt: Date.now(),
  };
}

export interface PrepareRestoreOptions {
  server?: rpc.Server;
  networkPassphrase?: string;
  timeoutInSeconds?: number;
}

/**
 * Prepares a RestoreFootprint transaction with target archived keys in the read-write footprint.
 * Splits batches in halves on simulation resource limit errors.
 */
export async function prepareRestore(
  source: string,
  keys: xdr.LedgerKey[],
  opts?: PrepareRestoreOptions,
): Promise<PreparedWrite> {
  if (keys.length === 0) {
    throw new UserFacingError({
      kind: "unknown",
      message: "No archived entries specified for restore.",
    });
  }

  const server = opts?.server ?? rpcServer();
  const networkPassphrase = opts?.networkPassphrase ?? NETWORK_PASSPHRASE;
  const accountResp = await server.getAccount(source);

  async function simulateRestoreBatch(batch: xdr.LedgerKey[]): Promise<{
    batch: xdr.LedgerKey[];
    simResponse: rpc.Api.SimulateTransactionResponse;
  }> {
    const sorobanData = new SorobanDataBuilder().setReadWrite(batch).build();
    const account = new Account(source, accountResp.sequenceNumber());
    const txBuilder = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .setSorobanData(sorobanData)
      .addOperation(Operation.restoreFootprint({}))
      .setTimeout(opts?.timeoutInSeconds ?? 60);

    const built = txBuilder.build();
    const simResponse = await server.simulateTransaction(built);

    if (rpc.Api.isSimulationError(simResponse)) {
      if (batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        return simulateRestoreBatch(batch.slice(0, mid));
      }
      throw new UserFacingError({
        kind: "unknown",
        message: `Simulation failed for footprint restore: ${simResponse.error}`,
      });
    }

    return { batch, simResponse };
  }

  const { batch, simResponse } = await simulateRestoreBatch(keys);
  const simAny = simResponse as { minResourceFee?: string | number; transactionData?: { build: () => xdr.SorobanTransactionData } };
  const minResourceFee = simAny.minResourceFee ? BigInt(simAny.minResourceFee) : 0n;
  const totalFee = (BigInt(BASE_FEE) + minResourceFee).toString();

  const account = new Account(source, accountResp.sequenceNumber());
  const finalTxBuilder = new TransactionBuilder(account, {
    fee: totalFee,
    networkPassphrase,
  })
    .setSorobanData(simAny.transactionData ? simAny.transactionData.build() : undefined)
    .addOperation(Operation.restoreFootprint({}))
    .setTimeout(opts?.timeoutInSeconds ?? 60);

  const finalTx = finalTxBuilder.build();
  const assembled = {
    options: {
      server,
      networkPassphrase,
      method: "restoreFootprint",
    },
    built: finalTx,
    simulation: simResponse,
    signAndSend: async () => {
      throw new Error("Use useTxRunner for signing and submitting.");
    },
    toJSON: () => ({}),
  } as unknown as AssembledTransaction<null>;

  return {
    tx: assembled,
    kind: "restore",
    contract: "none",
    derived: {},
    intent: {
      action: "restore",
      entriesCount: String(batch.length),
    },
    builtAt: Date.now(),
  };
}

/**
 * Creates a restore callback for simulateWithRestore that restores the target archived keys.
 */
export function createRestoreCallback(
  source: string,
  keys: xdr.LedgerKey[],
  opts?: PrepareRestoreOptions & { onSubmit?: (prepared: PreparedWrite) => Promise<void> },
): () => Promise<void> {
  return async () => {
    const prepared = await prepareRestore(source, keys, opts);
    if (opts?.onSubmit) {
      await opts.onSubmit(prepared);
    }
  };
}
