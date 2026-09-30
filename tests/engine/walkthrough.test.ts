// The Phase 3 walkthrough statement (tests/fixtures/statements/phase3-walkthrough.csv)
// on fake-points: travel 3×, gas/transit unverified, else 1×; $100/yr travel credit.
import { describe, expect, it } from "vitest";
import { categorizeAll, classifyStatementCredits, computeBenefits, reconcile } from "@/engine";
import { fixtureCard, program } from "../helpers/cards";
import { ingestStatement, seededRules } from "../helpers/statements";

const card = fixtureCard("fake-points");
const items = categorizeAll(classifyStatementCredits(card, ingestStatement("phase3-walkthrough.csv").transactions), seededRules());
const report = computeBenefits({ card, program: program("fake-points-program"), items });
const line = (d: string) =>
  report.transactions.find((t) => t.transaction.description.startsWith(d) && t.transaction.amount_cad < 0);

describe("phase3-walkthrough.csv", () => {
  it("classifies the credit, payment and interest lines", () => {
    expect(items.map((i) => i.transaction.kind)).toEqual([
      "purchase", "purchase", "purchase", "purchase", "purchase", "refund", "refund", "credit", "payment", "interest",
    ]);
  });

  it("matches the AIR CANADA refund and not the EXPEDIA one", () => {
    expect(line("AIR CANADA")).toMatchObject({ points: -150, refund_confidence: "high" });
    expect(line("EXPEDIA")).toMatchObject({ points: -90, refund_confidence: "low", matched_purchase_id: null });
  });

  it("counts the posted credit once and shows interest separately", () => {
    expect(report.credits[0]).toMatchObject({ method: "posted", used: 80, remaining: 20 });
    expect(report.fees.interest).toBe(5.55);
    // 80 + 600 − 150 − 90 + 10.30 + 16.49 + 4.35 = 471.14 points.
    expect(report.points_total).toBeCloseTo(471.14, 9);
  });

  it("matches a statement of 471 only under per-statement rounding", () => {
    const r = reconcile(card, items, 471);
    expect(r.totals.per_transaction).toBe(470);
    expect(r).toMatchObject({ status: "matched", rounding_mode: "per_statement" });
    expect(reconcile(card, items, 470).rounding_mode).toBe("per_transaction");
  });
});
