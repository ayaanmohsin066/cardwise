import { describe, expect, it } from "vitest";
import { reconcile, totalPoints, type CategorizedTransaction } from "@/engine";
import { fixtureCard, item } from "../helpers/cards";

const grocery = fixtureCard("fake-grocery-cash"); // groceries/dining 5 (cap $500/month, then 1), else 1
const flat = fixtureCard("fake-flat-cash"); // 2 on everything
const pointsCard = fixtureCard("fake-points"); // travel 3, gas/transit unverified, else 1

const low = (date: string, amount: number, description: string, category: CategorizedTransaction["category"] = "other") =>
  item(date, category, amount, { confidence: "low", description });

describe("reconcile", () => {
  it("does nothing without a statement total", () => {
    const r = reconcile(grocery, [item("2026-03-01", "gas", 10)], null);
    expect(r).toMatchObject({ status: "no_statement_total", estimated_points: 10, difference: null, suggestions: [] });
  });

  describe("rounding modes", () => {
    // Three $1.40 gas lines at 1×: exact 4.2, per line 1 + 1 + 1 = 3, per statement round(4.2) = 4.
    const items = () => [item("2026-03-01", "gas", 1.4), item("2026-03-02", "gas", 1.4), item("2026-03-03", "gas", 1.4)];

    it("matches exactly under per-transaction rounding and reports the mode", () => {
      const r = reconcile(grocery, items(), 3);
      expect(r).toMatchObject({ status: "matched", rounding_mode: "per_transaction", estimated_points: 3, difference: 0 });
      expect(r.totals.per_transaction).toBe(3);
      expect(r.totals.per_statement).toBe(4);
      expect(r.totals.exact).toBeCloseTo(4.2, 9);
    });

    it("matches exactly under per-statement rounding", () => {
      expect(reconcile(grocery, items(), 4)).toMatchObject({ status: "matched", rounding_mode: "per_statement", estimated_points: 4 });
    });

    it("tries the stored mode first when both modes give the same total", () => {
      const same = [item("2026-03-01", "gas", 2), item("2026-03-02", "gas", 3)];
      expect(reconcile(grocery, same, 5).rounding_mode).toBe("per_transaction");
      expect(reconcile(grocery, same, 5, { rounding_mode: "per_statement" }).rounding_mode).toBe("per_statement");
    });

    it("falls back to the tolerance only when neither mode matches", () => {
      // exact 4.2; statement 4.5 is neither 3 nor 4, but within the fallback tolerance.
      const r = reconcile(grocery, items(), 4.5);
      expect(r).toMatchObject({ status: "matched", rounding_mode: null, tolerance: 1.5 });
      expect(r.difference).toBeCloseTo(0.3, 9);
    });

    it("searches using the stored rounding mode", () => {
      const lines = [low("2026-03-01", 10.3, "FRESH MARKET"), item("2026-03-02", "gas", 1.4)];
      // Per line: 10.3 × 5 = 51.5 -> 52, plus 1.4 -> 1: 53 if the $10.30 line were groceries.
      const r = reconcile(grocery, lines, 53, { rounding_mode: "per_transaction", tolerance: 0 });
      expect(r.status).toBe("explained");
      expect(r.remaining_difference).toBe(0);
      expect(r.estimated_points).toBe(11);
    });
  });

  it("suggests the category change that closes the gap", () => {
    const items = [
      item("2026-03-01", "gas", 50),
      low("2026-03-02", 100, "FRESH MARKET 22"),
      low("2026-03-03", 40, "CORNER SHOP"),
    ];
    // Estimated: 50 + 100 + 40 = 190. Statement: 590, i.e. the $100 line earned 5×.
    const r = reconcile(grocery, items, 590);
    expect(r.status).toBe("explained");
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({ description: "FRESH MARKET 22", from: "other", points_change: 400 });
    expect(["groceries", "dining"]).toContain(r.suggestions[0].to);
    expect(r.remaining_difference).toBe(0);
    expect(r.other_causes).toEqual([]);
  });

  it("combines several changes, up to the limit, respecting the cap", () => {
    const items = [
      low("2026-03-01", 100, "A"),
      low("2026-03-02", 100, "B"),
      low("2026-03-03", 100, "C"),
      low("2026-03-04", 100, "D"),
      low("2026-03-05", 100, "E"),
      low("2026-03-06", 100, "F"),
    ];
    // All 6 at 5× would be 600 over a $500 cap: 500 × 5 + 100 × 1 = 2,600.
    // With at most 5 changes: 5 × 500 + 100 = 2,600 too, so 5 suffice.
    const r = reconcile(grocery, items, 2600);
    expect(r.status).toBe("explained");
    expect(r.suggestions.length).toBeLessThanOrEqual(5);
    expect(totalPoints(grocery, items) + r.suggestions.reduce((s, x) => s + x.points_change, 0)).toBe(2600);
    const limited = reconcile(grocery, items, 2600, { max_changes: 2 });
    expect(limited.suggestions).toHaveLength(2);
    expect(limited.status).toBe("partly_explained");
    expect(limited.remaining_difference).toBe(2600 - (600 + 800));
  });

  it("only suggests categories with a different, verified rate", () => {
    // fake-flat-cash earns 2 everywhere: no category change can help.
    const r = reconcile(flat, [low("2026-03-01", 100, "X")], 500);
    expect(r).toMatchObject({ status: "unexplained", suggestions: [] });
    expect(r.other_causes).toEqual(["promo_points", "posting_timing", "rounding"]);

    // fake-points: gas/transit are unverified, so never suggested.
    const p = reconcile(pointsCard, [low("2026-03-01", 100, "X")], 300);
    expect(p.suggestions.map((s) => s.to)).toEqual(["travel"]);
  });

  it("never touches high-confidence lines", () => {
    const r = reconcile(grocery, [item("2026-03-01", "other", 100)], 500);
    expect(r).toMatchObject({ status: "unexplained", suggestions: [] });
  });

  it("lists other causes, including prior-period refunds and unverified terms", () => {
    const r = reconcile(pointsCard, [item("2026-03-01", "gas", 100), item("2026-03-02", "travel", -10)], 500);
    expect(r.other_causes).toEqual([
      "promo_points", "posting_timing", "prior_period_refunds", "rounding", "unverified_terms", "welcome_bonus",
    ]);
  });

  it("reduces points too (statement lower than estimate)", () => {
    const items = [low("2026-03-01", 100, "MISFILED", "groceries"), item("2026-03-02", "gas", 10)];
    // Estimated 510; statement 110 means the $100 line earned 1×.
    const r = reconcile(grocery, items, 110);
    expect(r.status).toBe("explained");
    expect(r.suggestions[0]).toMatchObject({ from: "groceries", points_change: -400 });
  });

  it("terminates quickly on 500 transactions and stays within its evaluation budget", () => {
    const items: CategorizedTransaction[] = [];
    for (let i = 0; i < 500; i++) {
      const day = String((i % 28) + 1).padStart(2, "0");
      const month = String((i % 3) + 1).padStart(2, "0");
      items.push(i % 2 === 0 ? low(`2026-${month}-${day}`, 10 + (i % 37), `SHOP ${i}`) : item(`2026-${month}-${day}`, "gas", 5 + (i % 11)));
    }
    const started = performance.now();
    const r = reconcile(grocery, items, totalPoints(grocery, items) + 1234.5, { max_evaluations: 20_000 });
    const elapsed = performance.now() - started;
    expect(r.evaluations).toBeLessThanOrEqual(20_000 + 10);
    expect(r.suggestions.length).toBeLessThanOrEqual(5);
    expect(elapsed).toBeLessThan(5_000);
  });
});
