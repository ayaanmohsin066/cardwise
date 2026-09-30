// The Web Worker's computation, run in Node with the Node solver.
import { describe, expect, it } from "vitest";
import type { CategorizedTransaction } from "@/engine";
import { runRecommendations, type Stage } from "../../src/app/lib/run-recommendations";
import { fixtureCard, item, program } from "../helpers/cards";
import { getSolver } from "../helpers/solver";

describe("runRecommendations", () => {
  it("returns all three results and reports progress in order", async () => {
    const solver = await getSolver();
    const cash = program("cash-cad");
    const e = (id: string) => ({ card: fixtureCard(id), program: cash });
    const items: [string, CategorizedTransaction[]][] = [
      ["fake-flat-cash", [item("2026-01-05", "groceries", 400, { description: "LOBLAWS" })]],
      ["fake-grocery-cash", [item("2026-01-06", "gas", 100, { description: "SHELL" })]],
    ];
    const stages: Stage[] = [];
    const r = runRecommendations(
      { owned: [e("fake-flat-cash"), e("fake-grocery-cash")], items, catalogue: [e("fake-shared-cap"), e("fake-flat-cash")] },
      solver,
      (stage) => { if (stages[stages.length - 1] !== stage) stages.push(stage); },
    );
    expect(stages).toEqual(["your_cards", "comparing"]);
    expect(r.better.gain_annual).toBeCloseTo(156, 6);
    // Two cards held: replace either one, or add (owned cards in the catalogue are skipped).
    expect(r.change.changes.map((c) => c.action).sort()).toEqual(["add", "replace", "replace"]);
    expect(r.change.changes.every((c) => c.add === "fake-shared-cap")).toBe(true);
    expect(r.sens).not.toBeNull();
    // Results cross the worker boundary by structured clone.
    expect(() => structuredClone(r)).not.toThrow();
  });
});
