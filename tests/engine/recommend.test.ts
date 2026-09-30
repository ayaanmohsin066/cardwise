import { describe, expect, it } from "vitest";
import {
  changeACard,
  projection,
  rankingStability,
  sensitivity,
  bestUseOfCards,
  type CardSetEntry,
  type CategorizedTransaction,
} from "@/engine";
import { fixtureCard, item, program } from "../helpers/cards";
import { getSolver } from "../helpers/solver";

const cash = program("cash-cad");
const fp = program("fake-points-program");
const e = (id: string): CardSetEntry => {
  const card = fixtureCard(id);
  return { card, program: card.program_id === "cash-cad" ? cash : fp };
};

describe("projection", () => {
  it("annualizes from months and warns under 3 months", () => {
    expect(projection(1)).toEqual({ months: 1, factor: 12, short_data: true });
    expect(projection(3)).toEqual({ months: 3, factor: 4, short_data: false });
  });
});

describe("rankingStability (legacy bug 4: the base case is not a scenario)", () => {
  it("scores 0 when every perturbed scenario changes the ranking, not 1/(n+1)", () => {
    const r = rankingStability(["a", "b"], [["b", "a"], ["b", "a"]]);
    expect(r).toEqual({ scenarios: 2, held: 0, share: 0 });
  });

  it("counts only perturbed scenarios", () => {
    expect(rankingStability(["a", "b"], [["a", "b"], ["b", "a"], ["a", "b"]])).toEqual({ scenarios: 3, held: 2, share: 2 / 3 });
    expect(rankingStability(["a"], [])).toEqual({ scenarios: 0, held: 0, share: null });
  });
});

describe("bestUseOfCards", () => {
  it("finds the better routing and the per-category gains (hand-computed)", async () => {
    const solver = await getSolver();
    // Groceries went on the 2% card and gas on the 5%-groceries card: backwards.
    const items = new Map<string, CategorizedTransaction[]>([
      ["fake-flat-cash", [item("2026-01-05", "groceries", 400, { description: "LOBLAWS" })]],
      ["fake-grocery-cash", [item("2026-01-06", "gas", 100, { description: "SHELL" })]],
    ]);
    const r = bestUseOfCards([e("fake-flat-cash"), e("fake-grocery-cash")], items, solver);
    expect(r.status).toBe("ok");
    expect(r.projection).toEqual({ months: 1, factor: 12, short_data: true });
    // Current: 400 × 2% + 100 × 1% − 8.33; suggested: 400 × 5% + 100 × 2% − 8.33. Gain 13/month = 156/year.
    expect(r.gain_annual).toBeCloseTo(156, 6);
    expect(r.moves.map((m) => [m.category, Math.round(m.gain_annual * 100) / 100])).toEqual([["groceries", 144], ["gas", 12]]);
    expect(r.moves[0].current).toEqual([{ card_id: "fake-flat-cash", spend: 400 }]);
    expect(r.moves[0].suggested).toEqual([{ card_id: "fake-grocery-cash", spend: 400 }]);
  });

  it("leaves out an unverified owned card, and says why", async () => {
    const solver = await getSolver();
    const items = new Map<string, CategorizedTransaction[]>([
      ["fake-flat-cash", [item("2026-01-05", "groceries", 100)]],
      ["fake-points", [item("2026-01-06", "gas", 50)]],
    ]);
    const r = bestUseOfCards([e("fake-flat-cash"), e("fake-points")], items, solver);
    expect(r.excluded).toEqual([{ card_id: "fake-points", name: "FAKE Points Card", reasons: ["its gas spending cap is not yet verified"] }]);
    expect(r.suggested?.cards.map((c) => c.card_id)).toEqual(["fake-flat-cash"]);
  });
});

describe("credit capture in recommendations", () => {
  it("a card whose category the LP routes elsewhere still captures its credit", async () => {
    const solver = await getSolver();
    // "other" earns 2% on the flat card and 1× (1¢) on the points card, so the LP routes it to the flat card.
    // FAKE AIR is "other" but matches the points card's $100/year credit: it should go there first.
    const items = new Map<string, CategorizedTransaction[]>([
      ["fake-flat-cash", [item("2026-01-05", "other", 80, { description: "FAKE AIR 123" }), item("2026-01-06", "other", 200, { description: "CORNER STORE" })]],
      ["fake-points", [item("2026-01-07", "travel", 100, { description: "AIR CANADA" })]],
    ]);
    const r = bestUseOfCards([e("fake-flat-cash"), e("fake-points")], items, solver);
    expect(r.policy.find((p) => p.category === "other")!.steps[0].card_id).toBe("fake-flat-cash");
    expect(r.credit_rules).toEqual([expect.objectContaining({ card_id: "fake-points", limit: 100, period: "year" })]);
    const points = r.suggested!.cards.find((c) => c.card_id === "fake-points")!;
    expect(points.report.credits[0]).toMatchObject({ used: 80, method: "estimated" });
    // On the flat card the credit was missed: moving FAKE AIR captures $80 (capped at $100/year when annualized).
    expect(r.current!.cards.find((c) => c.card_id === "fake-points")!.report.credits_total).toBe(0);
    expect(r.gain_annual).toBeGreaterThan(0);
    // The captured credit is its own line, and the parts add up to the total.
    expect(r.credit_gain_annual).toBeCloseTo(100, 9); // $80 in one month, capped at $100/year
    const parts = r.moves.reduce((t, m) => t + m.gain_annual, 0) + r.credit_gain_annual + r.other_gain_annual;
    expect(parts).toBeCloseTo(r.gain_annual, 9);
  });
});

describe("changeACard", () => {
  const solverP = getSolver();
  const items = new Map<string, CategorizedTransaction[]>([["fake-flat-cash", [item("2026-01-05", "groceries", 400, { description: "LOBLAWS" })]]]);
  const catalogue = ["fake-grocery-cash", "fake-shared-cap", "fake-points"].map(e);

  it("ranks replacements and additions by ongoing gain after fees (hand-computed)", async () => {
    const r = changeACard([e("fake-flat-cash")], items, catalogue, await solverP);
    // Baseline: 400 × 2% = $8/month = $96/year.
    expect(r.baseline_annual).toBeCloseTo(96, 6);
    const gain = (remove: string | null, add: string) => {
      const c = r.changes.find((x) => x.remove === remove && x.add === add)!;
      return [Math.round(c.ongoing.gain_annual * 100) / 100, Math.round(c.first_year.gain_annual * 100) / 100];
    };
    // Shared-cap card: groceries 4%, no fee: $16/month -> +$96/year.
    expect(gain(null, "fake-shared-cap")).toEqual([96, 96]);
    expect(gain("fake-flat-cash", "fake-shared-cap")).toEqual([96, 96]);
    // Grocery card: 5% − $100 fee: 20 − 8.33 -> 140/year, +44.
    expect(gain(null, "fake-grocery-cash")[0]).toBeCloseTo(44, 6);
    // Points card: 1× groceries, $120 fee (first year $0, $100 bonus for $1,000 in 3 months, paced).
    // Ongoing, added: groceries stay on the 2% card, fee −$10/month -> −$120/year.
    expect(gain(null, "fake-points")[0]).toBeCloseTo(-120, 6);
    // First year, added: $0 fee; putting the $400 on it to hit the $333 pace wins the $100 bonus: 4 × 12 + 100 − 96 = +52.
    expect(gain(null, "fake-points")[1]).toBeCloseTo(52, 6);
    expect(r.changes[0].add).toBe("fake-shared-cap");
    // Everything already sits on the only card: no routing gain, so totals equal the card-change gains.
    expect(r.routing_gain_annual).toBeCloseTo(0, 9);
    expect(r.changes.every((c) => Math.abs(c.ongoing.total_gain_annual - c.ongoing.gain_annual) < 1e-9)).toBe(true);
    const pts = r.changes.find((x) => x.remove === null && x.add === "fake-points")!;
    expect(pts.first_year).toMatchObject({ bonus_pursued: true, bonus_projected: true, bonus_value: 100 });
  });

  it("does not offer additions when 3 cards are held, and lists unverified catalogue cards", async () => {
    const three = new Map<string, CategorizedTransaction[]>([
      ["fake-flat-cash", [item("2026-01-05", "gas", 100)]],
      ["fake-grocery-cash", []],
      ["fake-shared-cap", []],
    ]);
    const r = changeACard([e("fake-flat-cash"), e("fake-grocery-cash"), e("fake-shared-cap")], three, [e("fake-points")], await solverP);
    expect(r.changes.every((c) => c.action === "replace")).toBe(true);
    expect(r.changes).toHaveLength(0);
    expect(r.excluded).toEqual([{ card_id: "fake-points", name: "FAKE Points Card", reasons: ["its gas spending cap is not yet verified"] }]);
  });
});

describe("gain breakdown", () => {
  it("routing gain + card-change gain = total gain versus actual use", async () => {
    const solver = await getSolver();
    // Misrouted: groceries on the 2% card, gas on the 5%-groceries card.
    const items = new Map<string, CategorizedTransaction[]>([
      ["fake-flat-cash", [item("2026-01-05", "groceries", 400, { description: "LOBLAWS" })]],
      ["fake-grocery-cash", [item("2026-01-06", "gas", 100, { description: "SHELL" })]],
    ]);
    const owned = [e("fake-flat-cash"), e("fake-grocery-cash")];
    const better = bestUseOfCards(owned, items, solver);
    const change = changeACard(owned, items, [e("fake-shared-cap")], solver);
    expect(change.routing_gain_annual).toBeCloseTo(better.gain_annual, 9);
    expect(change.routing_gain_annual).toBeCloseTo(156, 6);
    for (const c of change.changes) {
      expect(c.ongoing.total_gain_annual).toBeCloseTo(change.routing_gain_annual + c.ongoing.gain_annual, 9);
      expect(c.ongoing.total_annual - change.actual_annual).toBeCloseTo(c.ongoing.total_gain_annual, 9);
      expect(c.first_year.total_gain_annual).toBeCloseTo(change.routing_gain_annual + c.first_year.gain_annual, 9);
    }
  });
});

describe("sensitivity", () => {
  it("varies each program across its verified range and never counts the base case", async () => {
    const solver = await getSolver();
    const items = new Map<string, CategorizedTransaction[]>([["fake-flat-cash", [item("2026-01-05", "travel", 400, { description: "AIR CANADA" })]]]);
    const catalogue = ["fake-points", "fake-shared-cap"].map(e);
    const ch = changeACard([e("fake-flat-cash")], items, catalogue, solver);
    const top = ch.changes.slice(0, 3);
    const s = sensitivity(top, [e("fake-flat-cash")], items, catalogue, solver);
    // fake-points-program: 1¢ (statement_credit) to 2¢ (travel_transfer) -> 2 scenarios. cash-cad has one value -> none.
    expect(s.scenarios).toBe(2);
    expect(s.details.map((d) => [d.program_id, d.bound, d.method])).toEqual([
      ["fake-points-program", "low", "statement_credit"],
      ["fake-points-program", "high", "travel_transfer"],
    ]);
    expect(s.held).toBe(s.details.filter((d) => d.held).length);
    expect(s.share).toBe(s.held / 2);
  });
});
