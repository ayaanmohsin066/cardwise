import { z } from "zod";
import { formatIssues, genericError, isoDate, nonEmptyString } from "./schema-utils";

export const TRANSACTION_KINDS = ["purchase", "refund", "payment", "fee", "interest"] as const;
export const CONFIDENCES = ["high", "low"] as const;

/**
 * One statement line, normalized. Produced by ingest in the browser only.
 *
 * Sign convention: `amount_cad` is positive for money charged to the card
 * (purchases, fees, interest) and negative for credits (refunds, payments).
 * A refund is a negative purchase: it reduces category spend and points.
 */
export const transactionSchema = z.strictObject({
  id: nonEmptyString,
  /** 1-based position in the uploaded statement. Breaks same-date ties in posting order. */
  statement_line: z.number().int().positive(),
  date: isoDate,
  description: z.string(),
  amount_cad: z.number().finite(),
  kind: z.enum(TRANSACTION_KINDS),
  is_foreign: z.boolean(),
  /** "high" when read from a currency/FX column, "low" when guessed from the description. */
  is_foreign_confidence: z.enum(CONFIDENCES),
  /** The original CSV row, column name -> cell text. */
  raw: z.record(z.string(), z.string()),
});

export type Transaction = z.infer<typeof transactionSchema>;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];
export type Confidence = (typeof CONFIDENCES)[number];

export type TransactionValidationResult =
  | { ok: true; transaction: Transaction }
  | { ok: false; errors: string[] };

/** Validate raw JSON (e.g. a test fixture) against the Transaction schema. */
export function validateTransaction(raw: unknown): TransactionValidationResult {
  const r = transactionSchema.safeParse(raw, { error: genericError });
  return r.success
    ? { ok: true, transaction: r.data }
    : { ok: false, errors: formatIssues(raw, r.error.issues, "transaction") };
}
