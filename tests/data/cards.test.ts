import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateCard, validateIssuers, validateMerchantRules, validateProgram } from "@/engine";
import { DATA_DIR, loadCardFiles, loadJson, loadProgramFiles } from "../helpers/data-files";

const CARDS_DIR = join(DATA_DIR, "cards");

const cardFiles = loadCardFiles(CARDS_DIR);
const programFiles = loadProgramFiles(join(DATA_DIR, "programs"));

function mustValidate<R extends { ok: true } | { ok: false; errors: string[] }>(
  r: R,
): Extract<R, { ok: true }> {
  if (!r.ok) throw new Error((r as { errors: string[] }).errors.join("\n"));
  return r as Extract<R, { ok: true }>;
}

describe("src/data/issuers.json", () => {
  it("is valid", () => {
    mustValidate(validateIssuers(loadJson(join(DATA_DIR, "issuers.json"))));
  });
});

describe("src/data/merchant_rules.json", () => {
  it("is valid", () => {
    mustValidate(validateMerchantRules(loadJson(join(DATA_DIR, "merchant_rules.json"))));
  });
});

describe("src/data/programs", () => {
  it("contains only program JSON files", () => {
    const other = readdirSync(join(DATA_DIR, "programs")).filter(
      (f) => f !== ".gitkeep" && !f.endsWith(".json"),
    );
    expect(other).toEqual([]);
  });

  it.each(programFiles.map((p) => [p.label, p] as const))(
    "%s is valid and matches its filename",
    (_label, { file, json }) => {
      const { program } = mustValidate(validateProgram(json));
      expect(`${program.id}.json`).toBe(file);
    },
  );
});

describe("src/data/cards", () => {
  const issuersResult = validateIssuers(loadJson(join(DATA_DIR, "issuers.json")));
  const issuerIds = new Set(issuersResult.ok ? issuersResult.issuers.map((i) => i.id) : []);
  const programIds = new Set(programFiles.map((p) => p.file.replace(/\.json$/, "")));

  it("has no stray JSON outside src/data/cards/<issuer>/", () => {
    const stray = readdirSync(CARDS_DIR).filter((f) => f.endsWith(".json"));
    expect(stray).toEqual([]);
  });

  it("every issuer directory is a known issuer", () => {
    const dirs = [...new Set(cardFiles.map((c) => c.dir))];
    expect(dirs.filter((d) => !issuerIds.has(d))).toEqual([]);
  });

  it.each(cardFiles.map((c) => [c.label, c] as const))(
    "%s is valid, matches its path, and references known issuer/program",
    (_label, { dir, file, json }) => {
      const { card } = mustValidate(validateCard(json));
      expect(card.issuer).toBe(dir);
      expect(`${card.id}.json`).toBe(file);
      expect(issuerIds.has(card.issuer), `unknown issuer "${card.issuer}"`).toBe(true);
      if (card.program_id !== null) {
        expect(programIds.has(card.program_id), `unknown program "${card.program_id}"`).toBe(true);
      }
    },
  );

  it("card ids are unique", () => {
    const ids = cardFiles.map((c) => c.file);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
