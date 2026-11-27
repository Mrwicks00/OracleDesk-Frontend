// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import GlossaryPage from "../page";

describe("Glossary Page (Issue #305)", () => {
  it("renders page title and terms list", () => {
    render(<GlossaryPage />);

    expect(screen.getByRole("heading", { level: 1, name: /protocol & prediction glossary/i })).toBeDefined();

    // Check a few terms are in the document
    expect(screen.getByText("Slippage")).toBeDefined();
    expect(screen.getByText("Trustline")).toBeDefined();
    expect(screen.getByText("Reasoning Agent")).toBeDefined();
  });

  it("filters terms by search query and updates results live announcement", () => {
    render(<GlossaryPage />);

    const searchInput = screen.getByLabelText(/search glossary terms/i);
    fireEvent.change(searchInput, { target: { value: "collateral" } });

    // Should find USDC, Share, Liquidity pool etc.
    expect(screen.getByText("USD Coin (USDC)")).toBeDefined();
    // Non-collateral terms like time-bounds should be filtered out
    expect(screen.queryByText("Time Bounds")).toBeNull();

    // Live region status
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/found for "collateral"/i);
  });

  it("filters terms by category", () => {
    render(<GlossaryPage />);

    const stellarCategoryBtn = screen.getByRole("button", { name: "stellar" });
    fireEvent.click(stellarCategoryBtn);

    expect(stellarCategoryBtn.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Trustline")).toBeDefined();
    expect(screen.queryByText("Slippage")).toBeNull(); // Slippage is a market term
  });

  it("renders term anchors and seeAlso links", () => {
    render(<GlossaryPage />);

    const slippageArticle = document.getElementById("slippage");
    expect(slippageArticle).not.toBeNull();

    // Contains seeAlso links
    const limitPriceLink = screen.getByRole("link", { name: "limit-price" });
    expect(limitPriceLink.getAttribute("href")).toBe("#limit-price");
  });
});
