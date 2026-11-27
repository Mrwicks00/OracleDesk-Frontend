"use client";
import { Icon } from "@/components/ui/icon";

import React, { useMemo, useState } from "react";
import { validateTraceContent, type ValidatedTraceContent } from "@/lib/stellar/trace-schema";
import { analyzeTextSafety } from "@/lib/text-safety";
import { SafeText } from "@/components/safe-text";
import { Term } from "@/components/ui/term";

export interface SafeTraceViewerProps {
  content: unknown;
  verified?: boolean;
  ipfsCid?: string | null;
  traceHash?: string | null;
  className?: string;
  title?: string;
}

export function SafeTraceViewer({
  content,
  verified = true,
  ipfsCid,
  traceHash,
  className = "",
  title,
}: SafeTraceViewerProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const validation = useMemo(() => validateTraceContent(content), [content]);

  // Analyze raw content text for bidi/invisible/confusables to qualify verified badge
  const contentString = useMemo(() => {
    return typeof content === "string" ? content : JSON.stringify(content);
  }, [content]);
  const contentSafety = useMemo(() => analyzeTextSafety(contentString), [contentString]);

  const copyJson = () => {
    if (!validation.ok) return;
    navigator.clipboard?.writeText(JSON.stringify(validation.data, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!validation.ok) {
    return (
      <div className={`rounded-xl border border-error/30 bg-error-container/10 p-6 ${className}`}>
        <div className="flex items-center gap-3 text-error mb-2">
          <Icon name="error" />
          <h4 className="font-headline-sm text-headline-sm">Trace Content Schema Error</h4>
        </div>
        <p className="text-body-md text-on-surface-variant mb-4">{validation.error}</p>
        <div className="p-4 bg-surface-container-low rounded-lg font-data-mono text-xs overflow-x-auto text-on-surface">
          {String(content)}
        </div>
      </div>
    );
  }

  const { data, warnings } = validation;
  const hasUnknownFields = Object.keys(data.rawUnknownFields).length > 0;
  const probPercent = data.probabilityEstimate !== undefined ? Math.round(data.probabilityEstimate * 100) : null;
  const edgePercent = data.edge !== undefined ? (data.edge > 0 ? `+${(data.edge * 100).toFixed(1)}%` : `${(data.edge * 100).toFixed(1)}%`) : null;

  return (
    <div className={`rounded-xl border border-outline-variant bg-surface overflow-hidden ${className}`}>
      {/* Header bar */}
      <div className="p-6 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="bg-primary/10 text-primary px-2.5 py-0.5 rounded text-label-caps font-label-caps font-bold">
              SCHEMA v{data.version}
            </span>
            {data.agent && (
              <span className="bg-surface-container text-on-surface px-2.5 py-0.5 rounded text-label-caps font-label-caps font-bold">
                AGENT: <SafeText text={data.agent} />
              </span>
            )}
            {data.action && (
              <span
                className={`px-2.5 py-0.5 rounded text-label-caps font-label-caps font-bold uppercase ${
                  data.action.toUpperCase().includes("BUY") || data.action.toUpperCase().includes("YES")
                    ? "bg-secondary-container text-on-secondary-container"
                    : data.action.toUpperCase().includes("SELL") || data.action.toUpperCase().includes("NO")
                      ? "bg-tertiary-container text-on-tertiary-container"
                      : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                {data.action}
              </span>
            )}
            {verified ? (
              contentSafety.hasBidiOrInvisible ? (
                <span
                  role="alert"
                  title="Verified hash, but trace contains hidden or deceptive characters"
                  className="flex items-center gap-1 text-error text-label-caps font-label-caps font-bold bg-error/10 px-2 py-0.5 rounded border border-error/30"
                >
                  <Icon name="warning" className="text-[16px]" />
                  Verified, but contains hidden or deceptive characters
                </span>
              ) : contentSafety.hasConfusables ? (
                <span
                  title="Verified hash, but trace contains mixed-script look-alike characters"
                  className="flex items-center gap-1 text-amber-600 text-label-caps font-label-caps font-bold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-600/30"
                >
                  <Icon name="verified" filled className="text-[16px]" />
                  Verified (confusable warning)
                </span>
              ) : (
                <span className="flex items-center gap-1 text-secondary text-label-caps font-label-caps font-bold">
                  <Icon name="verified" filled className="text-[16px]" />
                  Verified Content
                </span>
              )
            ) : (
              <span className="flex items-center gap-1 text-on-surface-variant text-label-caps font-label-caps">
                <Icon name="search" className="text-[16px]" />
                Preview Content
              </span>
            )}
          </div>
          <h3 className="font-headline-sm text-headline-sm text-on-surface">
            {title ? <SafeText text={title} /> : data.decisionType || "Agent Decision Reasoning"}
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {ipfsCid && (
            <span
              className="font-data-mono text-xs text-on-surface-variant bg-surface-container px-2 py-1 rounded"
              title={`IPFS CID: ${ipfsCid}`}
            >
              <Term id="trace-cid">CID</Term>: {ipfsCid.slice(0, 8)}…{ipfsCid.slice(-6)}
            </span>
          )}
          {traceHash && (
            <span
              className="font-data-mono text-xs text-on-surface-variant bg-surface-container px-2 py-1 rounded"
              title={`Trace Hash: ${traceHash}`}
            >
              <Term id="trace-hash">Hash</Term>: {traceHash.slice(0, 8)}…{traceHash.slice(-6)}
            </span>
          )}
          <button
            type="button"
            onClick={copyJson}
            className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded transition-colors text-xs flex items-center gap-1"
            title="Copy sanitized JSON payload"
          >
            <Icon name={copied ? "check" : "content_copy"} className="text-base" />
            <span className="hidden sm:inline">{copied ? "Copied" : "JSON"}</span>
          </button>
        </div>
      </div>

      {/* Warnings & Sanitization Notices */}
      {warnings.length > 0 && (
        <div className="bg-surface-container-high/60 border-b border-outline-variant p-4 text-xs text-on-surface-variant flex items-start gap-2">
          <Icon name="warning" className="text-base text-amber-500 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-bold">Sanitization Notices: </span>
            {warnings.join("; ")}
          </div>
        </div>
      )}

      {/* Metric Tiles: Probability, Edge, Confidence */}
      {(probPercent !== null || edgePercent !== null || data.confidence !== undefined || data.betSizeUsdc !== undefined) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-6 border-b border-outline-variant bg-surface-container-lowest">
          {probPercent !== null && (
            <div>
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-1">PROBABILITY</p>
              <p className="font-data-mono text-headline-md text-primary font-bold">{probPercent}%</p>
              <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden mt-1.5">
                <div className="h-full bg-primary" style={{ width: `${probPercent}%` }}></div>
              </div>
            </div>
          )}

          {edgePercent !== null && (
            <div>
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-1">EDGE</p>
              <p className="font-data-mono text-headline-md text-secondary font-bold">{edgePercent}</p>
              {data.confidenceInterval && (
                <p className="text-[10px] text-on-surface-variant font-data-mono mt-1">
                  CI: {Math.round(data.confidenceInterval.lower * 100)}% - {Math.round(data.confidenceInterval.upper * 100)}%
                </p>
              )}
            </div>
          )}

          {data.confidence !== undefined && (
            <div>
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-1">CONFIDENCE</p>
              <p className="font-data-mono text-headline-md text-on-surface font-bold">
                {Math.round(data.confidence * 100)}%
              </p>
            </div>
          )}

          {data.betSizeUsdc !== undefined && (
            <div>
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-1">BET SIZE</p>
              <p className="font-data-mono text-headline-md text-on-surface font-bold">
                ${data.betSizeUsdc.toLocaleString()} USDC
              </p>
              {data.betFraction !== undefined && (
                <p className="text-[10px] text-on-surface-variant font-data-mono mt-1">
                  Fraction: {(data.betFraction * 100).toFixed(1)}%
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Reasoning Body */}
      {data.reasoning && (
        <div className="p-6 border-b border-outline-variant">
          <h4 className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-3 flex items-center gap-2">
            <Icon name="psychology" className="text-base" />
            Reasoning & Analysis
          </h4>
          <div className="space-y-3 font-body-md text-on-surface leading-relaxed whitespace-pre-wrap break-words bg-surface-container-low/50 p-4 rounded-lg border border-outline-variant/50">
            <SafeText text={data.reasoning} as="div" />
          </div>
        </div>
      )}

      {/* Sources Used */}
      {data.sources.length > 0 && (
        <div className="p-6 border-b border-outline-variant">
          <h4 className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-4 flex items-center gap-2">
            <Icon name="balance" className="text-base" />
            Sources & Weighting ({data.sources.length})
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.sources.map((source, i) => (
              <div
                key={`${source.name}-${i}`}
                className="p-4 bg-surface-container-low rounded-lg border border-outline-variant flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-body-md font-semibold text-on-surface truncate pe-2">
                      {source.name}
                    </span>
                    <span className="font-data-mono text-xs font-bold text-primary">
                      {Math.round(source.weight * 100)}%
                    </span>
                  </div>
                  <div className="w-full h-1 bg-surface-container-highest rounded-full overflow-hidden mb-3">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${Math.round(source.weight * 100)}%` }}
                    ></div>
                  </div>
                  {source.signal && (
                    <div className="text-xs text-on-surface-variant italic leading-relaxed break-words line-clamp-4">
                      &quot;<SafeText text={source.signal} />&quot;
                    </div>
                  )}
                </div>

                {source.url && (
                  <div className="mt-3 pt-2 border-t border-outline-variant/30 flex justify-end">
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-primary hover:underline flex items-center gap-1 font-label-caps"
                    >
                      <span>External Source</span>
                      <Icon name="open_in_new" className="text-[13px]" />
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Conditions / Hedge Requirements */}
      {data.conditions && data.conditions.length > 0 && (
        <div className="p-6 border-b border-outline-variant">
          <h4 className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-3 flex items-center gap-2">
            <Icon name="verified_user" className="text-base" />
            Hedge & Execution Conditions
          </h4>
          <ul className="space-y-2">
            {data.conditions.map((cond, i) => (
              <li
                key={i}
                className="text-xs text-on-surface bg-surface-container-low p-2.5 rounded border border-outline-variant/60 flex items-start gap-2"
              >
                <Icon name="check_circle" className="text-secondary text-sm shrink-0 mt-0.5" />
                <span className="break-words">
                  <SafeText text={cond} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Inert / Additional Fields Accordion */}
      {hasUnknownFields && (
        <div className="p-6 bg-surface-container-lowest border-t border-outline-variant">
          <button
            type="button"
            onClick={() => setShowRaw(!showRaw)}
            className="w-full flex items-center justify-between text-start font-label-caps text-xs text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <span>ADDITIONAL RAW FIELDS ({Object.keys(data.rawUnknownFields).length})</span>
            <Icon name={showRaw ? "expand_less" : "expand_more"} className="text-sm" />
          </button>
          {showRaw && (
            <div className="mt-3 p-4 bg-surface-container-low rounded-lg font-data-mono text-xs overflow-x-auto text-on-surface">
              <pre>{JSON.stringify(data.rawUnknownFields, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
