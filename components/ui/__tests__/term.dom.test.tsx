// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { Term, InInteractiveContext } from "../term";

describe("<Term /> contextual help component (Issue #305)", () => {
  it("renders trigger button with accessible aria attributes", () => {
    render(<Term id="slippage">slippage tolerance</Term>);

    const trigger = screen.getByRole("button", { name: /glossary definition for slippage/i });
    expect(trigger).toBeDefined();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toBe("slippage tolerance");
  });

  it("opens popover with plain-language short explanation and full guide link on click", async () => {
    render(<Term id="trustline" />);

    const trigger = screen.getByRole("button", { name: /glossary definition for trustline/i });
    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    // Popover content should be displayed
    const headings = screen.getAllByText("Trustline");
    expect(headings.length).toBeGreaterThanOrEqual(2);

    const categoryBadge = screen.getByText("Stellar");
    expect(categoryBadge).toBeDefined();

    // Short definition
    expect(screen.getByText(/explicit Stellar ledger entry allowing an account to hold/i)).toBeDefined();

    // Link to full glossary anchor
    const link = screen.getByRole("link", { name: /full explanation/i });
    expect(link.getAttribute("href")).toBe("/help/glossary#trustline");

    // Close button closes popover
    const closeBtn = screen.getByRole("button", { name: /close glossary definition/i });
    fireEvent.click(closeBtn);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders non-interactive span fallback when inside interactive element", () => {
    render(
      <InInteractiveContext.Provider value={true}>
        <button type="button">
          Submit with <Term id="slippage">slippage</Term>
        </button>
      </InInteractiveContext.Provider>,
    );

    // There should only be the outer button; no nested buttons
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(1);

    const termSpan = screen.getByTitle(/slippage:/i);
    expect(termSpan).toBeDefined();
    expect(termSpan.tagName.toLowerCase()).toBe("span");
  });

  it("gracefully falls back to plain children for unknown term ids", () => {
    // @ts-expect-error testing unknown term id
    render(<Term id="unknown-term-id">my unknown term</Term>);

    expect(screen.getByText("my unknown term")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
