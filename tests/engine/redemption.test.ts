import { describe, expect, it } from "vitest";
import { redemptionValues, type Program } from "@/engine";
import { program } from "../helpers/cards";

const fake = program("fake-points-program"); // statement_credit 1¢ (fixed), travel_transfer 2¢ (estimate)
const base = { id: "p", name: "P", source_url: "https://example.com/p", last_verified: "2026-01-01" };
const r = (method: string, cents_per_point: number | null, is_estimate = false, notes: string | null = null) => ({
  method, cents_per_point, is_estimate, notes,
});

describe("redemptionValues", () => {
  it("values a balance under each method, labels estimates with their basis", () => {
    const rep = redemptionValues(fake, 10000);
    expect(rep.kind).toBe("points");
    if (rep.kind !== "points") return;
    expect(rep.options).toEqual([
      { method: "travel_transfer", value: 200, is_estimate: true, basis: "FAKE: illustrative estimate for tests." },
      { method: "statement_credit", value: 100, is_estimate: false, basis: null },
    ]);
    // Only one firm method: nothing to compare it against, but the higher estimate is flagged.
    expect(rep.best?.method).toBe("statement_credit");
    expect(rep.lowest).toBeNull();
    expect(rep.gap).toBeNull();
    expect(rep.higher_estimate?.method).toBe("travel_transfer");
  });

  it("highlights the best verified method and the gap to the lowest", () => {
    const p: Program = { ...base, redemptions: [r("gift_cards", 0.7), r("travel", 1.2), r("statement_credit", 0.6), r("merch", null)] };
    const rep = redemptionValues(p, 50000);
    if (rep.kind !== "points") throw new Error("expected points");
    expect(rep.options.map((o) => [o.method, o.value])).toEqual([
      ["travel", 600], ["gift_cards", 350], ["statement_credit", 300], ["merch", null],
    ]);
    expect([rep.best?.method, rep.lowest?.method, rep.gap]).toEqual(["travel", "statement_credit", 300]);
    expect(rep.unverified_count).toBe(1);
    expect(rep.higher_estimate).toBeNull();
  });

  it("never makes an estimate the headline, even when it is the only valued method", () => {
    const p: Program = { ...base, redemptions: [r("transfer", 2, true, "Based on X."), r("cash", null)] };
    const rep = redemptionValues(p, 1000);
    if (rep.kind !== "points") throw new Error("expected points");
    expect(rep.best).toBeNull();
    expect(rep.higher_estimate?.method).toBe("transfer");
  });

  it("shows dollars only for cash-back cards", () => {
    expect(redemptionValues(program("cash-cad"), 42.5)).toEqual({ kind: "cash", balance: 42.5 });
  });

  it("is unverified without a program or methods", () => {
    expect(redemptionValues(null, 100).kind).toBe("unverified");
    expect(redemptionValues({ ...base, redemptions: [] }, 100).kind).toBe("unverified");
  });
});
