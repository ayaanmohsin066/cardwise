import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateProgram, valuePerDollar, type Program } from "@/engine";
import { DATA_DIR, FIXTURES_DIR, loadJson } from "../helpers/data-files";

const load = (p: string): Program => {
  const r = validateProgram(loadJson(p));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.program;
};

const cash = load(join(DATA_DIR, "programs", "cash-cad.json"));
const fakePoints = load(join(FIXTURES_DIR, "programs", "fake-points-program.json"));

describe("valuePerDollar", () => {
  it("reads cash-cad as 1 cent per point, so rate 2 is 2%", () => {
    expect(valuePerDollar(2, cash, "cash")).toBeCloseTo(0.02, 10);
    expect(valuePerDollar(1, cash, "cash")).toBeCloseTo(0.01, 10);
  });

  it("applies the redemption's cents_per_point", () => {
    expect(valuePerDollar(3, fakePoints, "statement_credit")).toBeCloseTo(0.03, 10);
    expect(valuePerDollar(3, fakePoints, "travel_transfer")).toBeCloseTo(0.06, 10);
  });

  it("returns 0 for a zero rate", () => {
    expect(valuePerDollar(0, cash, "cash")).toBe(0);
  });

  it("returns null when the rate is unverified", () => {
    expect(valuePerDollar(null, cash, "cash")).toBeNull();
  });

  it("returns null when the redemption value is unverified", () => {
    const p: Program = {
      id: "p",
      name: "P",
      redemptions: [{ method: "m", cents_per_point: null, is_estimate: false, notes: null }],
    };
    expect(valuePerDollar(5, p, "m")).toBeNull();
  });

  it("throws on an unknown redemption method", () => {
    expect(() => valuePerDollar(1, cash, "gift_cards")).toThrow(
      'Program "cash-cad" has no redemption method "gift_cards"',
    );
  });
});
