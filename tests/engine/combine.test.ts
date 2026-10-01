import { describe, expect, it } from "vitest";
import { combineCardSummaries, computeBenefits, type Category, type CombinableReport } from "@/engine";
import { fixtureCard, program } from "../helpers/cards";
import { categorizedStatement } from "../helpers/statements";

/** A FAKE report with only the fields the combined summary reads. */
function report(
  card_id: string,
  over: {
    rewards_value?: number | null;
    net_value?: number;
    credits_total?: number;
    annual_fee_prorated?: number | null;
    fx?: number | null;
    categories?: [Category, number | null][];
    excludes?: string[];
    unverified?: number[];
  } = {},
): CombinableReport {
  return {
    card_id,
    rewards_value: over.rewards_value === undefined ? 0 : over.rewards_value,
    net_value: over.net_value ?? 0,
    credits_total: over.credits_total ?? 0,
    fees: { annual_fee_prorated: over.annual_fee_prorated === undefined ? 0 : over.annual_fee_prorated },
    fx: { amount: over.fx === undefined ? 0 : over.fx },
    categories: (over.categories ?? []).map(([category, value]) => ({ category, value })),
    net_value_excludes: over.excludes ?? [],
    unverified: (over.unverified ?? []).map((count) => ({ kind: "earn_rate", label: "FAKE", count, amount: null })),
  };
}

describe("combineCardSummaries", () => {
  it("is all zeros and empty for no cards", () => {
    expect(combineCardSummaries([])).toEqual({
      net_value: 0,
      rewards_value: 0,
      credits_total: 0,
      fees_total: 0,
      valued_card_ids: [],
      unvalued_card_ids: [],
      unverified_count: 0,
      any_excluded: false,
      categories: [],
    });
  });

  it("adds net value, rewards, credits and fees across cards", () => {
    const s = combineCardSummaries([
      report("fake-a", { net_value: 41.5, rewards_value: 32, credits_total: 20, annual_fee_prorated: 10, fx: 0.5 }),
      report("fake-b", { net_value: -3.25, rewards_value: 6.75, credits_total: 0, annual_fee_prorated: 10, fx: 0 }),
    ]);
    expect(s).toMatchObject({ net_value: 38.25, rewards_value: 38.75, credits_total: 20, fees_total: 20.5 });
    expect(s.valued_card_ids).toEqual(["fake-a", "fake-b"]);
  });

  it("sums in cents, so there is no floating-point drift", () => {
    // Naive addition gives 0.1 + 0.2 = 0.30000000000000004 and 1.1 + 2.2 = 3.3000000000000003.
    expect(0.1 + 0.2).not.toBe(0.3);
    const two = combineCardSummaries([
      report("fake-a", { net_value: 0.1, rewards_value: 1.1, credits_total: 0.1, annual_fee_prorated: 0.1, fx: 0.1, categories: [["dining", 0.1]] }),
      report("fake-b", { net_value: 0.2, rewards_value: 2.2, credits_total: 0.2, annual_fee_prorated: 0.1, fx: 0, categories: [["dining", 0.2]] }),
    ]);
    expect(two.net_value).toBe(0.3);
    expect(two.rewards_value).toBe(3.3);
    expect(two.credits_total).toBe(0.3);
    expect(two.fees_total).toBe(0.3);
    expect(two.categories[0].total).toBe(0.3);

    // Ten cards at $0.10: naive addition gives 0.9999999999999999.
    const ten = Array.from({ length: 10 }, (_, i) => report(`fake-${i}`, { net_value: 0.1, rewards_value: 0.1, categories: [["gas", 0.1]] }));
    expect(ten.reduce((s, r) => s + r.net_value, 0)).not.toBe(1);
    const s = combineCardSummaries(ten);
    expect(s.net_value).toBe(1);
    expect(s.rewards_value).toBe(1);
    expect(s.categories[0].total).toBe(1);
  });

  it("leaves unverified parts out: null rewards, fee and FX add nothing", () => {
    const s = combineCardSummaries([
      report("fake-a", { rewards_value: 12, net_value: 12, categories: [["groceries", 12]] }),
      report("fake-b", {
        rewards_value: null, net_value: 5, credits_total: 5, annual_fee_prorated: null, fx: null,
        categories: [["groceries", null]], excludes: ["rewards"], unverified: [2, 1],
      }),
    ]);
    expect(s.rewards_value).toBe(12);
    expect(s.net_value).toBe(17);
    expect(s.fees_total).toBe(0);
    expect(s.valued_card_ids).toEqual(["fake-a"]);
    expect(s.unvalued_card_ids).toEqual(["fake-b"]);
    expect(s.unverified_count).toBe(3);
    expect(s.any_excluded).toBe(true);
    // The unvalued card has no column in the category rows.
    expect(s.categories).toEqual([{ category: "groceries", by_card: { "fake-a": 12 }, total: 12 }]);
  });

  it("lists categories with a non-zero value, largest total first, $0 for a card without that category", () => {
    const s = combineCardSummaries([
      report("fake-a", { categories: [["groceries", 5], ["dining", 9], ["gas", 0]] }),
      report("fake-b", { categories: [["groceries", 7.5], ["travel", 3]] }),
    ]);
    expect(s.categories).toEqual([
      { category: "groceries", by_card: { "fake-a": 5, "fake-b": 7.5 }, total: 12.5 },
      { category: "dining", by_card: { "fake-a": 9, "fake-b": 0 }, total: 9 },
      { category: "travel", by_card: { "fake-a": 0, "fake-b": 3 }, total: 3 },
    ]);
  });

  it("keeps a category whose values cancel out (refunds), and keeps CATEGORIES order on ties", () => {
    const s = combineCardSummaries([
      report("fake-a", { categories: [["travel", 4], ["dining", 4], ["gas", 2]] }),
      report("fake-b", { categories: [["gas", -2]] }),
    ]);
    expect(s.categories.map((c) => [c.category, c.total])).toEqual([["dining", 4], ["travel", 4], ["gas", 0]]);
  });

  it("accepts real BenefitsReports: one card combines to its own figures", () => {
    const card = fixtureCard("fake-shared-cap");
    const r = computeBenefits({ card, program: program("cash-cad"), items: categorizedStatement("fake-shared-cap-2026-01.csv") });
    const s = combineCardSummaries([r]);
    expect(s.net_value).toBe(r.net_value);
    expect(s.rewards_value).toBe(r.rewards_value);
    expect(s.credits_total).toBe(r.credits_total);
    expect(s.valued_card_ids).toEqual([card.id]);
    expect(s.categories.map((c) => [c.category, c.by_card[card.id]])).toEqual(
      r.categories.filter((c) => c.value).map((c) => [c.category, c.value]).sort((a, b) => (b[1] as number) - (a[1] as number)),
    );
  });
});
