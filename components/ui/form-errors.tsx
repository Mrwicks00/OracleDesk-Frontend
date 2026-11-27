"use client";

import React, { useCallback, useId, useMemo, useRef, useState } from "react";
import { LiveRegion } from "@/components/ui/live-region";
import { cn } from "@/lib/utils";

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export interface UseFormErrorsOptions {
  idPrefix?: string;
}

export function useFormErrors<K extends string>(
  fields: readonly K[],
  opts?: UseFormErrorsOptions
): {
  ids: Record<K, { input: string; error: string; hint: string }>;
  errors: FieldErrors<K>;
  formError: string | null;
  touched: Record<K, boolean>;
  submitted: boolean;
  setErrors(e: FieldErrors<K>, formError?: string | null): void;
  setFormError(e: string | null): void;
  setTouched(field: K, isTouched?: boolean): void;
  handleBlur(field: K): void;
  clearErrors(): void;
  attemptSubmit(validate: () => FieldErrors<K>): boolean;
  summaryRef: React.RefObject<HTMLDivElement | null>;
  fieldProps(
    k: K,
    hint?: boolean
  ): {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
    onBlur: () => void;
  };
  statusMessage: string | null;
  announceSettled(key: string, message: string | null | undefined): void;
  clearStatus(): void;
} {
  const generatedId = useId();
  const idPrefix = opts?.idPrefix ?? `form-${generatedId.replace(/:/g, "")}`;

  const ids = useMemo(() => {
    const res = {} as Record<K, { input: string; error: string; hint: string }>;
    for (const f of fields) {
      res[f] = {
        input: `${idPrefix}-${f}`,
        error: `${idPrefix}-${f}-error`,
        hint: `${idPrefix}-${f}-hint`,
      };
    }
    return res;
  }, [fields, idPrefix]);

  const [errors, setErrorsState] = useState<FieldErrors<K>>({});
  const [formError, setFormErrorState] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouchedState] = useState<Record<K, boolean>>(() => {
    const initial = {} as Record<K, boolean>;
    for (const f of fields) {
      initial[f] = false;
    }
    return initial;
  });

  const summaryRef = useRef<HTMLDivElement | null>(null);

  // Async settled announcement tracking
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const lastSettledRef = useRef<Map<string, string>>(new Map());

  const announceSettled = useCallback((key: string, message: string | null | undefined) => {
    if (!message) return;
    const last = lastSettledRef.current.get(key);
    if (last !== message) {
      lastSettledRef.current.set(key, message);
      setStatusMessage(message);
    }
  }, []);

  const clearStatus = useCallback(() => {
    setStatusMessage(null);
  }, []);

  const setErrors = useCallback((e: FieldErrors<K>, formErr?: string | null) => {
    setErrorsState(e);
    if (formErr !== undefined) {
      setFormErrorState(formErr);
    }
  }, []);

  const setFormError = useCallback((err: string | null) => {
    setFormErrorState(err);
  }, []);

  const setTouched = useCallback((field: K, isTouched: boolean = true) => {
    setTouchedState((prev) => ({ ...prev, [field]: isTouched }));
  }, []);

  const handleBlur = useCallback(
    (field: K) => () => {
      setTouchedState((prev) => ({ ...prev, [field]: true }));
    },
    []
  );

  const clearErrors = useCallback(() => {
    setErrorsState({});
    setFormErrorState(null);
    setSubmitted(false);
    setTouchedState(() => {
      const reset = {} as Record<K, boolean>;
      for (const f of fields) {
        reset[f] = false;
      }
      return reset;
    });
  }, [fields]);

  const attemptSubmit = useCallback(
    (validate: () => FieldErrors<K>): boolean => {
      const validationErrors = validate();
      const hasFieldErrors = Object.keys(validationErrors).some((k) => Boolean(validationErrors[k as K]));
      setErrorsState(validationErrors);
      setSubmitted(true);

      // Mark all fields as touched
      setTouchedState(() => {
        const allTouched = {} as Record<K, boolean>;
        for (const f of fields) {
          allTouched[f] = true;
        }
        return allTouched;
      });

      if (hasFieldErrors || formError) {
        // Focus summary
        if (typeof window !== "undefined") {
          window.requestAnimationFrame(() => {
            summaryRef.current?.focus();
          });
        }
        return false;
      }

      return true;
    },
    [fields, formError]
  );

  const fieldProps = useCallback(
    (k: K, hint?: boolean) => {
      const fieldId = ids[k];
      const hasError = Boolean((submitted || touched[k]) && errors[k]);
      const describedParts: string[] = [];
      if (hint) {
        describedParts.push(fieldId.hint);
      }
      // Always include error container in aria-describedby so screen readers bind to an existing element
      describedParts.push(fieldId.error);

      return {
        id: fieldId.input,
        "aria-invalid": hasError,
        "aria-describedby": describedParts.join(" "),
        onBlur: () => handleBlur(k),
      };
    },
    [ids, errors, submitted, touched, handleBlur]
  );

  return {
    ids,
    errors,
    formError,
    touched,
    submitted,
    setErrors,
    setFormError,
    setTouched,
    handleBlur,
    clearErrors,
    attemptSubmit,
    summaryRef,
    fieldProps,
    statusMessage,
    announceSettled,
    clearStatus,
  };
}

export interface ErrorSummaryProps {
  errors: FieldErrors<string>;
  formError?: string | null;
  ids?: Record<string, { input: string }>;
  labels?: Record<string, string>;
  summaryRef: React.Ref<HTMLDivElement>;
  className?: string;
}

export function ErrorSummary({
  errors,
  formError,
  ids,
  labels,
  summaryRef,
  className,
}: ErrorSummaryProps): JSX.Element | null {
  const activeFieldErrors = Object.entries(errors).filter(
    ([, msg]) => typeof msg === "string" && msg.trim().length > 0
  );

  const totalCount = activeFieldErrors.length + (formError ? 1 : 0);
  if (totalCount === 0) return null;

  return (
    <div
      ref={summaryRef}
      role="alert"
      tabIndex={-1}
      aria-labelledby="error-summary-heading"
      className={cn(
        "rounded-lg border border-error/40 bg-error/10 p-4 text-on-surface focus:outline-none focus:ring-2 focus:ring-error",
        className
      )}
    >
      <h3
        id="error-summary-heading"
        className="font-headline-sm text-sm font-bold text-error mb-2"
      >
        {totalCount === 1 ? "There is 1 problem" : `There are ${totalCount} problems`}
      </h3>
      <ul className="list-disc list-inside space-y-1 text-xs text-error">
        {formError && <li>{formError}</li>}
        {activeFieldErrors.map(([field, message]) => {
          const inputId = ids?.[field]?.input ?? field;
          const label = labels?.[field] ?? field;
          return (
            <li key={field}>
              <a
                href={`#${inputId}`}
                onClick={(e) => {
                  e.preventDefault();
                  const target = document.getElementById(inputId);
                  if (target) {
                    target.focus();
                  }
                }}
                className="underline font-medium hover:text-error/80 focus:outline-none focus:ring-1 focus:ring-error rounded"
              >
                {label}: {message}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface FieldErrorProps {
  id: string;
  message?: string;
  className?: string;
}

/**
 * FieldError always renders its container element so aria-describedby
 * targets exist in the DOM, preventing dangling id references for screen readers.
 */
export function FieldError({ id, message, className }: FieldErrorProps): JSX.Element {
  return (
    <div
      id={id}
      aria-live="polite"
      className={cn("min-h-[1.25rem] text-xs text-error transition-opacity", className)}
    >
      {message ?? ""}
    </div>
  );
}

export interface FieldProps {
  children: React.ReactNode;
  className?: string;
}

export function Field({ children, className }: FieldProps): JSX.Element {
  return <div className={cn("space-y-1", className)}>{children}</div>;
}

export interface FormStatusProps {
  status?: string | null;
  message?: string | null;
  className?: string;
}

export function FormStatus({ status, message, className }: FormStatusProps): JSX.Element {
  return <LiveRegion message={status ?? message} politeness="polite" className={className} />;
}
