"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { ALL_GLOSSARY_TERMS, searchTerms, type TermCategory, type GlossaryTerm } from "@/lib/glossary/terms";
import { LiveRegion } from "@/components/ui/live-region";
import { Icon } from "@/components/ui/icon";

export default function GlossaryPage() {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<TermCategory | "all">("all");

  const results = useMemo(() => {
    return searchTerms(query, selectedCategory);
  }, [query, selectedCategory]);

  const liveMessage = useMemo(() => {
    if (!query && selectedCategory === "all") {
      return `Showing all ${results.length} glossary terms.`;
    }
    return `${results.length} term${results.length === 1 ? "" : "s"} found for "${query || selectedCategory}".`;
  }, [results.length, query, selectedCategory]);

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-xs text-on-surface-variant">
        <Link href="/" className="hover:underline">Home</Link>
        <span>/</span>
        <span className="font-semibold text-on-surface">Glossary</span>
      </nav>

      <header className="mb-8">
        <h1 className="font-display-lg text-3xl font-bold tracking-tight text-on-surface mb-2">
          Protocol & Prediction Glossary
        </h1>
        <p className="text-on-surface-variant text-base leading-relaxed max-w-2xl">
          Plain-language explanations for prediction-market mechanisms, Stellar blockchain primitives, and OracleDesk autonomous reasoning verifications.
        </p>
      </header>

      {/* Search and Filters */}
      <section aria-label="Glossary search and category filters" className="mb-8 space-y-4">
        <div className="relative">
          <label htmlFor="glossary-search" className="sr-only">
            Search glossary terms
          </label>
          <div className="absolute inset-y-0 start-0 flex items-center ps-3 pointer-events-none text-on-surface-variant">
            <Icon name="search" className="text-[18px]" />
          </div>
          <input
            id="glossary-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search terms, concepts, or aliases (e.g. slippage, trustline, void)…"
            className="w-full ps-10 pe-4 py-2.5 rounded-lg border border-outline-variant bg-surface text-on-surface placeholder:text-outline text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search query"
              className="absolute inset-y-0 end-0 flex items-center pe-3 text-on-surface-variant hover:text-on-surface"
            >
              <Icon name="close" className="text-[16px]" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by category">
          {(["all", "market", "stellar", "protocol"] as const).map((cat) => {
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition ${
                  isSelected
                    ? "bg-primary text-on-primary shadow-sm"
                    : "border border-outline-variant bg-surface text-on-surface-variant hover:bg-surface-container"
                }`}
              >
                {cat === "all" ? "All Categories" : cat}
              </button>
            );
          })}
        </div>
      </section>

      {/* Screen-reader Live Region */}
      <LiveRegion message={liveMessage} />

      {/* Results Count Banner */}
      <div className="mb-6 flex items-center justify-between text-xs text-on-surface-variant border-b border-outline-variant pb-2">
        <span>{results.length} of {ALL_GLOSSARY_TERMS.length} terms displayed</span>
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSelectedCategory("all");
            }}
            className="text-primary hover:underline"
          >
            Reset filters
          </button>
        )}
      </div>

      {/* Terms List */}
      {results.length === 0 ? (
        <div className="py-12 text-center text-on-surface-variant">
          <p className="font-semibold text-base mb-1">No matching terms found</p>
          <p className="text-sm">Try searching with a different term, alias, or select another category.</p>
        </div>
      ) : (
        <section aria-label="Glossary definitions" className="space-y-6">
          {results.map((item) => (
            <article
              key={item.id}
              id={item.id}
              className="scroll-mt-20 p-5 rounded-xl border border-outline-variant bg-surface hover:border-outline transition-colors"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <h2 className="font-headline-sm text-lg font-bold text-on-surface">
                    <a href={`#${item.id}`} className="hover:underline flex items-center gap-1.5 group">
                      <span>{item.term}</span>
                      <Icon name="link" className="text-[14px] text-outline opacity-0 group-hover:opacity-100 transition-opacity" />
                    </a>
                  </h2>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  item.category === "market"
                    ? "bg-secondary-container text-on-secondary-container"
                    : item.category === "stellar"
                      ? "bg-primary-container text-on-primary-container"
                      : "bg-surface-container-highest text-on-surface"
                }`}>
                  {item.category}
                </span>
              </div>

              {item.aliases && item.aliases.length > 0 && (
                <div className="mb-2 text-xs text-on-surface-variant font-data-mono">
                  Also known as: {item.aliases.join(", ")}
                </div>
              )}

              <p className="text-sm font-medium text-on-surface mb-2 leading-relaxed">
                {item.short}
              </p>

              <div className="text-sm text-on-surface-variant leading-relaxed mb-4">
                {item.long}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-outline-variant/60 text-xs">
                {item.seeAlso && item.seeAlso.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-outline font-medium">See also:</span>
                    {item.seeAlso.map((relatedId) => (
                      <a
                        key={relatedId}
                        href={`#${relatedId}`}
                        className="rounded bg-surface-container px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-surface-container-high transition"
                      >
                        {relatedId}
                      </a>
                    ))}
                  </div>
                ) : <div />}

                {item.source && (
                  <span className="font-data-mono text-[11px] text-outline">
                    Source: {item.source}
                  </span>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
