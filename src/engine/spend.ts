import { CATEGORIES, type Category } from "./categories";
import type { CategorizedTransaction } from "./categorize";
import { toCents } from "./money";
import type { CAD } from "./types";

export interface StatementSummary {
  /**
   * DISPLAY ONLY. Net spend per category, floored at 0 so the summary never
   * shows negative spending. Never use it for points or value maths; use
   * net_by_category (see docs/decisions.md).
   */
  spend_by_category: Record<Category, CAD>;
  /** Raw signed net per category (purchases minus refunds). May be negative. */
  net_by_category: Record<Category, CAD>;
  /** Categories where refunds exceeded purchases (e.g. a refund for last month's purchase). */
  over_refunded: Category[];
  purchases: CAD;
  /** Total refunded, as a positive number. */
  refunds: CAD;
  /** Net foreign-currency purchases (purchases minus refunds). */
  foreign_spend: CAD;
  /** Kept for the benefits report; not category spend. Net of reversals. */
  fees: CAD;
  interest: CAD;
  /** Payments and reward credits, as a positive number. Not spend. */
  payments: CAD;
}

// Sum in integer cents so totals don't drift.
const cents = toCents;

/** Totals for one card's statement. Refunds reduce their category's spend. */
export function summarizeStatement(items: readonly CategorizedTransaction[]): StatementSummary {
  const byCat = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  let purchases = 0, refunds = 0, foreign = 0, fees = 0, interest = 0, payments = 0;

  for (const { transaction: t, category } of items) {
    const c = cents(t.amount_cad);
    switch (t.kind) {
      case "purchase":
      case "refund":
        if (category) byCat[category] += c;
        if (t.kind === "purchase") purchases += c;
        else refunds += -c;
        if (t.is_foreign) foreign += c;
        break;
      case "fee":
        fees += c;
        break;
      case "interest":
        interest += c;
        break;
      case "payment":
        payments += -c;
        break;
    }
  }

  const over_refunded = CATEGORIES.filter((c) => byCat[c] < 0);
  const spend_by_category = Object.fromEntries(
    CATEGORIES.map((c) => [c, Math.max(0, byCat[c]) / 100]),
  ) as Record<Category, CAD>;
  const net_by_category = Object.fromEntries(
    CATEGORIES.map((c) => [c, byCat[c] / 100]),
  ) as Record<Category, CAD>;
  return {
    spend_by_category,
    net_by_category,
    over_refunded,
    purchases: purchases / 100,
    refunds: refunds / 100,
    foreign_spend: foreign / 100,
    fees: fees / 100,
    interest: interest / 100,
    payments: payments / 100,
  };
}
