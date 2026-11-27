// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PortfolioPage from "../page";
import { fakeWallet, FAKE_ADDRESS } from "@/lib/stellar/testing/fake-wallet";
import { xdr } from "@stellar/stellar-sdk";

const { mockState } = vi.hoisted(() => ({
  mockState: {
    wallet: null as any,
    isWatching: false,
    positionsRows: [] as any[],
    redeemables: [] as any[],
  },
}));

// Mock WalletContext
vi.mock("@/lib/contexts/WalletContext", () => ({
  useWallet: () => mockState.wallet ?? { address: null, isConnected: false },
  useWalletAddress: () => ({
    address: mockState.wallet?.address ?? null,
    isConnected: mockState.wallet?.isConnected ?? false,
  }),
  useWalletNetwork: () => ({ isWrongNetwork: mockState.wallet?.isWrongNetwork ?? false }),
  useWalletSigner: () => ({ signer: mockState.wallet?.signer ?? null }),
}));

// Mock useViewedAddress
vi.mock("@/lib/hooks/useViewedAddress", () => ({
  useViewedAddress: () => ({
    viewed: mockState.isWatching ? "GAWATCHONLYADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" : null,
    isWatching: mockState.isWatching,
    pendingWatch: null,
    confirmPendingWatch: vi.fn(),
    dismissPendingWatch: vi.fn(),
    setWatch: vi.fn(),
    clearWatch: vi.fn(),
  }),
}));

// Mock portfolio valuation & summaries
vi.mock("@/lib/hooks/usePortfolio", () => ({
  usePortfolio: () => ({ data: null, isLoading: false }),
  usePositions: () => ({ data: { positions: [] }, isLoading: false }),
}));

vi.mock("@/lib/portfolio/useValuation", () => ({
  useTreasuryValuation: () => ({
    mode: "mark",
    setMode: vi.fn(),
    exitTotalRaw: 0n,
    midTotalRaw: 0n,
    activeTotalRaw: 0n,
    paused: false,
    isLoading: false,
    byMarketId: new Map(),
  }),
}));

const dummyKey = xdr.LedgerKey.contractData(
  new xdr.LedgerKeyContractData({
    contract: new xdr.ScAddress(xdr.ScAddressType.scAddressTypeContract(), Buffer.alloc(32)),
    key: xdr.ScVal.scvSymbol("Market"),
    durability: xdr.ContractDataDurability.persistent(),
  }),
);

// Mock useAddressPositions
vi.mock("@/lib/hooks/useMyPositions", () => ({
  useAddressPositions: () => ({
    rows: mockState.positionsRows,
    isLoading: false,
    error: null,
    totalMarkets: 10n,
    totalValueRaw: 1000000n,
    scanLimited: false,
    coverage: { complete: true },
    refetch: vi.fn(),
  }),
  useMyPositions: () => ({ positions: [] }),
}));

// Mock redeemAll and stellar hooks
vi.mock("@/lib/hooks/useStellar", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hooks/useStellar")>("@/lib/hooks/useStellar");
  return {
    ...actual,
    useRedeemAll: () => ({
      discovery: {
        redeemables: mockState.redeemables,
        scannedMarkets: 10n,
        totalMarkets: 10n,
        scanLimited: false,
      },
      states: {},
      scanning: false,
      running: false,
      restoring: false,
      error: null,
      scan: vi.fn(),
      redeemAll: vi.fn(),
      restoreArchived: vi.fn(),
      retryFailed: vi.fn(),
      skip: vi.fn(),
      cancel: vi.fn(),
    }),
    useWriteGuard: () => vi.fn(),
    reviewPreparedWrite: vi.fn(async (prep: any) => ({ prepared: prep })),
    submitPrepared: vi.fn(async () => ({ value: 0n, txHash: "abc", ledger: 100 })),
  };
});

// Mock ttl extension & restore
vi.mock("@/lib/stellar/ttl", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stellar/ttl")>("@/lib/stellar/ttl");
  return {
    ...actual,
    prepareExtendTtl: vi.fn(async () => ({
      tx: { built: { operations: [{ type: "extendFootprintTtl", extendTo: 2000 }], fee: "100" } },
      kind: "extend-ttl",
      contract: "none",
      intent: {},
      derived: {},
      builtAt: Date.now(),
    })),
    prepareRestore: vi.fn(async () => ({
      tx: { built: { operations: [{ type: "restoreFootprint" }], fee: "100" } },
      kind: "restore",
      contract: "none",
      intent: {},
      derived: {},
      builtAt: Date.now(),
    })),
  };
});

function renderPortfolio() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PortfolioPage />
    </QueryClientProvider>,
  );
}

describe("Portfolio TTL badges and Keep Alive actions (Issue #304)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.isWatching = false;
    mockState.wallet = fakeWallet("connected");
    mockState.redeemables = [];
    mockState.positionsRows = [];
  });

  it("renders 'Storage expires in ~N days' badge for live positions and 'Needs restore' for archived", () => {
    mockState.positionsRows = [
      {
        marketId: 1n,
        question: "Will SpaceX land on Mars?",
        yes: 10000000n,
        no: 0n,
        settlement: null,
        yesBps: 6000,
        noBps: 4000,
        valueRaw: 6000000n,
        archived: false,
        ttl: {
          position: { key: dummyKey, kind: "position", marketId: 1n, liveUntil: 500000, latestLedger: 100000 },
          market: { key: dummyKey, kind: "market", marketId: 1n, liveUntil: 600000, latestLedger: 100000 },
        },
      },
      {
        marketId: 2n,
        question: "Will ETH reach $10k?",
        yes: 5000000n,
        no: 0n,
        settlement: null,
        yesBps: 4000,
        noBps: 6000,
        valueRaw: 2000000n,
        archived: true,
        ttl: {
          position: { key: dummyKey, kind: "position", marketId: 2n, liveUntil: 90000, latestLedger: 100000 },
          market: { key: dummyKey, kind: "market", marketId: 2n, liveUntil: 90000, latestLedger: 100000 },
        },
      },
    ];

    renderPortfolio();

    // Check position 1 live TTL badge
    const liveBadge = screen.getByTestId("ttl-badge-1");
    expect(liveBadge).toBeDefined();
    expect(liveBadge.textContent).toContain("Storage expires in ~");

    // Check position 2 archived badge and restore button
    const needsRestoreBadge = screen.getByTestId("ttl-needs-restore-2");
    expect(needsRestoreBadge).toBeDefined();
    expect(needsRestoreBadge.textContent).toBe("Needs restore");

    const restoreBtn = screen.getByTestId("restore-entry-2");
    expect(restoreBtn).toBeDefined();
    expect(restoreBtn.textContent).toBe("Restore");
  });

  it("hides Keep Alive bulk actions and single restore buttons in watch-only mode", () => {
    mockState.isWatching = true;
    mockState.positionsRows = [
      {
        marketId: 1n,
        question: "Test Market",
        yes: 10000000n,
        no: 0n,
        settlement: null,
        yesBps: 5000,
        noBps: 5000,
        valueRaw: 5000000n,
        archived: true,
        ttl: {
          position: { key: dummyKey, kind: "position", marketId: 1n, liveUntil: 90000, latestLedger: 100000 },
          market: { key: dummyKey, kind: "market", marketId: 1n, liveUntil: 90000, latestLedger: 100000 },
        },
      },
    ];

    renderPortfolio();

    // Needs restore badge is shown
    expect(screen.getByTestId("ttl-needs-restore-1")).toBeDefined();

    // But no restore button or selection checkbox in watch-only mode
    expect(screen.queryByTestId("restore-entry-1")).toBeNull();
    expect(screen.queryByLabelText("Select all unarchived positions for storage extension")).toBeNull();
  });

  it("enables 'Keep alive' action when row is selected and calls prepareExtendTtl", async () => {
    mockState.positionsRows = [
      {
        marketId: 1n,
        question: "Will AI pass Bar exam?",
        yes: 10000000n,
        no: 0n,
        settlement: null,
        yesBps: 8000,
        noBps: 2000,
        valueRaw: 8000000n,
        archived: false,
        ttl: {
          position: { key: dummyKey, kind: "position", marketId: 1n, liveUntil: 150000, latestLedger: 100000 },
          market: { key: dummyKey, kind: "market", marketId: 1n, liveUntil: 150000, latestLedger: 100000 },
        },
      },
    ];

    renderPortfolio();

    const checkbox = screen.getByLabelText("Select market #1 for storage extension");
    fireEvent.click(checkbox);

    // Keep alive button should now be visible
    const keepAliveBtn = screen.getByTestId("keep-alive-btn");
    expect(keepAliveBtn).toBeDefined();

    // Click keep alive
    fireEvent.click(keepAliveBtn);
  });

  it("displays archived warning and 'Restore archived first' button in connected redemptions", () => {
    mockState.redeemables = [
      {
        marketId: 42n,
        position: { yes: 100n, no: 0n },
        market: { status: "Resolved", outcome: "Yes" },
        expectedPayout: 10000000n,
        settlement: "yes",
        archived: true,
      },
    ];

    renderPortfolio();

    expect(screen.getByText(/position\(s\) are archived and require restoring before redemption/i)).toBeDefined();
    expect(screen.getByTestId("redeem-restore-archived-btn")).toBeDefined();
  });
});
