import { describe, expect, it } from "vitest";
import { validateIssuers } from "@/engine";

const errorsOf = (raw: unknown) => {
  const r = validateIssuers(raw);
  return r.ok ? [] : r.errors;
};

describe("validateIssuers", () => {
  it("accepts a valid list and returns it", () => {
    const r = validateIssuers({ issuers: [{ id: "some-bank", name: "Some Bank", tier: 2 }] });
    expect(r.ok && r.issuers[0].tier).toBe(2);
  });

  it("rejects non-objects", () => {
    expect(errorsOf(null)).toEqual(["issuers file must be an object"]);
  });

  it("rejects bad ids, names and tiers", () => {
    expect(errorsOf({ issuers: [{ id: "Some Bank", name: "", tier: 4 }] })).toEqual([
      "issuers[0].id must be a lowercase slug",
      "issuers[0].name must be a non-empty string",
      "issuers[0].tier must be 1, 2 or 3",
    ]);
  });

  it("rejects duplicate ids", () => {
    const iss = { id: "a", name: "A", tier: 1 };
    expect(errorsOf({ issuers: [iss, iss] })).toEqual(["issuers[1].id is a duplicate"]);
  });
});
