import { describe, expect, it } from "vitest";
import {
  categorizeAll,
  computeBenefits,
  listPerks,
  perkNudges,
  type Card,
  type Perk,
} from "@/engine";
import { fixtureCard, item, program } from "../helpers/cards";
import { seededRules } from "../helpers/statements";

const rules = seededRules();
const perk = (over: Partial<Perk>): Perk => ({
  type: "other",
  summary: "FAKE perk",
  conditions: null,
  requires_enrollment: null,
  requires_charge_to_card: null,
  source_url: "https://example.com/perk",
  ...over,
});
const withPerks = (perks: Perk[] | null): Card => ({ ...fixtureCard("fake-flat-cash"), perks });
const buy = (date: string, description: string, amount: number, category: "other" | "travel" = "other") =>
  item(date, category, amount, { description });

describe("listPerks", () => {
  it("lists perks verbatim and flags unverified details", () => {
    const grocery = fixtureCard("fake-grocery-cash");
    expect(listPerks(grocery)).toEqual({ status: "ok", perks: [{ perk: grocery.perks![0], details_verified: true }] });
    const points = fixtureCard("fake-points"); // lounge (conditions, charge rule: null) + trip cancellation (verified)
    expect(listPerks(points)).toMatchObject({ status: "ok", perks: [{ details_verified: false }, { details_verified: true }] });
    expect(listPerks(withPerks(null))).toEqual({ status: "unverified" });
    expect(listPerks(withPerks([]))).toEqual({ status: "ok", perks: [] });
  });
});

describe("perkNudges", () => {
  it("reminds about protection perks for electronics/appliance purchases, only if the card has one", () => {
    const items = [buy("2026-03-01", "BEST BUY #123", 899), buy("2026-03-02", "BESTBUYER SHOP", 10), buy("2026-03-03", "LEON'S FURNITURE", 1200)];
    const warranty = perk({ type: "extended_warranty", summary: "FAKE: extends warranty", conditions: "FAKE: bought in full with the card", requires_enrollment: false, requires_charge_to_card: true });
    const n = perkNudges(withPerks([warranty]), items, rules, null, "2026-03-10");
    expect(n).toEqual([{ kind: "protection", perk: warranty, purchases: [
      expect.objectContaining({ description: "BEST BUY #123", amount: 899 }),
      expect.objectContaining({ description: "LEON'S FURNITURE", amount: 1200 }),
    ] }]);
    expect(perkNudges(withPerks([]), items, rules, null, "2026-03-10")).toEqual([]);
    expect(perkNudges(withPerks(null), items, rules, null, "2026-03-10")).toEqual([]);
  });

  it("gives the charge-to-card travel reminder only when requires_charge_to_card is true", () => {
    const travelItems = [buy("2026-03-01", "AIR CANADA", 600, "travel")];
    const yes = perk({ type: "trip_cancellation", requires_charge_to_card: true, conditions: null });
    const no = perk({ type: "travel_medical", requires_charge_to_card: false, conditions: "FAKE: the trip must be charged to the card" });
    const unknown = perk({ type: "rental_car", requires_charge_to_card: null, conditions: "FAKE: the rental must be charged to the card" });
    const n = perkNudges(withPerks([yes, no, unknown]), travelItems, rules, null, "2026-03-10");
    // Only the explicit true fires. Conditions text is never parsed: false and null stay silent even if the text mentions charging.
    expect(n.filter((x) => x.kind === "travel_charge")).toEqual([
      { kind: "travel_charge", perk: yes, purchases: [expect.objectContaining({ description: "AIR CANADA" })] },
    ]);
  });

  it("an unverified charge rule marks the perk's details as not verified", () => {
    const listing = listPerks(withPerks([
      perk({ conditions: "x", requires_enrollment: false, requires_charge_to_card: null }),
      perk({ conditions: "x", requires_enrollment: false, requires_charge_to_card: false }),
    ]));
    expect(listing).toMatchObject({ status: "ok", perks: [{ details_verified: false }, { details_verified: true }] });
  });

  it("needs travel purchases for the travel reminder", () => {
    const yes = perk({ type: "trip_cancellation", requires_charge_to_card: true });
    expect(perkNudges(withPerks([yes]), [buy("2026-03-01", "LOBLAWS", 50)], rules, null, "2026-03-10")).toEqual([]);
  });

  it("reminds about enrollment only when requires_enrollment is true", () => {
    const yes = perk({ type: "lounge", requires_enrollment: true });
    const no = perk({ type: "lounge", requires_enrollment: false });
    const unknown = perk({ type: "lounge", requires_enrollment: null });
    expect(perkNudges(withPerks([yes, no, unknown]), [], rules, null, "2026-03-10")).toEqual([{ kind: "enrollment", perk: yes }]);
  });

  it("flags purchase credits with money and time left in the current period", () => {
    const card = fixtureCard("fake-points"); // $100/year at FAKE AIR / FAKE HOTELS
    const items = categorizeAll([item("2026-03-01", "travel", 30, { description: "FAKE AIR" }).transaction], rules);
    const report = computeBenefits({ card, program: program("fake-points-program"), items });
    const credit = perkNudges(card, items, rules, report, "2026-09-30").filter((x) => x.kind === "credit");
    expect(credit).toEqual([{
      kind: "credit", description: "FAKE: $100 annual travel credit", merchant_keywords: ["fake air", "fake hotels"],
      limit: 100, remaining: 70, period_end: "2026-12-31", days_left: 92,
    }]);
    // A new year: nothing used yet in the uploaded statements.
    expect(perkNudges(card, items, rules, report, "2027-01-05").find((x) => x.kind === "credit")).toMatchObject({ remaining: 100, period_end: "2027-12-31" });
    // Used up: no nudge.
    const full = categorizeAll([item("2026-03-01", "travel", 150, { description: "FAKE AIR" }).transaction], rules);
    const fullReport = computeBenefits({ card, program: program("fake-points-program"), items: full });
    expect(perkNudges(card, full, rules, fullReport, "2026-09-30").some((x) => x.kind === "credit")).toBe(false);
  });

  it("never invents details: unverified credit terms produce no credit nudge", () => {
    const card: Card = { ...fixtureCard("fake-points"), purchase_credits: [{ ...fixtureCard("fake-points").purchase_credits![0], amount: null }] };
    expect(perkNudges(card, [], rules, null, "2026-09-30").some((x) => x.kind === "credit")).toBe(false);
  });
});
