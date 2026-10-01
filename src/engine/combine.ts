import type { BenefitsReport } from "./benefits";
import { CATEGORIES, type Category } from "./categories";
import { toCents } from "./money";

/** The parts of a card's BenefitsReport that the combined summary reads. */
export type CombinableReport = Pick<
  BenefitsReport,
  "card_id" | "rewards_value" | "net_value" | "credits_total" | "net_value_excludes" | "unverified"
> & {
  categories: readonly Pick<BenefitsReport["categories"][number], "category" | "value">[];
  fees: Pick<BenefitsReport["fees"], "annual_fee_prorated">;
  fx: Pick<BenefitsReport["fx"], "amount">;
};

export interface CombinedCategory {
  category: Category;
  /** Rewards value per valued card id ($0 when the card has none in this category). */
  by_card: Record<string, number>;
  total: number;
}

export interface CombinedSummary {
  net_value: number;
  /** Rewards value of the valued cards only. */
  rewards_value: number;
  credits_total: number;
  /** Annual fee share + FX fees; unverified (null) parts are left out. */
  fees_total: number;
  /** Cards whose rewards have a verified dollar value, in input order. */
  valued_card_ids: string[];
  /** Cards whose rewards value is unverified; they add nothing to rewards or categories. */
  unvalued_card_ids: string[];
  unverified_count: number;
  /** True when any card's net value leaves out an unverified part. */
  any_excluded: boolean;
  /** Categories where a valued card has a non-zero value, largest total first. */
  categories: CombinedCategory[];
}

/** Sum CAD amounts in integer cents, so the total carries no floating-point drift. */
const sumCad = (amounts: readonly number[]) => amounts.reduce((s, x) => s + toCents(x), 0) / 100;

/**
 * Totals across several cards' reports. Dollars add up across cards; points
 * from different programs don't, so points are never summed here.
 */
export function combineCardSummaries(reports: readonly CombinableReport[]): CombinedSummary {
  const valued = reports.filter((r) => r.rewards_value !== null);

  const categories = CATEGORIES.map((category): CombinedCategory => {
    const by_card: Record<string, number> = {};
    for (const r of valued) by_card[r.card_id] = r.categories.find((c) => c.category === category)?.value ?? 0;
    return { category, by_card, total: sumCad(Object.values(by_card)) };
  })
    .filter((c) => Object.values(c.by_card).some((v) => v !== 0))
    // Array.prototype.sort is stable, so ties keep CATEGORIES order.
    .sort((a, b) => b.total - a.total);

  return {
    net_value: sumCad(reports.map((r) => r.net_value)),
    rewards_value: sumCad(valued.map((r) => r.rewards_value ?? 0)),
    credits_total: sumCad(reports.map((r) => r.credits_total)),
    fees_total: sumCad(reports.flatMap((r) => [r.fees.annual_fee_prorated ?? 0, r.fx.amount ?? 0])),
    valued_card_ids: valued.map((r) => r.card_id),
    unvalued_card_ids: reports.filter((r) => r.rewards_value === null).map((r) => r.card_id),
    unverified_count: reports.reduce((s, r) => s + r.unverified.reduce((a, u) => a + u.count, 0), 0),
    any_excluded: reports.some((r) => r.net_value_excludes.length > 0),
    categories,
  };
}
