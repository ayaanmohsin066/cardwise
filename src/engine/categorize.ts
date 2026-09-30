import type { Category } from "./categories";
import type { MerchantRules } from "./merchant-rules-schema";
import { overrideKey, type Overrides } from "./overrides";
import { containsPhrase, normalizeText } from "./text";
import type { Confidence, Transaction } from "./transaction-schema";

export type CategorySource = "override" | "rule" | "unmatched" | "excluded";

export interface CategorizedTransaction {
  transaction: Transaction;
  /** null for payments, fees and interest, which are not category spend. */
  category: Category | null;
  confidence: Confidence;
  source: CategorySource;
  /** The rule and keyword that decided the category, when source is "rule". */
  rule_id: string | null;
  keyword: string | null;
}

/** Kinds that count toward category spend. Refunds reduce it. */
export const SPEND_KINDS = new Set<Transaction["kind"]>(["purchase", "refund"]);

/**
 * Categorize one transaction.
 *
 * 1. Payments, fees and interest: no category ("excluded").
 * 2. A user override for this merchant wins (high confidence).
 * 3. Otherwise merchant_rules keywords, matched case-insensitively on word
 *    boundaries. The longest matching keyword wins (so "uber eats" beats
 *    "uber"); ties go to the earlier rule. Confidence is low when another
 *    category's keyword also matched, unless that keyword is just part of the
 *    winning one ("uber" inside "uber eats" is not a real conflict).
 * 4. No match: "other", low confidence.
 */
export function categorize(
  transaction: Transaction,
  rules: MerchantRules,
  overrides: Overrides = {},
): CategorizedTransaction {
  const base = { transaction, rule_id: null, keyword: null };
  if (!SPEND_KINDS.has(transaction.kind)) {
    return { ...base, category: null, confidence: "high", source: "excluded" };
  }

  const override = overrides[overrideKey(transaction.description)];
  if (override) return { ...base, category: override, confidence: "high", source: "override" };

  const matches = rules.rules.flatMap((rule, order) =>
    rule.keywords
      .filter((k) => containsPhrase(transaction.description, k))
      .map((keyword) => ({ rule, keyword, order, length: normalizeText(keyword).length })),
  );
  if (matches.length === 0) {
    return { ...base, category: "other", confidence: "low", source: "unmatched" };
  }
  const best = matches.reduce((a, b) =>
    b.length > a.length || (b.length === a.length && b.order < a.order) ? b : a,
  );
  const conflict = matches.some(
    (m) => m.rule.category !== best.rule.category && !containsPhrase(best.keyword, m.keyword),
  );
  return {
    transaction,
    category: best.rule.category,
    confidence: conflict ? "low" : "high",
    source: "rule",
    rule_id: best.rule.id,
    keyword: best.keyword,
  };
}

export function categorizeAll(
  transactions: readonly Transaction[],
  rules: MerchantRules,
  overrides: Overrides = {},
): CategorizedTransaction[] {
  return transactions.map((t) => categorize(t, rules, overrides));
}
