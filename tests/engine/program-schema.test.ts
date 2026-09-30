import { describe, expect, it } from "vitest";
import { validateProgram } from "@/engine";

const redemption = (over: Record<string, unknown> = {}) => ({
  method: "statement_credit",
  cents_per_point: null,
  is_estimate: false,
  notes: null,
  ...over,
});

const prog = (redemptions: unknown[], over: Record<string, unknown> = {}) => ({
  id: "p",
  name: "P",
  redemptions,
  source_url: "https://example.com/p",
  last_verified: "2026-01-01",
  ...over,
});

const errorsOf = (raw: unknown) => {
  const r = validateProgram(raw);
  return r.ok ? [] : r.errors;
};

describe("validateProgram", () => {
  it("accepts a program with unverified redemption values", () => {
    expect(errorsOf(prog([redemption()]))).toEqual([]);
  });

  it("returns the typed program", () => {
    const r = validateProgram(prog([]));
    expect(r.ok && r.program.id).toBe("p");
  });

  it("rejects non-objects", () => {
    expect(errorsOf("x")).toEqual(["program must be an object"]);
  });

  it("requires every field", () => {
    const noRedemptions: Record<string, unknown> = prog([]);
    delete noRedemptions.redemptions;
    expect(errorsOf(noRedemptions)).toEqual(["redemptions is missing (use null if unverified)"]);
    const r = redemption();
    delete (r as Record<string, unknown>).cents_per_point;
    expect(errorsOf(prog([r]))).toEqual([
      "redemptions[0].cents_per_point is missing (use null if unverified)",
    ]);
  });

  it("rejects invalid values", () => {
    expect(
      errorsOf(prog([redemption({ cents_per_point: -1, is_estimate: null, extra: 1 })], { id: "" })),
    ).toEqual([
      "id must be a non-empty string",
      "redemptions[0].cents_per_point is invalid",
      "redemptions[0].is_estimate is invalid",
      "redemptions[0].extra is not a known field",
    ]);
  });

  it("requires notes explaining an estimate", () => {
    expect(
      errorsOf(prog([redemption({ cents_per_point: 2, is_estimate: true })])),
    ).toEqual(["redemptions[0].notes must explain the basis of an estimate"]);
  });

  it("requires source_url and last_verified together (null only for built-in units)", () => {
    expect(errorsOf(prog([], { source_url: null, last_verified: null }))).toEqual([]);
    expect(errorsOf(prog([], { last_verified: null }))).toEqual(["last_verified must be set exactly when source_url is set"]);
    expect(errorsOf(prog([], { source_url: null }))).toEqual(["last_verified must be set exactly when source_url is set"]);
    expect(errorsOf(prog([], { source_url: "http://x.example" }))).toEqual(["source_url must be an https:// URL"]);
    expect(errorsOf(prog([], { last_verified: "2026-02-30" }))).toEqual(["last_verified must be a valid YYYY-MM-DD date"]);
    const missing: Record<string, unknown> = prog([]);
    delete missing.source_url;
    expect(errorsOf(missing)).toEqual(["source_url is missing (use null if unverified)"]);
  });
});
