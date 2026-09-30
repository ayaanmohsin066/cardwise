import { describe, expect, it } from "vitest";
import {
  cardSchema,
  cardSkeleton,
  cardStatus,
  countNulls,
  isSlug,
  programSchema,
  programSkeleton,
  programStatus,
  STALE_DAYS,
  statusExitCode,
  validateCard,
} from "@/engine";
import { fixtureCard, program } from "../helpers/cards";

describe("cardSkeleton", () => {
  it("has every schema key, null except id/issuer/country/currency", () => {
    const s = cardSkeleton("td", "td-example");
    expect(Object.keys(s)).toEqual(Object.keys(cardSchema.shape));
    expect(s).toMatchObject({ id: "td-example", issuer: "td", country: "CA", currency: "CAD", name: null, annual_fee: null, earn_rules: null, source_url: null, last_verified: null });
    expect(Object.entries(s).filter(([, v]) => v !== null).map(([k]) => k)).toEqual(["id", "issuer", "country", "currency"]);
  });

  it("fails validation until the identity and source fields are filled in", () => {
    const r = validateCard(cardSkeleton("td", "td-example"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([
      "name must be a non-empty string",
      "source_url is invalid",
      "last_verified is invalid",
    ]);
    const filled = { ...cardSkeleton("td", "td-example"), name: "X", source_url: "https://example.com/x", last_verified: "2026-09-30" };
    expect(validateCard(filled).ok).toBe(true);
  });
});

describe("programSkeleton", () => {
  it("has every schema key", () => {
    expect(programSkeleton("some-points")).toEqual(Object.fromEntries(Object.keys(programSchema.shape).map((k) => [k, k === "id" ? "some-points" : null])));
  });
});

describe("countNulls", () => {
  it("counts nulls at any depth", () => {
    expect(countNulls(null)).toBe(1);
    expect(countNulls({ a: null, b: [null, 1, { c: null }], d: "x" })).toBe(3);
    expect(countNulls([])).toBe(0);
    expect(countNulls(cardSkeleton("td", "x"))).toBe(Object.keys(cardSchema.shape).length - 4);
  });
});

describe("cardStatus / programStatus", () => {
  it("reports validity, nulls and age; stale after STALE_DAYS", () => {
    const c = fixtureCard("fake-points"); // last_verified 2026-01-01
    const fresh = cardStatus("fake-bank/fake-points.json", c, "2026-06-29");
    expect(fresh).toMatchObject({ id: "fake-points", valid: true, errors: [], last_verified: "2026-01-01", age_days: 179, stale: false });
    expect(fresh.nulls).toBe(countNulls(c));
    expect(cardStatus("x", c, "2026-06-30").age_days).toBe(STALE_DAYS);
    expect(cardStatus("x", c, "2026-06-30").stale).toBe(false);
    expect(cardStatus("x", c, "2026-07-01").stale).toBe(true);
  });

  it("reports invalid data and missing dates without crashing", () => {
    const s = cardStatus("td/new.json", cardSkeleton("td", "new"), "2026-09-30");
    expect(s).toMatchObject({ id: "new", valid: false, last_verified: null, age_days: null, stale: false });
    expect(cardStatus("junk.json", "not an object", "2026-09-30")).toMatchObject({ id: "(no id)", valid: false });
  });

  it("treats a built-in program without a date as not stale", () => {
    expect(programStatus("cash-cad.json", program("cash-cad"), "2030-01-01")).toMatchObject({ valid: true, age_days: null, stale: false });
    expect(programStatus("fake.json", program("fake-points-program"), "2026-09-30")).toMatchObject({ valid: true, stale: true });
  });

  it("exit code is 1 when anything is stale or invalid", () => {
    const ok = cardStatus("a", fixtureCard("fake-points"), "2026-02-01");
    const stale = cardStatus("b", fixtureCard("fake-points"), "2026-12-01");
    const bad = cardStatus("c", cardSkeleton("td", "c"), "2026-02-01");
    expect(statusExitCode([])).toBe(0);
    expect(statusExitCode([ok])).toBe(0);
    expect(statusExitCode([ok, stale])).toBe(1);
    expect(statusExitCode([ok, bad])).toBe(1);
  });
});

describe("isSlug", () => {
  it("accepts lowercase slugs only", () => {
    expect([isSlug("td-cash-back"), isSlug("TD"), isSlug("a--b"), isSlug("")]).toEqual([true, false, false, false]);
  });
});
