// "Change a card" at catalogue scale: 100 synthetic FAKE cards, 3 owned cards.
import { describe, expect, it } from "vitest";
import { changeACard, pruneCatalogue, spendCells } from "@/engine";
import { getSolver } from "../helpers/solver";
import { syntheticCatalogue, syntheticOwned } from "../helpers/synthetic";

const top = (r: ReturnType<typeof changeACard>, key: "ongoing" | "first_year") => {
  const best = [...r.changes].sort((a, b) => b[key].gain_annual - a[key].gain_annual)[0];
  return best && { remove: best.remove, add: best.add, gain: Math.round(best[key].gain_annual * 100) / 100 };
};

describe("change a card: benchmark", () => {
  it("100 synthetic cards × 3 owned cards finishes well under 5 s", async () => {
    const solver = await getSolver();
    const catalogue = syntheticCatalogue(100, 1);
    for (const perMonth of [40, 100]) {
      const { owned, itemsByCard } = syntheticOwned(7, perMonth);
      const t = performance.now();
      const r = changeACard(owned, itemsByCard, catalogue, solver);
      const ms = performance.now() - t;
      console.log(`change a card: 100 cards, 3 owned, ${perMonth * 3} transactions: ${Math.round(ms)} ms, ${r.changes.length} changes`);
      expect(r.changes).toHaveLength(300);
      expect(ms).toBeLessThan(5_000);
    }
  }, 60_000);
});

describe("pruneCatalogue", () => {
  it("keeps cards that beat a rate, have a bonus or credit, or cost less; drops the rest", () => {
    const catalogue = syntheticCatalogue(100, 1);
    const { owned, itemsByCard } = syntheticOwned(7);
    const cells = spendCells([...itemsByCard.values()].flat());
    const { keep, pruned } = pruneCatalogue(catalogue, owned, cells);
    expect(keep.length + pruned.length).toBe(100);
    expect(pruned.length).toBeGreaterThan(0);
    for (const id of pruned) {
      const c = catalogue.find((x) => x.card.id === id)!.card;
      expect(c.welcome_bonus?.length ?? 0).toBe(0);
      expect(c.purchase_credits?.length ?? 0).toBe(0);
    }
  });

  it("never drops the true best result on the synthetic set", async () => {
    const solver = await getSolver();
    for (const [catSeed, spendSeed] of [[1, 7], [2, 11], [3, 13]]) {
      const catalogue = syntheticCatalogue(100, catSeed);
      const { owned, itemsByCard } = syntheticOwned(spendSeed);
      const full = changeACard(owned, itemsByCard, catalogue, solver);
      const pruned = changeACard(owned, itemsByCard, catalogue, solver, { prune: true });
      expect(pruned.pruned.length, `seed ${catSeed}`).toBeGreaterThan(0);
      expect(top(pruned, "ongoing"), `seed ${catSeed}`).toEqual(top(full, "ongoing"));
      expect(top(pruned, "first_year"), `seed ${catSeed}`).toEqual(top(full, "first_year"));
    }
  }, 120_000);
});
