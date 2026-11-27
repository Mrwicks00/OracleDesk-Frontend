"use client";

import React, { useId } from "react";
import { tryParseUsdc } from "@/lib/stellar/units";
import { FieldError } from "@/components/ui/form-errors";
import { cn } from "@/lib/utils";

export interface UsdcInputProps {
  value: string;
  onValueChange: (raw: bigint | null, text: string) => void;
  label: string;
  error?: string;
  id?: string;
  describedBy?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
  onBlur?: () => void;
}

export function UsdcInput({
  value,
  onValueChange,
  label,
  error,
  id: explicitId,
  describedBy,
  hint,
  disabled = false,
  className,
  onBlur,
}: UsdcInputProps) {
  const generatedId = useId();
  const inputId = explicitId ?? `usdc-input-${generatedId.replace(/:/g, "")}`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  const raw = tryParseUsdc(value);
  const invalid = value.length > 0 && raw === null;
  const isInvalid = Boolean(error || invalid);

  const describedIds = [
    hint ? hintId : undefined,
    describedBy,
    errorId,
  ]
    .filter(Boolean)
    .join(" ");

  const errorMessage =
    error ?? (invalid ? "Enter a USDC amount with up to 7 decimal places." : undefined);

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={inputId} className="block text-xs font-bold text-on-surface-variant">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-xs text-on-surface-variant">
          {hint}
        </p>
      )}
      <input
        id={inputId}
        type="text"
        inputMode="decimal"
        value={value}
        disabled={disabled}
        aria-invalid={isInvalid}
        aria-describedby={describedIds}
        onBlur={onBlur}
        onChange={(event) => onValueChange(tryParseUsdc(event.target.value), event.target.value)}
        className="w-full rounded border border-outline-variant bg-surface-container-low px-3 py-2 font-data-mono outline-none focus:border-primary disabled:opacity-50"
      />
      <FieldError id={errorId} message={errorMessage} />
    </div>
  );
}
