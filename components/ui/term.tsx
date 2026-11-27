"use client";

import React, { createContext, useContext, useState } from "react";
import Link from "next/link";
import { Popover as P } from "radix-ui";
import { getTerm, type TermId } from "@/lib/glossary/terms";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/** Context to indicate when rendering inside a button/interactive element to avoid invalid nested buttons. */
export const InInteractiveContext = createContext<boolean>(false);

export interface TermProps {
  id: TermId;
  children?: React.ReactNode;
  className?: string;
  showIcon?: boolean;
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  market: { label: "Market", color: "bg-secondary-container text-on-secondary-container" },
  stellar: { label: "Stellar", color: "bg-primary-container text-on-primary-container" },
  protocol: { label: "Protocol", color: "bg-surface-container-highest text-on-surface" },
};

export function Term({ id, children, className, showIcon = false }: TermProps) {
  const [open, setOpen] = useState(false);
  const isInsideInteractive = useContext(InInteractiveContext);
  const term = getTerm(id);

  if (!term) {
    return <span className={className}>{children}</span>;
  }

  const displayText = children ?? term.term;

  // Fallback when nested inside another interactive control (e.g. <button>) to prevent HTML validation violations
  if (isInsideInteractive) {
    return (
      <span
        title={`${term.term}: ${term.short}`}
        aria-label={`${term.term}: ${term.short}`}
        className={cn(
          "inline-flex items-center text-inherit font-inherit underline decoration-dotted decoration-outline-variant underline-offset-2 cursor-help",
          className,
        )}
      >
        {displayText}
      </span>
    );
  }

  const cat = CATEGORY_LABELS[term.category] ?? { label: term.category, color: "bg-surface-variant text-on-surface-variant" };

  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Trigger asChild>
        <button
          type="button"
          aria-label={`Glossary definition for ${term.term}`}
          aria-expanded={open}
          className={cn(
            "inline-flex items-center text-inherit font-inherit underline decoration-dotted decoration-outline-variant underline-offset-2 hover:decoration-primary cursor-help transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-sm",
            className,
          )}
        >
          <span>{displayText}</span>
          {showIcon && <Icon name="help_outline" className="ms-1 text-[12px] opacity-70" />}
        </button>
      </P.Trigger>
      <P.Portal>
        <P.Content
          side="top"
          align="center"
          sideOffset={6}
          className="z-50 w-72 rounded-lg border border-outline-variant bg-surface p-3.5 shadow-xl animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 duration-150 focus:outline-none"
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="font-semibold text-sm text-on-surface">{term.term}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold uppercase", cat.color)}>
              {cat.label}
            </span>
          </div>
          <p className="text-xs text-on-surface-variant leading-relaxed mb-3">
            {term.short}
          </p>
          <div className="flex items-center justify-between border-t border-outline-variant/60 pt-2 text-[11px]">
            <Link
              href={`/help/glossary#${term.id}`}
              onClick={() => setOpen(false)}
              className="font-medium text-primary hover:underline flex items-center gap-1"
            >
              <span>Full explanation</span>
              <Icon name="arrow_forward" className="text-[12px]" />
            </Link>
            <P.Close
              aria-label="Close glossary definition"
              className="text-on-surface-variant hover:text-on-surface p-0.5 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <Icon name="close" className="text-[14px]" />
            </P.Close>
          </div>
          <P.Arrow className="fill-surface stroke-outline-variant stroke-1" />
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
