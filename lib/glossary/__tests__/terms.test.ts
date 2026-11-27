import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ALL_GLOSSARY_TERMS, GLOSSARY_TERMS, getTerm, searchTerms, type TermId } from "../terms";

describe("Canonical Glossary Terms (Issue #305)", () => {
  it("contains at least 24 defined terms", () => {
    expect(ALL_GLOSSARY_TERMS.length).toBeGreaterThanOrEqual(24);
  });

  it("ensures every term has a short description of 140 characters or fewer", () => {
    for (const term of ALL_GLOSSARY_TERMS) {
      expect(
        term.short.length,
        `Term '${term.id}' short description exceeds 140 characters (${term.short.length}): "${term.short}"`,
      ).toBeLessThanOrEqual(140);
      expect(term.short.length, `Term '${term.id}' has empty short description`).toBeGreaterThan(10);
    }
  });

  it("ensures all seeAlso references point to valid TermIds", () => {
    for (const term of ALL_GLOSSARY_TERMS) {
      if (term.seeAlso) {
        for (const relatedId of term.seeAlso) {
          expect(GLOSSARY_TERMS[relatedId], `Term '${term.id}' has invalid seeAlso '${relatedId}'`).toBeDefined();
        }
      }
    }
  });

  it("ensures all source paths point to existing files in the repository", () => {
    const root = path.resolve(__dirname, "../../../");
    for (const term of ALL_GLOSSARY_TERMS) {
      if (term.source) {
        const fullPath = path.resolve(root, term.source);
        expect(fs.existsSync(fullPath), `Term '${term.id}' source file '${term.source}' does not exist`).toBe(true);
      }
    }
  });

  it("supports getTerm retrieval", () => {
    expect(getTerm("slippage")).toBeDefined();
    expect(getTerm("slippage")?.term).toBe("Slippage");
    expect(getTerm("nonexistent-id")).toBeUndefined();
  });

  it("supports searchTerms with category filtering and text matching", () => {
    const marketTerms = searchTerms("", "market");
    expect(marketTerms.every((t) => t.category === "market")).toBe(true);

    const stellarTerms = searchTerms("", "stellar");
    expect(stellarTerms.every((t) => t.category === "stellar")).toBe(true);

    const results = searchTerms("collateral");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((t) => t.id === "usdc" || t.id === "share" || t.id === "liquidity-pool")).toBe(true);
  });
});
