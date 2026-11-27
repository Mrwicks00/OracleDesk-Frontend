import { describe, it, expect, vi } from "vitest";
import { Keypair, Operation, SorobanDataBuilder, xdr } from "@stellar/stellar-sdk";
import { estimateTtl, fetchNetworkMaxEntryTtl, prepareExtendTtl, prepareRestore, createRestoreCallback } from "../ttl";
import { marketLedgerKey, positionLedgerKey } from "../ledger-entries";

describe("TTL estimation and operations", () => {
  const dummyHolder = Keypair.random().publicKey();

  describe("estimateTtl", () => {
    it("handles null/undefined liveUntil gracefully as unknown (not archived)", () => {
      const entry = {
        key: marketLedgerKey(1n),
        kind: "market" as const,
        marketId: 1n,
        liveUntil: null,
        latestLedger: 1000,
      };

      const est = estimateTtl(entry);
      expect(est.archived).toBe(false);
      expect(est.ledgersLeft).toBe(0);
      expect(est.etaSeconds).toBe(0);
      expect(est.etaRangeSeconds).toEqual([0, 0]);
    });

    it("correctly identifies archived entries when liveUntil <= latestLedger", () => {
      const entry = {
        key: positionLedgerKey(1n, dummyHolder),
        kind: "position" as const,
        marketId: 1n,
        liveUntil: 1000,
        latestLedger: 1005,
      };

      const est = estimateTtl(entry);
      expect(est.archived).toBe(true);
      expect(est.ledgersLeft).toBe(0);
      expect(est.etaSeconds).toBe(0);
    });

    it("calculates ledgersLeft and range seconds for live entries", () => {
      const entry = {
        key: positionLedgerKey(1n, dummyHolder),
        kind: "position" as const,
        marketId: 1n,
        liveUntil: 2000,
        latestLedger: 1000,
      };

      const speeds = { mean: 5, min: 4, max: 7 };
      const est = estimateTtl(entry, speeds);

      expect(est.archived).toBe(false);
      expect(est.ledgersLeft).toBe(1000);
      expect(est.etaSeconds).toBe(5000);
      expect(est.etaRangeSeconds).toEqual([4000, 7000]);
    });
  });

  describe("prepareExtendTtl", () => {
    it("puts keys in read-only footprint and clamps extendTo to network max", async () => {
      const sourceKeypair = Keypair.random();
      const source = sourceKeypair.publicKey();
      const keys = [marketLedgerKey(1n), positionLedgerKey(1n, source)];

      const mockServer = {
        getLedgerEntries: vi.fn().mockResolvedValue({ entries: [] }),
        getLatestLedger: vi.fn().mockResolvedValue({ sequence: 1000 }),
        getAccount: vi.fn().mockResolvedValue({
          sequenceNumber: () => "100",
        }),
        simulateTransaction: vi.fn().mockImplementation(async (tx) => {
          return {
            minResourceFee: "50000",
            transactionData: new SorobanDataBuilder(),
          };
        }),
      } as any;

      // Ask for 10,000,000 ledgers, but network max is 3,110,400 -> clamped to 1000 + 3110400 = 3111400
      const prep = await prepareExtendTtl(source, keys, 10_000_000, {
        server: mockServer,
      });

      expect(prep.kind).toBe("extend-ttl");
      expect(prep.contract).toBe("none");
      expect(prep.intent.extendTo).toBe("3111400");
      expect(prep.intent.entriesCount).toBe("2");
    });

    it("skips keys that already live past extendTo", async () => {
      const source = Keypair.random().publicKey();
      const key1 = marketLedgerKey(1n);
      const key2 = positionLedgerKey(1n, source);

      const knownLiveUntil = new Map<string, number>();
      knownLiveUntil.set(key1.toXDR("base64"), 5000); // Already lives until 5000
      knownLiveUntil.set(key2.toXDR("base64"), 2000); // Lives until 2000

      const mockServer = {
        getLedgerEntries: vi.fn().mockResolvedValue({ entries: [] }),
        getLatestLedger: vi.fn().mockResolvedValue({ sequence: 1000 }),
        getAccount: vi.fn().mockResolvedValue({
          sequenceNumber: () => "100",
        }),
        simulateTransaction: vi.fn().mockImplementation(async () => ({
          minResourceFee: "20000",
          transactionData: new SorobanDataBuilder(),
        })),
      } as any;

      // Target is 3000 -> key1 should be skipped, only key2 extended
      const prep = await prepareExtendTtl(source, [key1, key2], 3000, {
        server: mockServer,
        knownLiveUntil,
      });

      expect(prep.intent.entriesCount).toBe("1");
    });

    it("splits batch in halves on simulation resource limit error", async () => {
      const source = Keypair.random().publicKey();
      const keys = [
        marketLedgerKey(1n),
        marketLedgerKey(2n),
        marketLedgerKey(3n),
        marketLedgerKey(4n),
      ];

      let attempts = 0;
      const mockServer = {
        getLedgerEntries: vi.fn().mockResolvedValue({ entries: [] }),
        getLatestLedger: vi.fn().mockResolvedValue({ sequence: 1000 }),
        getAccount: vi.fn().mockResolvedValue({
          sequenceNumber: () => "100",
        }),
        simulateTransaction: vi.fn().mockImplementation(async (tx) => {
          attempts++;
          if (attempts === 1) {
            // First attempt with 4 keys fails with resource error
            return { error: "Resource limit exceeded (instructions or footprint too large)" };
          }
          // Halved batch with 2 keys succeeds
          return {
            minResourceFee: "30000",
            transactionData: new SorobanDataBuilder(),
          };
        }),
      } as any;

      const prep = await prepareExtendTtl(source, keys, 5000, {
        server: mockServer,
      });

      expect(attempts).toBe(2);
      expect(prep.intent.entriesCount).toBe("2");
    });
  });

  describe("prepareRestore and createRestoreCallback", () => {
    it("puts keys in read-write footprint for restoreFootprint", async () => {
      const source = Keypair.random().publicKey();
      const keys = [marketLedgerKey(1n), positionLedgerKey(1n, source)];

      const mockServer = {
        getAccount: vi.fn().mockResolvedValue({
          sequenceNumber: () => "100",
        }),
        simulateTransaction: vi.fn().mockImplementation(async () => ({
          minResourceFee: "60000",
          transactionData: new SorobanDataBuilder(),
        })),
      } as any;

      const prep = await prepareRestore(source, keys, { server: mockServer });
      expect(prep.kind).toBe("restore");
      expect(prep.contract).toBe("none");
      expect(prep.intent.entriesCount).toBe("2");
    });

    it("createRestoreCallback triggers prepareRestore and passes to onSubmit", async () => {
      const source = Keypair.random().publicKey();
      const keys = [marketLedgerKey(1n)];
      let submitted = false;

      const mockServer = {
        getAccount: vi.fn().mockResolvedValue({
          sequenceNumber: () => "100",
        }),
        simulateTransaction: vi.fn().mockImplementation(async () => ({
          minResourceFee: "60000",
          transactionData: new SorobanDataBuilder(),
        })),
      } as any;

      const callback = createRestoreCallback(source, keys, {
        server: mockServer,
        onSubmit: async (prep) => {
          submitted = true;
          expect(prep.kind).toBe("restore");
        },
      });

      await callback();
      expect(submitted).toBe(true);
    });
  });
});
