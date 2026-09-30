import { describe, expect, it } from "vitest";
import { bruteForceBest, solveRouting, type CardSetEntry, type SpendCell } from "@/engine";
import { fixtureCard, program } from "../helpers/cards";
import { getSolver } from "../helpers/solver";

const cash = program("cash-cad");
const fp = program("fake-points-program");
const entry = (id: string): CardSetEntry => {
  const card = fixtureCard(id);
  return { card, program: card.program_id === "cash-cad" ? cash : fp };
};
const CARDS = ["fake-flat-cash", "fake-grocery-cash", "fake-shared-cap", "fake-points"];
const CATS = ["groceries", "dining", "travel", "other"] as const; // no gas/transit: fake-points has them unverified

/** Small deterministic PRNG (mulberry32) so failures are reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("bruteForceBest", () => {
  it("matches the LP on a case the grid can reach exactly", async () => {
    const solver = await getSolver();
    const set = [entry("fake-flat-cash"), entry("fake-grocery-cash")];
    const cells: SpendCell[] = [{ category: "groceries", month: "2026-01", foreign: false, net: 1000 }];
    // Best: 500 on the 5% card (grid 2 = halves), 500 on the 2% card: 25 + 10 − 100/12.
    expect(bruteForceBest(set, cells, 2)).toBeCloseTo(35 - 100 / 12, 9);
    expect(solveRouting(set, cells, "ongoing", solver).cases[0].upper_bound).toBeCloseTo(35 - 100 / 12, 6);
  });

  it("refuses cases too large to enumerate and unusable cards", () => {
    const cells: SpendCell[] = Array.from({ length: 6 }, (_, i) => ({ category: "other", month: "2026-01", foreign: i % 2 === 1, net: 10 + i }));
    expect(() => bruteForceBest([entry("fake-flat-cash"), entry("fake-grocery-cash"), entry("fake-shared-cap")], cells, 8, "ongoing", 1000)).toThrow("Too many");
    expect(() => bruteForceBest([entry("fake-points")], [{ category: "gas", month: "2026-01", foreign: false, net: 5 }])).toThrow("not usable");
  });
});

describe("property: the LP is never beaten by an exhaustive grid search", () => {
  it("holds on 40 random small cases", async () => {
    const solver = await getSolver();
    const rand = rng(20260930);
    for (let n = 0; n < 40; n++) {
      const k = 1 + Math.floor(rand() * 3);
      const ids = [...CARDS].sort(() => rand() - 0.5).slice(0, k);
      const cellCount = 1 + Math.floor(rand() * 3);
      const cells: SpendCell[] = [];
      for (let i = 0; i < cellCount; i++) {
        const category = CATS[Math.floor(rand() * CATS.length)];
        const month = rand() < 0.7 ? "2026-01" : "2026-02";
        const foreign = rand() < 0.2;
        if (cells.some((c) => c.category === category && c.month === month && c.foreign === foreign)) continue;
        cells.push({ category, month, foreign, net: Math.round(50 + rand() * 850) });
      }
      const set = ids.map(entry);
      const lp = solveRouting(set, cells, "ongoing", solver);
      expect(lp.status, `case ${n}`).toBe("ok");
      const brute = bruteForceBest(set, cells, 4);
      expect(lp.cases[0].upper_bound, `case ${n}: ${ids.join(",")} ${JSON.stringify(cells)}`).toBeGreaterThanOrEqual(brute - 1e-6);
    }
  });
});
