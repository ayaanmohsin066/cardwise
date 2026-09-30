import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  categorizeAll,
  chooseRedemption,
  classifyStatementCredits,
  computeBenefits,
  validateMerchantRules,
  validateTransaction,
  welcomeBonusProgress,
  type Card,
} from "@/engine";
import { fixtureCard, item, program } from "../helpers/cards";
import { DATA_DIR, FIXTURES_DIR, loadJson } from "../helpers/data-files";

const grocery = fixtureCard("fake-grocery-cash");
const shared = fixtureCard("fake-shared-cap");
const pointsCard = fixtureCard("fake-points");
const flat = fixtureCard("fake-flat-cash");
const cash = program("cash-cad");
const rules = (() => {
  const r = validateMerchantRules(loadJson(join(DATA_DIR, "merchant_rules.json")));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.rules;
})();
const fakePoints = program("fake-points-program");

describe("chooseRedemption", () => {
  it("uses the requested method, else the first non-estimate, else the first", () => {
    expect(chooseRedemption(fakePoints)?.method).toBe("statement_credit");
    expect(chooseRedemption(fakePoints, "travel_transfer")?.method).toBe("travel_transfer");
    expect(chooseRedemption(fakePoints, "nope")?.method).toBe("statement_credit");
    const estimatesOnly = { ...fakePoints, redemptions: [fakePoints.redemptions[1]] };
    expect(chooseRedemption(estimatesOnly)?.method).toBe("travel_transfer");
    expect(chooseRedemption(null)).toBeNull();
    expect(chooseRedemption({ ...cash, redemptions: [] })).toBeNull();
  });
});

describe("computeBenefits", () => {
  it("fake-shared-cap-2026-01: 3,200 points = $32.00", () => {
    const seq = (loadJson(join(FIXTURES_DIR, "transactions", "fake-shared-cap-2026-01.json")) as { transactions: unknown[] })
      .transactions.map((raw) => {
        const r = validateTransaction(raw);
        if (!r.ok) throw new Error(r.errors.join("\n"));
        return r.transaction;
      });
    const rules = validateMerchantRules(loadJson(join(DATA_DIR, "merchant_rules.json")));
    if (!rules.ok) throw new Error(rules.errors.join("\n"));
    const r = computeBenefits({ card: shared, program: cash, items: categorizeAll(seq, rules.rules) });
    expect(r.points_total).toBe(3200);
    expect(r.rewards_value).toBe(32);
    expect(r.categories.map((c) => [c.category, c.net_spend, c.points, c.value])).toEqual([
      ["groceries", 600, 2100, 21],
      ["dining", 600, 1100, 11],
    ]);
    expect(r.caps[0]).toMatchObject({ used: 1000, limit: 1000, reached_on: "2026-01-12" });
    // $0 annual fee, no FX, no credits: net value is the rewards.
    expect(r.net_value).toBe(32);
    expect(r.unverified).toEqual([]);
  });

  it("refunds reduce points and value with no flooring", () => {
    const r = computeBenefits({
      card: grocery, program: cash,
      items: [item("2026-03-01", "groceries", 20), item("2026-03-02", "groceries", -50)],
    });
    expect(r.points_total).toBe(-150);
    expect(r.rewards_value).toBe(-1.5);
    expect(r.categories[0]).toMatchObject({ category: "groceries", net_spend: -30, points: -150, value: -1.5 });
  });

  it("values points with the chosen redemption method", () => {
    const items = [item("2026-03-01", "travel", 100)];
    const statement = computeBenefits({ card: pointsCard, program: fakePoints, items });
    expect([statement.points_total, statement.rewards_value, statement.value_is_estimate]).toEqual([300, 3, false]);
    const transfer = computeBenefits({ card: pointsCard, program: fakePoints, items, redemption_method: "travel_transfer" });
    expect([transfer.rewards_value, transfer.value_is_estimate]).toEqual([6, true]);
    expect(transfer.transactions[0].value).toBe(6);
  });

  it("never treats an unverified program or point value as 0", () => {
    const items = [item("2026-03-01", "travel", 100)];
    const noProgram = computeBenefits({ card: pointsCard, program: null, items });
    expect(noProgram.points_total).toBe(300);
    expect(noProgram.rewards_value).toBeNull();
    expect(noProgram.categories[0].value).toBeNull();
    expect(noProgram.unverified.map((u) => u.kind)).toContain("program");
    expect(noProgram.net_value_excludes).toContain("rewards value");

    const noValue = { ...fakePoints, redemptions: [{ ...fakePoints.redemptions[0], cents_per_point: null }] };
    const r = computeBenefits({ card: pointsCard, program: noValue, items });
    expect(r.rewards_value).toBeNull();
    expect(r.unverified.map((u) => u.kind)).toContain("redemption_value");
  });

  it("lists unverified earn terms with a count and excludes them from totals", () => {
    const r = computeBenefits({
      card: pointsCard, program: fakePoints,
      items: [item("2026-03-01", "gas", 50), item("2026-03-02", "transit", 20), item("2026-03-03", "travel", 10)],
    });
    expect(r.points_total).toBe(30);
    expect(r.unverified).toContainEqual({ kind: "cap", label: "A spending cap is not yet verified", count: 2, amount: 70 });
    expect(r.categories.find((c) => c.category === "gas")).toMatchObject({ points: 0, unverified_count: 1, unverified_amount: 50 });
    expect(r.net_value_excludes).toContain("points on unverified earn terms");
  });

  describe("purchase credits", () => {
    const creditItem = (date: string, description: string, amount: number) =>
      item(date, "travel", amount, { description });

    it("matches merchant keywords and caps at the credit amount per period", () => {
      const r = computeBenefits({
        card: pointsCard, program: fakePoints,
        items: [creditItem("2026-03-01", "FAKE AIR 123", 60), creditItem("2026-04-01", "FAKE HOTELS TORONTO", 70), creditItem("2026-04-02", "REAL AIR", 500)],
      });
      expect(r.credits).toEqual([{
        description: "FAKE: $100 annual travel credit", period: "year", period_key: "2026", limit: 100,
        eligible_spend: 130, matched_count: 2, used: 100, method: "estimated", posted: 0, remaining: 0, verified: true,
      }]);
      expect(r.credits_total).toBe(100);
    });

    it("refunds at matching merchants reduce the eligible spend", () => {
      const r = computeBenefits({
        card: pointsCard, program: fakePoints,
        items: [creditItem("2026-03-01", "FAKE AIR", 80), creditItem("2026-03-05", "FAKE AIR", -50)],
      });
      expect(r.credits[0]).toMatchObject({ eligible_spend: 30, used: 30, remaining: 70 });
    });

    it("keeps separate periods apart", () => {
      const r = computeBenefits({
        card: pointsCard, program: fakePoints,
        items: [creditItem("2025-12-20", "FAKE AIR", 80), creditItem("2026-01-05", "FAKE AIR", 80)],
      });
      expect(r.credits.map((c) => [c.period_key, c.used])).toEqual([["2025", 80], ["2026", 80]]);
      expect(r.credits_total).toBe(160);
    });

    it("regression: a posted statement-credit line is counted once, as credit used, not as a refund", () => {
      const txs = [
        creditItem("2026-03-01", "FAKE AIR 123", 80).transaction,
        { ...creditItem("2026-03-05", "FAKE TRAVEL CREDIT", -80).transaction },
      ];
      // Without classifyStatementCredits the credit line is an (unmatched, "other" 1×) refund:
      // points 240 − 80 = 160 AND credit used 80: the credit is counted twice.
      const travel = { "fake air": "travel" } as const; // user correction: FAKE AIR is travel (3×)
      const asRefund = computeBenefits({ card: pointsCard, program: fakePoints, items: categorizeAll(txs, rules, travel) });
      expect([asRefund.points_total, asRefund.credits_total]).toEqual([160, 80]);

      const fixed = computeBenefits({
        card: pointsCard, program: fakePoints,
        items: categorizeAll(classifyStatementCredits(pointsCard, txs), rules, travel),
      });
      expect(fixed.points_total).toBe(240);
      expect(fixed.credits).toEqual([expect.objectContaining({ method: "posted", posted: 80, used: 80, remaining: 20, eligible_spend: 80 })]);
      expect(fixed.credits_total).toBe(80);
      expect(fixed.categories.find((c) => c.category === "travel")?.net_spend).toBe(80);
    });

    it("uses the posted amount even when it differs from eligible spend", () => {
      const txs = [
        creditItem("2026-03-01", "FAKE AIR", 150).transaction,
        creditItem("2026-03-09", "FAKE TRAVEL CREDIT", -100).transaction,
      ];
      const r = computeBenefits({ card: pointsCard, program: fakePoints, items: categorizeAll(classifyStatementCredits(pointsCard, txs), rules) });
      expect(r.credits[0]).toMatchObject({ method: "posted", used: 100, remaining: 0, eligible_spend: 150 });
    });

    it("flags a credit whose statement text is unverified", () => {
      const card: Card = { ...pointsCard, purchase_credits: [{ ...pointsCard.purchase_credits![0], statement_keywords: null }] };
      const r = computeBenefits({ card, program: fakePoints, items: [creditItem("2026-03-01", "FAKE AIR", 50)] });
      expect(r.unverified.map((u) => u.kind)).toContain("credit_statement_text");
      expect(r.credits[0]).toMatchObject({ method: "estimated", used: 50 });
    });

    it("marks unverified credit terms and lists", () => {
      const noAmount: Card = { ...pointsCard, purchase_credits: [{ ...pointsCard.purchase_credits![0], amount: null }] };
      const r = computeBenefits({ card: noAmount, program: fakePoints, items: [creditItem("2026-03-01", "FAKE AIR", 80)] });
      expect(r.credits[0]).toMatchObject({ used: null, verified: false, eligible_spend: 80 });
      expect(r.credits_total).toBe(0);
      expect(r.unverified.map((u) => u.kind)).toContain("credit_terms");
      const unknown = computeBenefits({ card: { ...pointsCard, purchase_credits: null }, program: fakePoints, items: [] });
      expect(unknown.unverified.map((u) => u.kind)).toContain("purchase_credits");
    });
  });

  describe("foreign transactions", () => {
    const foreign = (amount: number) => item("2026-03-01", "travel", amount, { is_foreign: true });

    it("estimates the embedded fee as amount × fee / (1 + fee)", () => {
      // fake-grocery-cash: 2.5%. $102.50 CAD includes $2.50 of fee.
      const r = computeBenefits({ card: grocery, program: cash, items: [foreign(102.5)] });
      expect(r.fx).toEqual({
        method: "embedded_estimate", amount: 2.5, is_estimate: true,
        foreign_spend: 102.5, foreign_count: 1, low_confidence_count: 0,
      });
    });

    it("uses posted FX fee lines instead, never both", () => {
      const r = computeBenefits({
        card: grocery, program: cash,
        items: [foreign(100), item("2026-03-01", null, 2.5, { kind: "fee", description: "FOREIGN TRANSACTION FEE" })],
      });
      expect(r.fx).toMatchObject({ method: "posted", amount: 2.5, is_estimate: false });
      expect(r.fees).toMatchObject({ posted_fx_fee_lines: 2.5, posted_fee_lines: 0 });
    });

    it("reports no FX cost without foreign spend, and unverified when the fee is null", () => {
      expect(computeBenefits({ card: grocery, program: cash, items: [item("2026-03-01", "gas", 10)] }).fx)
        .toMatchObject({ method: "none", amount: 0 });
      const r = computeBenefits({ card: { ...grocery, fx_fee_pct: null }, program: cash, items: [foreign(100)] });
      expect(r.fx).toMatchObject({ method: "unverified", amount: null });
      expect(r.unverified.map((u) => u.kind)).toContain("fx_fee");
      expect(r.net_value_excludes).toContain("foreign transaction fees");
    });

    it("counts low-confidence foreign flags", () => {
      const r = computeBenefits({
        card: grocery, program: cash,
        items: [item("2026-03-01", "travel", 10, { is_foreign: true, is_foreign_confidence: "low" })],
      });
      expect(r.fx.low_confidence_count).toBe(1);
    });
  });

  describe("fees and net value", () => {
    it("prorates the annual fee to the months covered and shows the full amount", () => {
      const r = computeBenefits({
        card: grocery, program: cash,
        items: [item("2026-03-01", "groceries", 100), item("2026-03-28", "gas", 100)],
      });
      expect(r.fees).toMatchObject({ basis: "annual_fee", annual_fee_full: 100, months_covered: 1, annual_fee_prorated: 8.33 });
      // 100 × 5 + 100 × 1 = 600 pts = $6.00, minus $8.33.
      expect(r.net_value).toBe(-2.33);
      const three = computeBenefits({ card: grocery, program: cash, items: [item("2026-03-01", "gas", 1)], months_covered: 3 });
      expect(three.fees.annual_fee_prorated).toBe(25);
    });

    it("uses the first-year fee when the statements are within 12 months of opening", () => {
      const items = [item("2026-03-01", "travel", 100)];
      const first = computeBenefits({ card: pointsCard, program: fakePoints, items, open_date: "2025-06-01" });
      expect(first.fees).toMatchObject({ basis: "first_year_fee", annual_fee_full: 0, annual_fee_prorated: 0 });
      const later = computeBenefits({ card: pointsCard, program: fakePoints, items, open_date: "2024-06-01" });
      expect(later.fees).toMatchObject({ basis: "annual_fee", annual_fee_full: 120, annual_fee_prorated: 10 });
    });

    it("excludes an unverified annual fee instead of using 0", () => {
      const r = computeBenefits({ card: { ...grocery, annual_fee: null }, program: cash, items: [item("2026-03-01", "gas", 100)] });
      expect(r.fees.annual_fee_prorated).toBeNull();
      expect(r.net_value).toBe(1);
      expect(r.net_value_excludes).toEqual(["annual fee"]);
      expect(r.unverified.map((u) => u.kind)).toContain("annual_fee");
    });

    it("keeps posted fee lines and interest out of net value", () => {
      const r = computeBenefits({
        card: flat, program: cash,
        items: [
          item("2026-03-01", "gas", 100),
          item("2026-03-02", null, 120, { kind: "fee", description: "ANNUAL FEE" }),
          item("2026-03-03", null, 12.34, { kind: "interest", description: "PURCHASE INTEREST" }),
        ],
      });
      expect(r.fees).toMatchObject({ posted_fee_lines: 120, interest: 12.34 });
      expect(r.net_value).toBe(2);
    });
  });
});

describe("welcomeBonusProgress", () => {
  it("tracks spend so far against min_spend and days left", () => {
    const items = [item("2026-01-10", "groceries", 300), item("2026-02-01", "gas", 250), item("2026-02-03", "gas", -50)];
    expect(welcomeBonusProgress(grocery, items, "2026-01-05", "2026-02-05")).toEqual([{
      bonus_index: 0, points_or_cash: 10000, min_spend: 1000, window_end: "2026-04-05",
      spend_so_far: 500, remaining_spend: 500, days_left: 59, status: "open",
    }]);
  });

  it("ignores spend outside the window and reports met or expired", () => {
    const items = [item("2026-01-01", "gas", 5000), item("2026-01-10", "gas", 1000)];
    expect(welcomeBonusProgress(grocery, items, "2026-01-05", "2026-01-20")[0]).toMatchObject({ spend_so_far: 1000, status: "met" });
    expect(welcomeBonusProgress(grocery, [item("2026-01-10", "gas", 10)], "2026-01-05", "2026-05-01")[0])
      .toMatchObject({ status: "expired", days_left: 0 });
  });

  it("is unverified when the window or min spend is null, and empty with no bonus", () => {
    const card: Card = { ...grocery, welcome_bonus: [{ points_or_cash: 100, min_spend: null, window_months: 3 }] };
    expect(welcomeBonusProgress(card, [], "2026-01-05", "2026-01-06")[0]).toMatchObject({ status: "unverified", remaining_spend: null });
    expect(welcomeBonusProgress(flat, [], "2026-01-05", "2026-01-06")).toEqual([]);
    expect(welcomeBonusProgress({ ...grocery, welcome_bonus: null }, [], "2026-01-05", "2026-01-06")).toEqual([]);
  });
});
