import { describe, expect, it } from "vitest";
import {
  actualAssignment,
  annualCredits,
  poolStatements,
  routeTransactions,
  scoreAssignment,
  type CardSetEntry,
  type CategoryPolicy,
} from "@/engine";
import { fixtureCard, item, program } from "../helpers/cards";

const cash = program("cash-cad");
const flat: CardSetEntry = { card: fixtureCard("fake-flat-cash"), program: cash };
const grocery: CardSetEntry = { card: fixtureCard("fake-grocery-cash"), program: cash };
const cap = { id: "groceries-dining-monthly", amount: 500, period: "month" as const, shared_with: ["groceries" as const, "dining" as const] };
const policy: CategoryPolicy[] = [
  { category: "groceries", steps: [{ card_id: "fake-grocery-cash", until_cap: cap }, { card_id: "fake-flat-cash", until_cap: null }], foreign_steps: null, has_spend: true },
  { category: "gas", steps: [{ card_id: "fake-flat-cash", until_cap: null }], foreign_steps: [{ card_id: "fake-grocery-cash", until_cap: null }], has_spend: true },
];
const g = (date: string, amount: number, description = "LOBLAWS") => item(date, "groceries", amount, { description });
const ids = (m: Map<string, { transaction: { description: string; amount_cad: number } }[]>, card: string) =>
  (m.get(card) ?? []).map((i) => `${i.transaction.description} ${i.transaction.amount_cad}`);

describe("routeTransactions", () => {
  it("uses a card until its cap is reached (the crossing purchase stays), then the next", () => {
    const out = routeTransactions(policy, [g("2026-01-02", 300, "A"), g("2026-01-03", 300, "B"), g("2026-01-04", 100, "C")]);
    expect(ids(out, "fake-grocery-cash")).toEqual(["A 300", "B 300"]);
    expect(ids(out, "fake-flat-cash")).toEqual(["C 100"]);
  });

  it("resets cap room each period", () => {
    const out = routeTransactions(policy, [g("2026-01-02", 600, "A"), g("2026-01-20", 50, "B"), g("2026-02-01", 50, "C")]);
    expect(ids(out, "fake-grocery-cash")).toEqual(["A 600", "C 50"]);
    expect(ids(out, "fake-flat-cash")).toEqual(["B 50"]);
  });

  it("sends a refund to the card its purchase went on; unmatched to the first step", () => {
    const out = routeTransactions(policy, [
      g("2026-01-02", 600, "A"), g("2026-01-03", 80, "B"), g("2026-01-05", -80, "B"), g("2026-01-06", -20, "Z"),
    ]);
    expect(ids(out, "fake-flat-cash")).toEqual(["B 80", "B -80"]);
    expect(ids(out, "fake-grocery-cash")).toEqual(["A 600", "Z -20"]);
  });

  it("routes foreign purchases by foreign steps", () => {
    const out = routeTransactions(policy, [item("2026-01-02", "gas", 50, { is_foreign: true, description: "F" }), item("2026-01-02", "gas", 50, { description: "D" })]);
    expect(ids(out, "fake-grocery-cash")).toEqual(["F 50"]);
    expect(ids(out, "fake-flat-cash")).toEqual(["D 50"]);
  });

  it("puts purchases on a pursued bonus card until its requirement is met", () => {
    const out = routeTransactions(
      policy,
      [item("2026-01-02", "gas", 200, { description: "A" }), item("2026-01-03", "gas", 200, { description: "B" }), item("2026-01-04", "gas", 200, { description: "C" })],
      [{ card_id: "fake-grocery-cash", required: 333, window_months_in_data: 1, value: 100, projected: true, window_months: ["2026-01"] }],
    );
    expect(ids(out, "fake-grocery-cash")).toEqual(["A 200", "B 200"]);
    expect(ids(out, "fake-flat-cash")).toEqual(["C 200"]);
  });
});

describe("poolStatements / actualAssignment", () => {
  it("pools spend with unique ids, keeps credit lines with their card, drops fees and payments", () => {
    const pool = poolStatements(new Map([
      ["a", [g("2026-01-02", 10), item("2026-01-03", null, -5, { kind: "credit" }), item("2026-01-04", null, 3, { kind: "fee" })]],
      ["b", [g("2026-01-05", 20)]],
    ]));
    expect(pool.spend.map((i) => i.transaction.id.split("/")[0])).toEqual(["a", "b"]);
    expect(pool.credits.get("a")).toHaveLength(1);
    expect([...actualAssignment(pool).keys()]).toEqual(["a", "b"]);
  });
});

describe("scoreAssignment", () => {
  it("scores with computeBenefits and annualizes from the months covered", () => {
    const assignment = new Map([["fake-grocery-cash", [g("2026-01-02", 400)]], ["fake-flat-cash", [item("2026-01-03", "gas", 100)]]]);
    const s = scoreAssignment([flat, grocery], assignment, new Map(), "ongoing", ["2026-01"]);
    // 400 × 5% + 100 × 2% − 100/12 = 13.67 for the month.
    expect(s.recurring_period).toBeCloseTo(22 - 8.33, 2);
    // Annualized: 22 × 12 − the full $100 fee (not 8.33 × 12).
    expect(s.recurring_annual).toBeCloseTo(22 * 12 - 100, 9);
    expect(s.total_annual).toBe(s.recurring_annual);
    expect(s.category_annual.get("groceries")).toBeCloseTo(240, 6);
    expect(s.category_spend.get("gas")).toEqual(new Map([["fake-flat-cash", 100]]));
  });

  it("adds a met bonus once, never annualized, and uses first-year fees for new cards", () => {
    const newGrocery = { ...grocery, is_new: true };
    const target = { card_id: "fake-grocery-cash", required: 333, window_months_in_data: 1, value: 100, projected: true, window_months: ["2026-01"] };
    const s = scoreAssignment([newGrocery], new Map([["fake-grocery-cash", [g("2026-01-02", 400)]]]), new Map(), "first_year", ["2026-01"], [target]);
    expect(s.cards[0].bonus).toEqual({ pursued: true, met: true, projected: true, value: 100 });
    expect(s.cards[0].report.fees.basis).toBe("first_year_fee");
    expect(s.total_annual).toBeCloseTo(s.recurring_annual + 100, 9);
    const unmet = scoreAssignment([newGrocery], new Map([["fake-grocery-cash", [g("2026-01-02", 100)]]]), new Map(), "first_year", ["2026-01"], [target]);
    expect(unmet.bonus_value).toBe(0);
  });
});

describe("annualCredits", () => {
  const points: CardSetEntry = { card: fixtureCard("fake-points"), program: program("fake-points-program") };
  it("caps an annualized credit at its yearly limit", () => {
    // fake-points: $100/year credit at FAKE AIR. $80 used in one month would be $960 × 12 naively.
    const s = scoreAssignment([points], new Map([["fake-points", [item("2026-01-05", "travel", 80, { description: "FAKE AIR" })]]]), new Map(), "ongoing", ["2026-01"]);
    const report = s.cards[0].report;
    expect(report.credits_total).toBe(80);
    expect(annualCredits(report, 12)).toBe(100);
    // 80 × 3 pts × 1¢ × 12 = 28.80 rewards + $100 credit − $120 fee.
    expect(s.recurring_annual).toBeCloseTo(28.8 + 100 - 120, 9);
  });

  it("scales a credit that isn't used up", () => {
    const s = scoreAssignment([points], new Map([["fake-points", [item("2026-01-05", "travel", 20, { description: "FAKE AIR" })]]]), new Map(), "ongoing", ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
    expect(annualCredits(s.cards[0].report, 2)).toBe(40);
  });
});

describe("credit-first routing (docs/decisions.md, Earn more rule 4)", () => {
  const rule = { card_id: "fake-points", description: "FAKE: $100 annual travel credit", merchant_keywords: ["fake air", "fake hotels"], limit: 100, period: "year" as const };
  const otherToFlat: CategoryPolicy[] = [{ category: "other", steps: [{ card_id: "fake-flat-cash", until_cap: null }], foreign_steps: null, has_spend: true }];
  const o = (date: string, amount: number, description: string) => item(date, "other", amount, { description });

  it("sends matching purchases to the credit's card until its limit is used, then routes normally", () => {
    const out = routeTransactions(
      otherToFlat,
      [o("2026-01-02", 60, "FAKE AIR 1"), o("2026-01-03", 70, "FAKE HOTELS 2"), o("2026-01-04", 50, "FAKE AIR 3"), o("2026-01-05", 20, "CORNER STORE")],
      [],
      [rule],
    );
    // 60 then 70 (crossing the $100 limit stays), then the limit is used: normal routing.
    expect(ids(out, "fake-points")).toEqual(["FAKE AIR 1 60", "FAKE HOTELS 2 70"]);
    expect(ids(out, "fake-flat-cash")).toEqual(["FAKE AIR 3 50", "CORNER STORE 20"]);
  });

  it("resets with the credit's period and refunds follow their purchase", () => {
    const out = routeTransactions(
      otherToFlat,
      [o("2026-12-20", 100, "FAKE AIR"), o("2027-01-03", 40, "FAKE AIR"), o("2027-01-04", -40, "FAKE AIR")],
      [],
      [rule],
    );
    expect(ids(out, "fake-points")).toEqual(["FAKE AIR 100", "FAKE AIR 40", "FAKE AIR -40"]);
  });
});
