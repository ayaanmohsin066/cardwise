import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  categorizeAll,
  categoryEarning,
  earnPoints,
  effectiveRate,
  isRoundingMode,
  roundPoints,
  pointsEvaluator,
  postingOrder,
  totalPoints,
  validateMerchantRules,
  validateTransaction,
  type Card,
  type Transaction,
} from "@/engine";
import { fixtureCard, item } from "../helpers/cards";
import { DATA_DIR, FIXTURES_DIR, loadJson } from "../helpers/data-files";

const grocery = fixtureCard("fake-grocery-cash");
const shared = fixtureCard("fake-shared-cap");
const pointsCard = fixtureCard("fake-points");
const withAfterCap = (card: Card, after: number | null): Card => ({
  ...card,
  earn_rules: card.earn_rules!.map((r) => ({ ...r, after_cap_rate: after })),
});

describe("categoryEarning / effectiveRate", () => {
  it("resolves bonus rules, the base rate and caps", () => {
    expect(categoryEarning(grocery, "groceries")).toEqual({
      ok: true, rate: 5, rule_index: 0,
      cap: { id: "groceries-dining-monthly", amount: 500, period: "month" },
      after_cap_rate: 1,
    });
    expect(categoryEarning(grocery, "gas")).toEqual({ ok: true, rate: 1, rule_index: null, cap: null, after_cap_rate: null });
    expect(categoryEarning(pointsCard, "travel")).toMatchObject({ ok: true, rate: 3, cap: null });
    expect(effectiveRate(grocery, "dining")).toBe(5);
  });

  it("reports unverified terms instead of guessing", () => {
    expect(categoryEarning(pointsCard, "gas")).toEqual({ ok: false, reason: "cap" });
    expect(categoryEarning({ ...grocery, earn_rules: null }, "gas")).toEqual({ ok: false, reason: "earn_rules" });
    expect(categoryEarning({ ...grocery, base_rate: null }, "gas")).toEqual({ ok: false, reason: "base_rate" });
    const noRate = { ...grocery, earn_rules: [{ ...grocery.earn_rules![0], rate: null }] };
    expect(categoryEarning(noRate, "groceries")).toEqual({ ok: false, reason: "earn_rate" });
    const noCapAmount = { ...grocery, caps: [{ id: "groceries-dining-monthly", amount: null, period: "month" as const }] };
    expect(categoryEarning(noCapAmount, "groceries")).toEqual({ ok: false, reason: "cap" });
    expect(effectiveRate(pointsCard, "gas")).toBeNull();
  });
});

describe("earnPoints", () => {
  describe("legacy bug 1: after-cap rate (docs/legacy-bugs.md)", () => {
    it("$700 groceries in one month earns 500 × 5 + 200 × 1 = 2,700", () => {
      expect(totalPoints(grocery, [item("2026-03-05", "groceries", 700)])).toBe(2700);
      expect(totalPoints(grocery, [item("2026-03-05", "groceries", 500), item("2026-03-06", "groceries", 200)])).toBe(2700);
    });

    it("uses the rule's own after_cap_rate: 2 gives 2,900", () => {
      expect(totalPoints(withAfterCap(grocery, 2), [item("2026-03-05", "groceries", 700)])).toBe(2900);
    });

    it("an unverified after_cap_rate leaves the over-cap part unverified, not 0 or 1×", () => {
      const r = earnPoints(withAfterCap(grocery, null), [item("2026-03-05", "groceries", 700)]);
      expect(r.transactions[0]).toMatchObject({
        points: 2500, bonus_amount: 500, after_cap_amount: 200,
        unverified_amount: 200, unverified_reason: "after_cap_rate",
      });
    });
  });

  describe("refunds use raw signed amounts (docs/decisions.md)", () => {
    it("$100 purchase and −$30 refund on fake-grocery-cash = 350", () => {
      expect(totalPoints(grocery, [item("2026-03-01", "groceries", 100), item("2026-03-02", "groceries", -30)])).toBe(350);
    });

    it("$20 purchase and −$50 refund = −150, not 0", () => {
      const r = earnPoints(grocery, [item("2026-03-01", "groceries", 20), item("2026-03-02", "groceries", -50)]);
      expect(r.transactions.reduce((s, t) => s + t.points, 0)).toBe(-150);
      expect(r.caps[0].used).toBe(0);
    });

    it("a refund with no purchase in the period (prior-statement refund) reduces points there", () => {
      expect(totalPoints(grocery, [item("2026-02-10", "groceries", 100), item("2026-03-02", "groceries", -100)])).toBe(0);
      const march = earnPoints(grocery, [item("2026-03-02", "groceries", -100)]);
      expect(march.transactions[0].points).toBe(-500);
    });

    it("reverses after-cap spend first, then bonus spend (freeing cap room)", () => {
      const r = earnPoints(grocery, [
        item("2026-03-01", "groceries", 700), // 2,500 + 200
        item("2026-03-02", "groceries", -100), // −100 at 1×, cap still full
      ]);
      expect(r.transactions.map((t) => t.points)).toEqual([2700, -100]);
      expect(r.caps[0].used).toBe(500);

      const freed = earnPoints(grocery, [
        item("2026-03-01", "groceries", 500), // 2,500, cap full
        item("2026-03-02", "groceries", -100), // −500, 100 of room back
        item("2026-03-03", "groceries", 200), // 100 × 5 + 100 × 1 = 600
      ]);
      expect(freed.transactions.map((t) => t.points)).toEqual([2500, -500, 600]);
    });
  });

  describe("shared caps in posting order", () => {
    const seq = (loadJson(join(FIXTURES_DIR, "transactions", "fake-shared-cap-2026-01.json")) as { transactions: unknown[] })
      .transactions.map((raw) => {
        const r = validateTransaction(raw);
        if (!r.ok) throw new Error(r.errors.join("\n"));
        return r.transaction;
      });
    const rules = validateMerchantRules(loadJson(join(DATA_DIR, "merchant_rules.json")));
    if (!rules.ok) throw new Error(rules.errors.join("\n"));
    const categorized = categorizeAll(seq, rules.rules);

    it("fake-shared-cap-2026-01 gives exactly 3,200 points", () => {
      const r = earnPoints(shared, categorized);
      expect(r.transactions.map((t) => t.points)).toEqual([400, 1600, 600, 450, 100, 50]);
      expect(totalPoints(shared, categorized)).toBe(3200);
      expect(r.caps).toEqual([{
        cap_id: "combined-monthly", period: "month", period_key: "2026-01", limit: 1000,
        used: 1000, reached_on: "2026-01-12", categories: ["groceries", "dining"],
      }]);
    });

    it("is independent of input order (sorted by date, then statement line)", () => {
      expect(totalPoints(shared, [...categorized].reverse())).toBe(3200);
    });

    it("the same-date tie follows statement order: swapping lines 3 and 4 gives 3,300", () => {
      const swapped = categorized.map((c) => {
        const n = c.transaction.statement_line;
        const statement_line = n === 3 ? 4 : n === 4 ? 3 : n;
        return { ...c, transaction: { ...c.transaction, statement_line } as Transaction };
      });
      expect(totalPoints(shared, swapped)).toBe(3300);
    });
  });

  it("resets caps each calendar period", () => {
    const r = earnPoints(grocery, [item("2026-01-31", "groceries", 500), item("2026-02-01", "groceries", 500)]);
    expect(r.transactions.map((t) => t.points)).toEqual([2500, 2500]);
    expect(r.caps.map((c) => [c.period_key, c.used, c.reached_on])).toEqual([
      ["2026-01", 500, "2026-01-31"],
      ["2026-02", 500, "2026-02-01"],
    ]);
  });

  it("supports quarter and year caps", () => {
    const quarterly: Card = { ...grocery, caps: [{ id: "groceries-dining-monthly", amount: 500, period: "quarter" }] };
    expect(totalPoints(quarterly, [item("2026-01-10", "groceries", 400), item("2026-03-10", "groceries", 200)])).toBe(2600);
    expect(totalPoints(quarterly, [item("2026-03-10", "groceries", 400), item("2026-04-10", "groceries", 200)])).toBe(3000);
    const yearly: Card = { ...grocery, caps: [{ id: "groceries-dining-monthly", amount: 500, period: "year" }] };
    expect(totalPoints(yearly, [item("2026-01-10", "groceries", 400), item("2026-12-10", "groceries", 200)])).toBe(2600);
  });

  it("earns base rate, uncapped bonus, and marks unverified caps", () => {
    const r = earnPoints(pointsCard, [
      item("2026-03-01", "travel", 1000),
      item("2026-03-02", "gas", 50),
      item("2026-03-03", "groceries", 10),
    ]);
    expect(r.transactions.map((t) => [t.category, t.points, t.unverified_amount, t.unverified_reason])).toEqual([
      ["travel", 3000, 0, null],
      ["gas", 0, 50, "cap"],
      ["groceries", 10, 0, null],
    ]);
  });

  it("ignores payments, fees and interest", () => {
    const r = earnPoints(grocery, [
      item("2026-03-01", null, -500, { kind: "payment" }),
      item("2026-03-02", null, 100, { kind: "fee" }),
      item("2026-03-03", null, 5, { kind: "interest" }),
    ]);
    expect(r.transactions).toEqual([]);
  });

  it("postingOrder sorts by date then statement line without mutating", () => {
    const a = item("2026-03-02", "gas", 1);
    const b = item("2026-03-01", "gas", 1);
    const list = [a, b];
    expect(postingOrder(list)).toEqual([b, a]);
    expect(list).toEqual([a, b]);
  });
});

describe("pointsEvaluator", () => {
  it("matches earnPoints and applies category changes without touching the input", () => {
    const items = [item("2026-03-01", "other", 100), item("2026-03-02", "groceries", 450)];
    const evaluate = pointsEvaluator(grocery, items);
    expect(evaluate()).toBe(earnPoints(grocery, items).transactions.reduce((s, t) => s + t.points, 0));
    expect(evaluate()).toBe(100 + 2250);
    // Moving the $100 line to groceries: 100 × 5, then 400 × 5 + 50 × 1.
    expect(evaluate(new Map([[items[0].transaction.id, "groceries"]]))).toBe(500 + 2050);
    expect(items[0].category).toBe("other");
    expect(evaluate()).toBe(2350);
  });
});

describe("refund matching (docs/decisions.md, Phase 3 rule 1)", () => {
  const at = (date: string, category: "groceries" | "gas" | "other", amount: number, description: string) =>
    item(date, category, amount, { description });

  it("a matched refund reverses what that purchase earned and frees its cap room", () => {
    const r = earnPoints(grocery, [
      at("2026-03-01", "groceries", 200, "LOBLAWS #1"), // 200 × 5 = 1,000
      at("2026-03-02", "groceries", 400, "SOBEYS #2"), // 300 × 5 + 100 × 1 = 1,600 (cap full)
      at("2026-03-03", "groceries", -200, "LOBLAWS #9"), // matches LOBLAWS: −200 × 5 = −1,000, frees 200
      at("2026-03-04", "groceries", 150, "METRO #3"), // room 200: 150 × 5 = 750
    ]);
    expect(r.transactions.map((t) => t.points)).toEqual([1000, 1600, -1000, 750]);
    expect(r.transactions[2]).toMatchObject({
      matched_purchase_id: r.transactions[0].transaction.id,
      refund_confidence: "high",
      bonus_amount: -200,
      after_cap_amount: 0,
    });
    expect(r.caps[0].used).toBe(450);
    // Unmatched, the same refund would reverse the 100 after-cap first: −(100 × 1 + 100 × 5) = −600.
  });

  it("reverses a purchase's own after-cap part first, then its bonus part", () => {
    const r = earnPoints(grocery, [
      at("2026-03-01", "groceries", 700, "LOBLAWS"), // 500 × 5 + 200 × 1 = 2,700
      at("2026-03-02", "groceries", -300, "LOBLAWS"), // 200 × 1 + 100 × 5 = −700
    ]);
    expect(r.transactions.map((t) => t.points)).toEqual([2700, -700]);
    expect(r.transactions[1]).toMatchObject({ bonus_amount: -100, after_cap_amount: -200 });
    expect(r.caps[0].used).toBe(400);
  });

  it("$100 purchase and −$30 matched refund on fake-grocery-cash = 350", () => {
    expect(totalPoints(grocery, [at("2026-03-01", "groceries", 100, "LOBLAWS"), at("2026-03-02", "groceries", -30, "LOBLAWS")])).toBe(350);
  });

  it("handles partial refunds against the same purchase until it is used up", () => {
    const r = earnPoints(grocery, [
      at("2026-03-01", "groceries", 200, "LOBLAWS"),
      at("2026-03-02", "groceries", -50, "LOBLAWS"), // matched, 150 left
      at("2026-03-03", "groceries", -150, "LOBLAWS"), // matched, 0 left
      at("2026-03-04", "groceries", -10, "LOBLAWS"), // nothing left: unmatched
    ]);
    expect(r.transactions.map((t) => [t.points, t.refund_confidence])).toEqual([
      [1000, null], [-250, "high"], [-750, "high"], [-50, "low"],
    ]);
    expect(r.transactions[3].matched_purchase_id).toBeNull();
  });

  it("matches the most recent purchase with enough left, across periods", () => {
    const r = earnPoints(grocery, [
      at("2026-01-10", "groceries", 600, "LOBLAWS"), // Jan: 500 × 5 + 100 × 1
      at("2026-02-10", "groceries", 100, "LOBLAWS"), // Feb: 100 × 5
      at("2026-03-05", "groceries", -300, "LOBLAWS"), // Feb purchase too small: matches Jan (100 × 1 + 200 × 5)
    ]);
    expect(r.transactions[2]).toMatchObject({
      points: -1100,
      matched_purchase_id: r.transactions[0].transaction.id,
      cap_period_key: "2026-01",
    });
    // Points are reduced on the refund's own line, in March; January's cap room is released.
    expect(r.caps.find((c) => c.period_key === "2026-01")?.used).toBe(300);
  });

  it("uses the purchase's rate even if the refund line is categorized differently", () => {
    const r = earnPoints(grocery, [
      at("2026-03-01", "groceries", 100, "CORNER STORE"),
      at("2026-03-02", "other", -100, "CORNER STORE"),
    ]);
    expect(r.transactions[1]).toMatchObject({ points: -500, category: "groceries" });
  });

  it("an unmatched refund (different merchant or too large) uses the period order and is low confidence", () => {
    const r = earnPoints(grocery, [
      at("2026-03-01", "groceries", 100, "LOBLAWS"),
      at("2026-03-02", "groceries", -150, "LOBLAWS"),
      at("2026-03-03", "groceries", -20, "SOBEYS"),
    ]);
    expect(r.transactions.slice(1).map((t) => [t.points, t.refund_confidence, t.matched_purchase_id])).toEqual([
      [-750, "low", null],
      [-100, "low", null],
    ]);
  });

  it("a refund of an unverified purchase stays unverified", () => {
    const r = earnPoints(pointsCard, [
      item("2026-03-01", "gas", 50, { description: "SHELL" }),
      item("2026-03-02", "gas", -20, { description: "SHELL" }),
    ]);
    expect(r.transactions[1]).toMatchObject({ points: 0, unverified_amount: -20, unverified_reason: "cap", refund_confidence: "high" });
  });
});

describe("rounding", () => {
  it("roundPoints rounds halves away from zero", () => {
    expect([roundPoints(21.25), roundPoints(12.5), roundPoints(-2.5), roundPoints(0.49), roundPoints(0)]).toEqual([21, 13, -3, 0, 0]);
  });

  it("isRoundingMode", () => {
    expect([isRoundingMode("per_transaction"), isRoundingMode("per_statement"), isRoundingMode("none"), isRoundingMode(1)])
      .toEqual([true, true, false, false]);
  });

  it("totals per transaction and per statement differ as expected", () => {
    const items = [item("2026-03-01", "gas", 1.4), item("2026-03-02", "gas", 1.4), item("2026-03-03", "gas", 1.4)];
    // 1.4 each: exact 4.2; per line 1 + 1 + 1 = 3; per statement round(4.2) = 4.
    expect(totalPoints(grocery, items)).toBeCloseTo(4.2, 9);
    expect(totalPoints(grocery, items, "per_transaction")).toBe(3);
    expect(totalPoints(grocery, items, "per_statement")).toBe(4);
  });
});
