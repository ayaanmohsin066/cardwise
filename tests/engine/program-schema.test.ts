import { describe, expect, it } from "vitest";
import { validateProgram } from "@/engine";

const redemption = (over: Record<string, unknown> = {}) => ({
  method: "statement_credit",
  cents_per_point: null,
  is_estimate: false,
  notes: null,
  ...over,
});

const errorsOf = (raw: unknown) => {
  const r = validateProgram(raw);
  return r.ok ? [] : r.errors;
};

describe("validateProgram", () => {
  it("accepts a program with unverified redemption values", () => {
    expect(errorsOf({ id: "p", name: "P", redemptions: [redemption()] })).toEqual([]);
  });

  it("returns the typed program", () => {
    const r = validateProgram({ id: "p", name: "P", redemptions: [] });
    expect(r.ok && r.program.id).toBe("p");
  });

  it("rejects non-objects", () => {
    expect(errorsOf("x")).toEqual(["program must be an object"]);
  });

  it("requires every field", () => {
    expect(errorsOf({ id: "p", name: "P" })).toEqual([
      "redemptions is missing (use null if unverified)",
    ]);
    const r = redemption();
    delete (r as Record<string, unknown>).cents_per_point;
    expect(errorsOf({ id: "p", name: "P", redemptions: [r] })).toEqual([
      "redemptions[0].cents_per_point is missing (use null if unverified)",
    ]);
  });

  it("rejects invalid values", () => {
    expect(
      errorsOf({
        id: "",
        name: "P",
        redemptions: [redemption({ cents_per_point: -1, is_estimate: null, extra: 1 })],
      }),
    ).toEqual([
      "id must be a non-empty string",
      "redemptions[0].cents_per_point is invalid",
      "redemptions[0].is_estimate is invalid",
      "redemptions[0].extra is not a known field",
    ]);
  });

  it("requires notes explaining an estimate", () => {
    expect(
      errorsOf({ id: "p", name: "P", redemptions: [redemption({ cents_per_point: 2, is_estimate: true })] }),
    ).toEqual(["redemptions[0].notes must explain the basis of an estimate"]);
  });
});
