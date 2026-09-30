import { describe, expect, it } from "vitest";
import {
  categorize,
  categorizeAll,
  setOverride,
  type MerchantRules,
  type Transaction,
} from "@/engine";
import { categorizedStatement, seededRules } from "../helpers/statements";

const tx = (description: string, over: Partial<Transaction> = {}): Transaction => ({
  id: "tx-1",
  statement_line: 1,
  date: "2026-03-01",
  description,
  amount_cad: 10,
  kind: "purchase",
  is_foreign: false,
  is_foreign_confidence: "high",
  raw: {},
  ...over,
});

const rules = (...r: MerchantRules["rules"]): MerchantRules => ({ version: 1, rules: r });
const seeded = seededRules();
const cat = (d: string, r: MerchantRules = seeded) => {
  const c = categorize(tx(d), r);
  return [c.category, c.confidence] as const;
};

describe("categorize", () => {
  describe("legacy bug 3: loose keyword matching (docs/legacy-bugs.md)", () => {
    it('"united" is not airline travel for UNITED FARMERS CO-OP or UNITED WAY', () => {
      expect(cat("UNITED FARMERS CO-OP CALGARY AB")).toEqual(["other", "low"]);
      expect(cat("UNITED WAY DONATION")).toEqual(["other", "low"]);
      expect(cat("UNITED AIRLINES 0162345678")).toEqual(["travel", "high"]);
    });

    it('does match when a rule says "united" is travel', () => {
      const r = rules({ id: "united", category: "travel", keywords: ["united"] });
      expect(cat("UNITED FARMERS CO-OP CALGARY AB", r)).toEqual(["travel", "high"]);
    });

    it('"bar" does not match BARBER SHOP', () => {
      const r = rules({ id: "bars", category: "dining", keywords: ["bar"] });
      expect(cat("BARBER SHOP", r)).toEqual(["other", "low"]);
      expect(cat("THE BAR ON KING", r)).toEqual(["dining", "high"]);
    });

    it('"shell" matches SHELL C12345 but not SHELLFISH MARKET', () => {
      expect(cat("SHELL C12345 OTTAWA ON")).toEqual(["gas", "high"]);
      expect(cat("SHELLFISH MARKET VANCOUVER")).toEqual(["other", "low"]);
    });
  });

  it("is case-insensitive and ignores punctuation and accents", () => {
    expect(cat("petro-canada #88")).toEqual(["gas", "high"]);
    expect(cat("ÉPICERIE METRO #123 MONTRÉAL")).toEqual(["groceries", "high"]);
  });

  it("prefers the longest matching keyword", () => {
    expect(cat("UBER EATS TORONTO")).toEqual(["dining", "high"]);
    expect(cat("UBER *TRIP HELP.UBER.COM")).toEqual(["transit", "high"]);
    const c = categorize(tx("UBER EATS TORONTO"), seeded);
    expect([c.rule_id, c.keyword]).toEqual(["food-delivery", "uber eats"]);
  });

  it("marks conflicting matches low confidence, and keeps high when all agree", () => {
    const r = rules(
      { id: "a", category: "groceries", keywords: ["fresh"] },
      { id: "b", category: "dining", keywords: ["cafe"] },
      { id: "c", category: "groceries", keywords: ["market"] },
    );
    expect(cat("FRESH CAFE", r)).toEqual(["groceries", "low"]);
    expect(cat("FRESH MARKET", r)).toEqual(["groceries", "high"]);
  });

  it("does not treat a keyword inside the winning keyword as a conflict", () => {
    const r = rules(
      { id: "rides", category: "transit", keywords: ["uber"] },
      { id: "food", category: "dining", keywords: ["uber eats"] },
      { id: "shop", category: "online_shopping", keywords: ["toronto"] },
    );
    expect(cat("UBER EATS", r)).toEqual(["dining", "high"]);
    expect(cat("UBER EATS TORONTO", r)).toEqual(["dining", "low"]);
  });

  it("breaks equal-length ties by rule order", () => {
    const r = rules(
      { id: "first", category: "groceries", keywords: ["abcd"] },
      { id: "second", category: "dining", keywords: ["wxyz"] },
    );
    expect(categorize(tx("WXYZ ABCD"), r).rule_id).toBe("first");
  });

  it('falls back to "other" with low confidence', () => {
    const c = categorize(tx("SOMEWHERE NEW"), seeded);
    expect([c.category, c.confidence, c.source, c.rule_id]).toEqual(["other", "low", "unmatched", null]);
  });

  it("categorizes refunds like purchases", () => {
    const c = categorize(tx("LOBLAWS #1234", { kind: "refund", amount_cad: -30 }), seeded);
    expect([c.category, c.source]).toEqual(["groceries", "rule"]);
  });

  it("excludes payments, fees and interest from categories", () => {
    for (const kind of ["payment", "fee", "interest"] as const) {
      const c = categorize(tx("ANYTHING", { kind }), seeded);
      expect([c.category, c.source, c.confidence]).toEqual([null, "excluded", "high"]);
    }
  });

  it("applies user overrides before rules", () => {
    const o = setOverride({}, "UNITED FARMERS CO-OP #12 CALGARY", "gas");
    const c = categorize(tx("UNITED FARMERS CO-OP #99 CALGARY"), seeded, o);
    expect([c.category, c.confidence, c.source]).toEqual(["gas", "high", "override"]);
    const loblaws = setOverride({}, "LOBLAWS #1", "home_improvement");
    expect(categorize(tx("LOBLAWS #2"), seeded, loblaws).category).toBe("home_improvement");
  });

  it("does not apply overrides to excluded kinds", () => {
    const o = setOverride({}, "ANNUAL FEE", "other");
    expect(categorize(tx("ANNUAL FEE", { kind: "fee" }), seeded, o).category).toBeNull();
  });
});

describe("categorizeAll on fixture statements", () => {
  it("amount-currency.csv", () => {
    const got = categorizedStatement("amount-currency.csv").map((c) => [
      c.transaction.description,
      c.category,
      c.confidence,
    ]);
    expect(got).toEqual([
      ["LOBLAWS #1234 TORONTO ON", "groceries", "high"],
      ["LOBLAWS #1234 TORONTO ON", "groceries", "high"],
      ["SOBEYS #555 HALIFAX NS", "groceries", "high"],
      ["TIM HORTONS #0456", "dining", "high"],
      ["UBER EATS TORONTO", "dining", "high"],
      ["UBER *TRIP HELP.UBER.COM", "transit", "high"],
      ["UNITED FARMERS CO-OP CALGARY AB", "other", "low"],
      ["UNITED AIRLINES 0162345678", "travel", "high"],
      ["AMAZON.CA MARKETPLACE", "online_shopping", "high"],
      ["AMAZON.CA MARKETPLACE", "online_shopping", "high"],
      ["SHELL C12345 OTTAWA ON", "gas", "high"],
      ["SHELLFISH MARKET VANCOUVER", "other", "low"],
      ["PAYMENT - THANK YOU", null, "high"],
      ["ANNUAL FEE", null, "high"],
      ["PURCHASE INTEREST", null, "high"],
      ["NETFLIX.COM", "streaming", "high"],
      ["BEST BAKERY, INC", "other", "low"],
    ]);
  });

  it("returns one result per transaction, in order", () => {
    const list = [tx("A", { statement_line: 1 }), tx("B", { statement_line: 2 })];
    expect(categorizeAll(list, seeded).map((c) => c.transaction.statement_line)).toEqual([1, 2]);
  });
});
