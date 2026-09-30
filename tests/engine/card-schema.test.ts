import { describe, expect, it } from "vitest";
import { validateCard } from "@/engine";
import { FIXTURES_DIR, loadJson } from "../helpers/data-files";
import { join } from "node:path";

// Test fixture only. Values are placeholders, not real card terms.
const unverified = (): Record<string, unknown> => ({
  id: "test-card",
  name: "Test Card",
  issuer: "test-issuer",
  country: "CA",
  currency: "CAD",
  network: null,
  card_type: null,
  program_id: null,
  annual_fee: null,
  first_year_fee: null,
  fx_fee_pct: null,
  base_rate: null,
  earn_rules: null,
  welcome_bonus: null,
  purchase_credits: null,
  perks: null,
  source_url: "https://example.com/card",
  last_verified: "2026-09-29",
});

const rule = (over: Record<string, unknown> = {}) => ({
  categories: ["groceries"],
  rate: null,
  cap: null,
  after_cap_rate: null,
  ...over,
});

const without = (key: string, base = unverified()) => {
  delete base[key];
  return base;
};

const errorsOf = (raw: unknown) => {
  const r = validateCard(raw);
  return r.ok ? [] : r.errors;
};

const fakePoints = () =>
  loadJson(join(FIXTURES_DIR, "cards", "fake-bank", "fake-points.json")) as Record<string, unknown>;

describe("validateCard", () => {
  it("accepts a card whose terms are all explicitly null", () => {
    expect(errorsOf(unverified())).toEqual([]);
  });

  it("accepts a fully populated card and returns it typed", () => {
    const r = validateCard(fakePoints());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.card.earn_rules?.[0].cap).toBe("none");
      expect(r.card.perks?.[0].type).toBe("lounge");
    }
  });

  it("rejects non-objects", () => {
    expect(errorsOf(null)).toEqual(["card must be an object"]);
    expect(errorsOf([])).toEqual(["card must be an object"]);
  });

  it("requires source_url as https", () => {
    expect(errorsOf(without("source_url"))).toContain("source_url is missing (use null if unverified)");
    expect(errorsOf({ ...unverified(), source_url: "http://example.com" })).toContain(
      "source_url must be an https:// URL",
    );
    expect(errorsOf({ ...unverified(), source_url: "https://" })).toContain(
      "source_url must be an https:// URL",
    );
    expect(errorsOf({ ...unverified(), source_url: null })).toContain("source_url is invalid");
  });

  it("requires a real last_verified date", () => {
    expect(errorsOf(without("last_verified"))).toContain(
      "last_verified is missing (use null if unverified)",
    );
    expect(errorsOf({ ...unverified(), last_verified: "2026-02-30" })).toContain(
      "last_verified must be a valid YYYY-MM-DD date",
    );
    expect(errorsOf({ ...unverified(), last_verified: "Sept 2026" })).toContain(
      "last_verified must be a valid YYYY-MM-DD date",
    );
  });

  it("enforces Canada and CAD", () => {
    expect(errorsOf({ ...unverified(), country: "US" })).toContain('country must be "CA"');
    expect(errorsOf({ ...unverified(), currency: "USD" })).toContain('currency must be "CAD"');
  });

  it("treats a missing term as an error, not as unknown", () => {
    for (const key of ["network", "card_type", "program_id", "annual_fee", "first_year_fee",
      "fx_fee_pct", "base_rate", "earn_rules", "welcome_bonus", "purchase_credits", "perks"]) {
      expect(errorsOf(without(key))).toEqual([`${key} is missing (use null if unverified)`]);
    }
    const er = rule();
    delete (er as Record<string, unknown>).cap;
    expect(errorsOf({ ...unverified(), earn_rules: [er] })).toEqual([
      "earn_rules[0].cap is missing (use null if unverified)",
    ]);
  });

  it("rejects unknown fields (catches typos)", () => {
    expect(errorsOf({ ...unverified(), anual_fee: 0 })).toEqual(["anual_fee is not a known field"]);
    expect(errorsOf({ ...unverified(), earn_rules: [rule({ rte: 1 })] })).toEqual([
      "earn_rules[0].rte is not a known field",
    ]);
  });

  it("rejects invalid top-level term values", () => {
    expect(errorsOf({ ...unverified(), annual_fee: -1 })).toEqual(["annual_fee is invalid"]);
    expect(errorsOf({ ...unverified(), annual_fee: "free" })).toEqual(["annual_fee is invalid"]);
    expect(errorsOf({ ...unverified(), fx_fee_pct: Infinity })).toEqual(["fx_fee_pct is invalid"]);
    expect(errorsOf({ ...unverified(), program_id: "" })).toEqual([
      "program_id must be a non-empty string",
    ]);
    expect(errorsOf({ ...unverified(), network: "discover" })).toEqual(["network is invalid"]);
    expect(errorsOf({ ...unverified(), card_type: "miles" })).toEqual(["card_type is invalid"]);
  });

  it("requires id, issuer and name", () => {
    expect(errorsOf({ ...unverified(), id: "", issuer: 3, name: null })).toEqual([
      "id must be a non-empty string",
      "name must be a non-empty string",
      "issuer must be a non-empty string",
    ]);
  });

  describe("earn_rules", () => {
    it("fails on a category outside the master list", () => {
      expect(
        errorsOf({ ...unverified(), earn_rules: [rule({ categories: ["groceries", "us_supermarkets"] })] }),
      ).toEqual(["earn_rules[0].categories[1] is not a known category"]);
    });

    it("requires at least one category and no repeats", () => {
      expect(errorsOf({ ...unverified(), earn_rules: [rule({ categories: [] })] })).toEqual([
        "earn_rules[0].categories must list at least one category",
      ]);
      expect(
        errorsOf({ ...unverified(), earn_rules: [rule({ categories: ["gas", "gas"] })] }),
      ).toEqual(["earn_rules[0].categories must not repeat a category"]);
    });

    it("does not allow a category in two rules", () => {
      const rules = [rule({ categories: ["gas", "transit"] }), rule({ categories: ["dining", "gas"] })];
      expect(errorsOf({ ...unverified(), earn_rules: rules })).toEqual([
        "earn_rules[1].categories[1] is already covered by earn_rules[0]",
      ]);
    });

    it("accepts cap as null (unverified), \"none\" (uncapped) or an object", () => {
      for (const cap of [null, "none", { amount: 500, period: "month" }, { amount: null, period: null }]) {
        expect(errorsOf({ ...unverified(), earn_rules: [rule({ cap })] })).toEqual([]);
      }
    });

    it("reports errors inside a cap object precisely", () => {
      expect(
        errorsOf({ ...unverified(), earn_rules: [rule({ cap: { amount: 500, period: "week" } })] }),
      ).toEqual(["earn_rules[0].cap.period is invalid"]);
      expect(
        errorsOf({ ...unverified(), earn_rules: [rule({ cap: { period: "year" } })] }),
      ).toEqual(["earn_rules[0].cap.amount is missing (use null if unverified)"]);
      expect(errorsOf({ ...unverified(), earn_rules: [rule({ cap: "unlimited" })] })).toEqual([
        "earn_rules[0].cap is invalid",
      ]);
    });

    it("rejects negative rates", () => {
      expect(
        errorsOf({ ...unverified(), earn_rules: [rule({ rate: -1, after_cap_rate: -1 })] }),
      ).toEqual(["earn_rules[0].rate is invalid", "earn_rules[0].after_cap_rate is invalid"]);
    });

    it("must be an array or null", () => {
      expect(errorsOf({ ...unverified(), earn_rules: {} })).toEqual(["earn_rules is invalid"]);
      expect(errorsOf({ ...unverified(), earn_rules: [1] })).toEqual(["earn_rules[0] is invalid"]);
    });
  });

  it("validates welcome_bonus entries", () => {
    const wb = { points_or_cash: 100, min_spend: null, window_months: 2.5 };
    expect(errorsOf({ ...unverified(), welcome_bonus: [wb] })).toEqual([
      "welcome_bonus[0].window_months is invalid",
    ]);
  });

  it("validates purchase_credits entries", () => {
    const pc = { description: "", merchant_keywords: ["ok", ""], amount: 10, period: "decade" };
    expect(errorsOf({ ...unverified(), purchase_credits: [pc] })).toEqual([
      "purchase_credits[0].description must be a non-empty string",
      "purchase_credits[0].merchant_keywords[1] must be a non-empty string",
      "purchase_credits[0].period is invalid",
    ]);
  });

  it("validates perks, including their own source_url", () => {
    const perk = {
      type: "concierge",
      summary: "x",
      conditions: null,
      requires_enrollment: "yes",
      source_url: "http://example.com",
    };
    expect(errorsOf({ ...unverified(), perks: [perk] })).toEqual([
      "perks[0].type is invalid",
      "perks[0].requires_enrollment is invalid",
      "perks[0].source_url must be an https:// URL",
    ]);
  });
});
