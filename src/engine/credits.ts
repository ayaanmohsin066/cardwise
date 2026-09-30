/**
 * Issuer statement credits (e.g. an annual travel credit posted as its own
 * line). Without this, such a line would be read as a refund: it would reduce
 * category spend and points and ALSO count as credit used (double counting).
 */
import type { Card, PurchaseCredit } from "./card-schema";
import { containsPhrase } from "./text";
import type { Transaction } from "./transaction-schema";

/** The purchase credit a statement line posts, by its statement_keywords, or null. */
export function matchStatementCredit(card: Card, description: string): PurchaseCredit | null {
  return (
    card.purchase_credits?.find((c) => c.statement_keywords?.some((k) => containsPhrase(description, k))) ?? null
  );
}

/**
 * Reclassify credit-side lines (negative refunds or payments) that match one
 * of the card's purchase credits as kind "credit". Other lines are returned
 * unchanged. Credits whose statement_keywords are unverified (null) can't be
 * recognised and are left alone.
 */
export function classifyStatementCredits(card: Card, transactions: readonly Transaction[]): Transaction[] {
  return transactions.map((t) =>
    t.amount_cad < 0 && (t.kind === "refund" || t.kind === "payment") && matchStatementCredit(card, t.description)
      ? { ...t, kind: "credit" }
      : t,
  );
}
