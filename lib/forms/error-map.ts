import { describeError } from "@/lib/stellar/errors";
import { ApiError } from "@/lib/api/client";

export type FieldTarget<K extends string> = { field: K } | { form: true };

/**
 * Maps contract, wallet, network, and API errors to targeted field-level errors
 * or form-level errors.
 *
 * Evaluation precedence:
 * 1. Contract error name or code (e.g. "SlippageExceeded", "MarketClosed")
 * 2. DescribedErrorKind (e.g. "insufficient-balance", "no-trustline")
 * 3. ApiError.code (e.g. "TRACE_LOCKED", "IDEMPOTENCY_KEY_REQUIRED")
 * 4. Fallback to form-level target: { form: true }
 *
 * Messages are preserved from describeError for consistent user-facing wording.
 */
export function mapErrorToField<K extends string>(
  err: unknown,
  map: Partial<Record<string, K>>
): { target: FieldTarget<K>; message: string } {
  const described = describeError(err);

  // 1. Check specific contract error name / code
  if (described.code && map[described.code]) {
    const field = map[described.code]!;
    return {
      target: { field },
      message: described.message,
    };
  }

  // 2. Check DescribedErrorKind
  if (described.kind && map[described.kind]) {
    const field = map[described.kind]!;
    return {
      target: { field },
      message: described.message,
    };
  }

  // 3. Check ApiError code
  let apiCode: string | undefined;
  if (err instanceof ApiError) {
    apiCode = err.code;
  } else if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string"
  ) {
    apiCode = (err as { code: string }).code;
  }

  if (apiCode && map[apiCode]) {
    const field = map[apiCode]!;
    return {
      target: { field },
      message: described.message,
    };
  }

  // 4. Default to form-level error
  return {
    target: { form: true },
    message: described.message,
  };
}
