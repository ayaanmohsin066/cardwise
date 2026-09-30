import { describe, expect, it } from "vitest";
import {
  bonusTargets,
  earnOptions,
  monthsSpanned,
  resolveCard,
  solveRouting,
  spendCells,
  type CardSetEntry,
  type SpendCell,
} from "@/engine";
import { fixtureCard, item, program } from "../helpers/cards";
import { getSolver } from "../helpers/solver";

const cash = program("cash-cad");
const fp = program("fake-points-program");
const entry = (id: string, over: Partial<CardSetEntry> = {}): CardSetEntry => {
  const card = fixtureCard(id);
  return { card, program: card.program_id === "cash-cad" ? cash : fp, ...over };
};
const flat = () => entry("fake-flat-cash"); // 2% everything, no fee, FX 2.5%
const grocery = () => entry("fake-grocery-cash"); // groceries+dining 5% to $500/mo then 1%, else 1%, $100 fee
const shared = () => entry("fake-shared-cap"); // groceries 4%, dining 2%, shared $1,000/mo, then 1%; no fee
const points = () => entry("fake-points"); // travel 3, gas/transit unverified, else 1; 1¢ fixed

const cell = (category: SpendCell["category"], net: number, month = "2026-01", foreign = false): SpendCell => ({ category, month, foreign, net });

describe("spendCells / monthsSpanned", () => {
  it("nets purchases and refunds per category, month and foreign flag", () => {
    const cells = spendCells([
      item("2026-01-05", "groceries", 100),
      item("2026-01-20", "groceries", -30),
      item("2026-01-21", "groceries", 50, { is_foreign: true }),
      item("2026-03-02", "gas", 40),
      item("2026-01-03", null, -500, { kind: "payment" }),
      item("2026-01-04", null, 120, { kind: "fee" }),
    ]);
    expect(cells).toEqual([
      { category: "groceries", month: "2026-01", foreign: false, net: 70 },
      { category: "groceries", month: "2026-01", foreign: true, net: 50 },
      { category: "gas", month: "2026-03", foreign: false, net: 40 },
    ]);
    expect(monthsSpanned(cells)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(monthsSpanned([])).toEqual([]);
  });
});

describe("resolveCard", () => {
  it("resolves a fully verified card", () => {
    const r = resolveCard(grocery(), [cell("groceries", 100)], "ongoing");
    expect(r).toMatchObject({ ok: true, fee: 100, fx: 0.025 });
  });

  it("excludes a card with an unverified term the spend needs, and says why", () => {
    expect(resolveCard(points(), [cell("gas", 50)], "ongoing")).toEqual({
      ok: false, card_id: "fake-points", name: "FAKE Points Card", reasons: ["its gas spending cap is not yet verified"],
    });
    // No gas/transit spend: the unverified gas cap doesn't matter.
    expect(resolveCard(points(), [cell("travel", 50)], "ongoing").ok).toBe(true);
  });

  it("lists every unverified term, never assuming a value", () => {
    const c = fixtureCard("fake-grocery-cash");
    const r = resolveCard(
      { card: { ...c, annual_fee: null, fx_fee_pct: null, earn_rules: [{ ...c.earn_rules![0], after_cap_rate: null }] }, program: null },
      [cell("groceries", 10), cell("dining", 5, "2026-01", true)],
      "ongoing",
    );
    expect(r).toMatchObject({
      ok: false,
      reasons: [
        "its points program is not yet verified",
        "its annual fee is not yet verified",
        "its rate after the groceries cap is not yet verified",
        "its rate after the dining cap is not yet verified",
        "its foreign transaction fee is not yet verified",
      ],
    });
  });

  it("checks first-year terms only for new cards in first-year mode", () => {
    const c = fixtureCard("fake-grocery-cash");
    const e = { card: { ...c, first_year_fee: null, welcome_bonus: null }, program: cash };
    expect(resolveCard(e, [cell("groceries", 10)], "ongoing").ok).toBe(true);
    expect(resolveCard(e, [cell("groceries", 10)], "first_year").ok).toBe(true);
    expect(resolveCard({ ...e, is_new: true }, [cell("groceries", 10)], "first_year")).toMatchObject({
      ok: false, reasons: ["its first-year fee is not yet verified", "its welcome bonus is not yet verified"],
    });
  });
});

describe("earnOptions", () => {
  it("values tiers through valuePerDollar and subtracts embedded FX cost", () => {
    const r = resolveCard(grocery(), [cell("groceries", 1)], "ongoing");
    if (!r.ok) throw new Error("expected ok");
    expect(earnOptions(r, "groceries", false)).toEqual([
      { card_id: "fake-grocery-cash", tier: "bonus", cap: { id: "groceries-dining-monthly", amount: 500, period: "month" }, value: 0.05 },
      { card_id: "fake-grocery-cash", tier: "after", cap: null, value: 0.01 },
    ]);
    const foreign = earnOptions(r, "gas", true);
    expect(foreign).toHaveLength(1);
    expect(foreign[0].value).toBeCloseTo(0.01 - 0.025 / 1.025, 12);
  });
});

describe("solveRouting", () => {
  it("routes groceries to the 5% card up to its cap, the rest and gas to the 2% card", async () => {
    const solver = await getSolver();
    const r = solveRouting([flat(), grocery()], [cell("groceries", 700), cell("gas", 300)], "ongoing", solver);
    expect(r).toMatchObject({ status: "ok", cards: ["fake-flat-cash", "fake-grocery-cash"], excluded: [] });
    const c = r.cases[0];
    // 500 × 5% + 200 × 2% + 300 × 2% = 35, minus 100 × 1/12 fee.
    expect(c.upper_bound).toBeCloseTo(35 - 100 / 12, 6);
    const amount = (card: string, cat: string) => c.allocation.find((a) => a.card_id === card && a.category === cat)?.amount ?? 0;
    expect(amount("fake-grocery-cash", "groceries")).toBeCloseTo(500, 6);
    expect(amount("fake-flat-cash", "groceries")).toBeCloseTo(200, 6);
    expect(amount("fake-flat-cash", "gas")).toBeCloseTo(300, 6);
    const groceries = c.policy.find((p) => p.category === "groceries")!;
    expect(groceries.steps.map((s) => [s.card_id, s.until_cap?.id ?? null])).toEqual([
      ["fake-grocery-cash", "groceries-dining-monthly"],
      ["fake-flat-cash", null],
    ]);
    expect(groceries.steps[0].until_cap?.shared_with).toEqual(["groceries", "dining"]);
    expect(c.policy.find((p) => p.category === "gas")!.steps).toEqual([{ card_id: "fake-flat-cash", until_cap: null }]);
    // No dining spend: still the best available order, marked as such.
    expect(c.policy.find((p) => p.category === "dining")).toMatchObject({ has_spend: false });
  });

  it("puts a shared cap where it beats the alternative most (dining, not groceries)", async () => {
    const solver = await getSolver();
    const r = solveRouting([grocery(), shared()], [cell("groceries", 600), cell("dining", 600)], "ongoing", solver);
    const c = r.cases[0];
    // G: 500 dining × 5%; S: 600 groceries × 4% + 100 dining × 2% = 25 + 24 + 2 = 51, minus 100/12.
    expect(c.upper_bound).toBeCloseTo(51 - 100 / 12, 6);
    const dining = c.policy.find((p) => p.category === "dining")!;
    expect(dining.steps.slice(0, 2).map((s) => s.card_id)).toEqual(["fake-grocery-cash", "fake-shared-cap"]);
    expect(c.policy.find((p) => p.category === "groceries")!.steps[0]).toMatchObject({ card_id: "fake-shared-cap" });
  });

  it("gives foreign purchases their own steps when FX fees change the answer", async () => {
    const solver = await getSolver();
    // 2.5% FX on both cash cards: travel 1% vs 2% domestic; points card: travel 3×, no FX.
    const r = solveRouting([flat(), points()], [cell("travel", 100), cell("travel", 100, "2026-01", true)], "ongoing", solver);
    const travel = r.cases[0].policy.find((p) => p.category === "travel")!;
    expect(travel.steps[0].card_id).toBe("fake-points");
    expect(travel.foreign_steps).toBeNull(); // same card either way
  });

  it("excludes unverified cards and routes among the rest", async () => {
    const solver = await getSolver();
    const r = solveRouting([flat(), points()], [cell("gas", 100)], "ongoing", solver);
    expect(r.cards).toEqual(["fake-flat-cash"]);
    expect(r.excluded).toEqual([{ card_id: "fake-points", name: "FAKE Points Card", reasons: ["its gas spending cap is not yet verified"] }]);
    expect(solveRouting([points()], [cell("gas", 100)], "ongoing", solver).status).toBe("no_usable_cards");
  });

  it("first_year enumerates bonus combinations and drops infeasible ones", async () => {
    const solver = await getSolver();
    const newGrocery = { ...grocery(), is_new: true };
    const newPoints = { ...points(), is_new: true };
    const cells = [cell("groceries", 200), cell("travel", 200)];
    const r = solveRouting([flat(), newGrocery, newPoints], cells, "first_year", solver);
    // Both new cards have a $1,000-in-3-months bonus. One month of data: pace $333.33 each.
    expect(r.bonus_targets.map((t) => [t.card_id, Math.round(t.required * 100) / 100, t.projected, t.value])).toEqual([
      ["fake-grocery-cash", 333.33, true, 100],
      ["fake-points", 333.33, true, 100],
    ]);
    // $400 of spend can't reach 333.33 on both at once: 3 of the 4 combinations are feasible.
    expect(r.cases.map((c) => c.pursued)).toEqual([[], ["fake-grocery-cash"], ["fake-points"]]);
  });

  it("bonusTargets uses the full requirement when the data covers the window", () => {
    const r = resolveCard({ ...grocery(), is_new: true }, [cell("groceries", 1)], "first_year");
    const t = bonusTargets([r], ["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(t).toEqual([{ card_id: "fake-grocery-cash", required: 1000, window_months_in_data: 3, value: 100, projected: false }]);
  });
});
