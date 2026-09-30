import { describe, expect, it } from "vitest";
import { categorizeAll, summarizeStatement, type Transaction } from "@/engine";
import { categorizedStatement, seededRules } from "../helpers/statements";

const tx = (line: number, description: string, amount_cad: number, over: Partial<Transaction> = {}): Transaction => ({
  id: `tx-${line}`,
  statement_line: line,
  date: "2026-03-01",
  description,
  amount_cad,
  kind: amount_cad < 0 ? "refund" : "purchase",
  is_foreign: false,
  is_foreign_confidence: "high",
  raw: {},
  ...over,
});
const summarize = (list: Transaction[]) => summarizeStatement(categorizeAll(list, seededRules()));

describe("summarizeStatement", () => {
  describe("legacy bug 2: refunds (docs/legacy-bugs.md)", () => {
    it("a full refund nets the category to $0", () => {
      const s = summarize([tx(1, "LOBLAWS", 100), tx(2, "LOBLAWS", -100)]);
      expect(s.spend_by_category.groceries).toBe(0);
      expect([s.purchases, s.refunds]).toEqual([100, 100]);
    });

    it("a partial refund reduces the category", () => {
      expect(summarize([tx(1, "LOBLAWS", 100), tx(2, "LOBLAWS", -30)]).spend_by_category.groceries).toBe(70);
    });

    it("a card payment changes no category", () => {
      const s = summarize([tx(1, "LOBLAWS", 100), tx(2, "PAYMENT - THANK YOU", -100, { kind: "payment" })]);
      expect(s.spend_by_category.groceries).toBe(100);
      expect(s.payments).toBe(100);
    });

    it("floors an over-refunded category at $0 for display only, keeping the raw net", () => {
      const s = summarize([tx(1, "LOBLAWS", 20), tx(2, "LOBLAWS", -50)]);
      expect(s.spend_by_category.groceries).toBe(0);
      expect(s.net_by_category.groceries).toBe(-30);
      expect(s.over_refunded).toEqual(["groceries"]);
    });

    it("net_by_category equals spend_by_category when nothing is over-refunded", () => {
      const s = summarize([tx(1, "LOBLAWS", 100), tx(2, "LOBLAWS", -30), tx(3, "NETFLIX", 16.49)]);
      expect(s.net_by_category).toEqual(s.spend_by_category);
    });
  });

  it("keeps fees and interest out of category spend but reports them", () => {
    const s = summarize([
      tx(1, "ANNUAL FEE", 120, { kind: "fee" }),
      tx(2, "PURCHASE INTEREST", 12.34, { kind: "interest" }),
    ]);
    expect(Object.values(s.spend_by_category).every((v) => v === 0)).toBe(true);
    expect([s.fees, s.interest]).toEqual([120, 12.34]);
  });

  it("nets foreign refunds and sums in cents", () => {
    const s = summarize([
      tx(1, "NETFLIX", 0.1, { is_foreign: true }),
      tx(2, "NETFLIX", 0.2, { is_foreign: true }),
      tx(3, "NETFLIX", -0.1, { is_foreign: true }),
    ]);
    expect(s.foreign_spend).toBe(0.2);
    expect(s.spend_by_category.streaming).toBe(0.2);
  });

  it("amount-currency.csv totals", () => {
    const s = summarizeStatement(categorizedStatement("amount-currency.csv"));
    expect(s.spend_by_category).toEqual({
      groceries: 120,
      dining: 29.25,
      gas: 55,
      transit: 18.5,
      travel: 400,
      streaming: 16.49,
      drugstore: 0,
      recurring_bills: 0,
      entertainment: 0,
      home_improvement: 0,
      online_shopping: 0,
      other: 104,
    });
    expect(s).toMatchObject({
      purchases: 813.24,
      refunds: 70,
      foreign_spend: 400,
      fees: 120,
      interest: 12.34,
      payments: 500,
      over_refunded: [],
    });
  });

  it("debit-credit.csv totals", () => {
    const s = summarizeStatement(categorizedStatement("debit-credit.csv"));
    expect(s.spend_by_category).toMatchObject({ transit: 3.3, drugstore: 0, other: 190, home_improvement: 1234.56 });
    expect(s).toMatchObject({ refunds: 22.1, payments: 325, fees: 4.75, interest: 0, foreign_spend: 190 });
  });

  it("fr-headerless.csv totals", () => {
    const s = summarizeStatement(categorizedStatement("fr-headerless.csv"));
    expect(s.spend_by_category).toMatchObject({
      groceries: 45.67,
      drugstore: 0,
      transit: 3.75,
      online_shopping: 1234.56,
    });
    expect(s).toMatchObject({ payments: 500, interest: 8.9, fees: 120, foreign_spend: 1234.56 });
  });
});
