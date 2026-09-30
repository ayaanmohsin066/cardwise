import { describe, expect, it } from "vitest";
import type { CategoryPolicy } from "@/engine";
import { describeCreditRule, describePolicy, describeSteps } from "../../src/app/lib/policy-text";

const name = (id: string) => ({ a: "Card A", b: "Card B" })[id] ?? id;
const cap = { id: "c", amount: 500, period: "month" as const, shared_with: ["groceries" as const, "dining" as const] };

describe("policy text", () => {
  it("writes cap steps and the fallback in order", () => {
    expect(describeSteps([{ card_id: "a", until_cap: cap }, { card_id: "b", until_cap: null }], name)).toBe(
      "Card A until its $500.00/month cap (shared with groceries and dining) is reached, then Card B",
    );
    expect(describeSteps([{ card_id: "a", until_cap: cap }, { card_id: "b", until_cap: null }], name, "groceries")).toBe(
      "Card A until its $500.00/month cap (shared with dining) is reached, then Card B",
    );
    expect(describeSteps([{ card_id: "b", until_cap: null }], name)).toBe("Card B");
    expect(describeSteps([{ card_id: "a", until_cap: { ...cap, shared_with: ["groceries"] } }], name)).toBe(
      "Card A (up to its $500.00/month cap)",
    );
  });

  it("adds a foreign-currency sentence only when it differs", () => {
    const p: CategoryPolicy = { category: "travel", steps: [{ card_id: "a", until_cap: null }], foreign_steps: [{ card_id: "b", until_cap: null }], has_spend: true };
    expect(describePolicy(p, name)).toEqual(["Travel: use Card A.", "Travel, foreign-currency purchases: use Card B."]);
    expect(describePolicy({ ...p, foreign_steps: null }, name)).toEqual(["Travel: use Card A."]);
  });

  it("names the merchant and the credit", () => {
    expect(
      describeCreditRule({ card_id: "a", description: "FAKE: $100 travel credit", merchant_keywords: ["fake air", "fake hotels"], limit: 100, period: "year" }, name),
    ).toBe('At FAKE AIR or FAKE HOTELS: use Card A first, until its $100.00/year credit ("FAKE: $100 travel credit") is used.');
  });
});
