import { describe, expect, it } from "vitest";
import { validateMerchantRules } from "@/engine";

const errorsOf = (raw: unknown) => {
  const r = validateMerchantRules(raw);
  return r.ok ? [] : r.errors;
};
const rule = (over: Record<string, unknown> = {}) => ({
  id: "r",
  category: "groceries",
  keywords: ["loblaws"],
  ...over,
});

describe("validateMerchantRules", () => {
  it("accepts valid rules", () => {
    expect(errorsOf({ version: 1, rules: [rule()] })).toEqual([]);
    expect(errorsOf({ version: 1, rules: [] })).toEqual([]);
  });

  it("rejects unknown categories and bad ids", () => {
    expect(errorsOf({ version: 1, rules: [rule({ id: "Bad Id", category: "us_supermarkets" })] })).toEqual([
      "rules[0].id must be a lowercase slug",
      "rules[0].category is not a known category",
    ]);
  });

  it("rejects empty or punctuation-only keywords", () => {
    expect(errorsOf({ version: 1, rules: [rule({ keywords: [] })] })).toEqual([
      "rules[0].keywords must list at least one keyword",
    ]);
    expect(errorsOf({ version: 1, rules: [rule({ keywords: ["#"] })] })).toEqual([
      "rules[0].keywords[0] must contain a letter or digit",
    ]);
  });

  it("rejects duplicate ids and keywords (after normalizing)", () => {
    expect(
      errorsOf({
        version: 1,
        rules: [rule(), rule({ keywords: ["LOBLAWS"] }), rule({ id: "s", keywords: ["x", "X!"] })],
      }),
    ).toEqual([
      "rules[1].id is a duplicate",
      'rules[1].keywords[0] ("LOBLAWS") is already used by rules[0]',
      'rules[2].keywords[1] ("X!") is repeated in this rule',
    ]);
  });

  it("requires version 1", () => {
    expect(errorsOf({ version: 2, rules: [] })).toEqual(["version is invalid"]);
  });
});
