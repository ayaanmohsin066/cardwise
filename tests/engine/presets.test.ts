import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  genericPreset,
  isUsablePreset,
  ISSUER_PRESETS,
  presetForIssuer,
  validateIssuers,
} from "@/engine";
import { DATA_DIR, loadJson } from "../helpers/data-files";

const issuers = (() => {
  const r = validateIssuers(loadJson(join(DATA_DIR, "issuers.json")));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.issuers;
})();

describe("presets", () => {
  it("has a preset for every Tier 1 issuer", () => {
    const tier1 = issuers.filter((i) => i.tier === 1).map((i) => i.id);
    expect(ISSUER_PRESETS.map((p) => p.issuer_id).sort()).toEqual([...tier1].sort());
  });

  it("only references known issuers and has unique ids", () => {
    const ids = new Set(issuers.map((i) => i.id));
    for (const p of ISSUER_PRESETS) expect(ids.has(p.issuer_id!)).toBe(true);
    const presetIds = ISSUER_PRESETS.map((p) => p.id);
    expect(new Set(presetIds).size).toBe(presetIds.length);
  });

  it("never guesses column names: unverified presets have no mapping or format", () => {
    for (const p of [...ISSUER_PRESETS, genericPreset]) {
      if (!p.verified) {
        expect(p.mapping, p.id).toBeNull();
        expect(p.format, p.id).toBeNull();
      }
    }
  });

  it("marks every current issuer stub unverified", () => {
    expect(ISSUER_PRESETS.every((p) => !p.verified)).toBe(true);
  });
});

describe("presetForIssuer", () => {
  it("returns the issuer's stub, or the generic preset", () => {
    expect(presetForIssuer("rbc").id).toBe("rbc");
    expect(presetForIssuer("tangerine")).toBe(genericPreset);
  });
});

describe("isUsablePreset", () => {
  it("is false for unverified presets and true only with mapping and format", () => {
    expect(isUsablePreset(genericPreset)).toBe(false);
    expect(isUsablePreset(presetForIssuer("td"))).toBe(false);
    const mapping = {
      date: "D", description: "X", amount: "A", debit: null, credit: null,
      currency: null, foreign_amount: null, exchange_rate: null,
    };
    const format = { has_header: true, date_format: "YYYY-MM-DD", decimal_separator: ".", purchase_sign: "positive" } as const;
    expect(isUsablePreset({ ...genericPreset, verified: true, mapping, format })).toBe(true);
    expect(isUsablePreset({ ...genericPreset, verified: true, mapping: null, format })).toBe(false);
  });
});
