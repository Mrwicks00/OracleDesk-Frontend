// @vitest-environment jsdom
/**
 * Issue #307: DOM tests for registry moderation and TraceStatusBadge.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TraceStatusBadge } from "@/components/trace/trace-status-badge";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock useRegistryModeration hooks for controlled badge states
vi.mock("@/lib/hooks/useRegistryModeration", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/hooks/useRegistryModeration");
  return {
    ...actual,
    useTraceFlag: vi.fn((id: string | undefined) => {
      if (id === "100") return { data: { active: true, reason: "Spam trace" }, isLoading: false };
      return { data: null, isLoading: false };
    }),
    useAgentRecord: vi.fn((addr: string | undefined) => {
      if (addr === "GREVOKED") {
        return {
          data: { kind: "Revoked", effectiveFrom: 1000n, reason: "Protocol violation", registeredAt: 500n },
          isLoading: false,
        };
      }
      return {
        data: { kind: "Active", registeredAt: 500n },
        isLoading: false,
      };
    }),
  };
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("TraceStatusBadge (Issue #307)", () => {
  it("renders 'Hash mismatch' when hashOk is false", () => {
    wrap(
      <TraceStatusBadge
        traceId="1"
        agentAddr="GACTIVE"
        hashOk={false}
        publishedAt={600n}
      />,
    );
    expect(screen.getByText("Hash mismatch")).toBeDefined();
  });

  it("renders 'Flagged' when trace has an active flag", () => {
    wrap(
      <TraceStatusBadge
        traceId="100"
        agentAddr="GACTIVE"
        hashOk={true}
        publishedAt={600n}
      />,
    );
    expect(screen.getByText("Flagged")).toBeDefined();
  });

  it("renders 'Agent revoked' when agent was revoked before publish time", () => {
    wrap(
      <TraceStatusBadge
        traceId="2"
        agentAddr="GREVOKED"
        hashOk={true}
        publishedAt={1500n}
      />,
    );
    expect(screen.getByText("Agent revoked")).toBeDefined();
  });

  it("renders 'Verified' when hash matches and no flags/revocations apply", () => {
    wrap(
      <TraceStatusBadge
        traceId="3"
        agentAddr="GACTIVE"
        hashOk={true}
        publishedAt={600n}
      />,
    );
    expect(screen.getByText("Verified")).toBeDefined();
  });
});
