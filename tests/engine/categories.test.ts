import { describe, expect, it } from "vitest";
import { CATEGORIES, isCategory } from "@/engine";

describe("CATEGORIES", () => {
  it("is the agreed master list", () => {
    expect(CATEGORIES).toEqual([
      "groceries", "dining", "gas", "transit", "travel", "streaming", "drugstore",
      "recurring_bills", "entertainment", "home_improvement", "online_shopping", "other",
    ]);
  });
});

describe("isCategory", () => {
  it("accepts master categories only", () => {
    expect(isCategory("groceries")).toBe(true);
    expect(isCategory("us_supermarkets")).toBe(false);
    expect(isCategory("Groceries")).toBe(false);
    expect(isCategory(1)).toBe(false);
  });
});
