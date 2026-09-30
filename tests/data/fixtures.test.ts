import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateCard, validateIssuers, validateProgram } from "@/engine";
import { DATA_DIR, FIXTURES_DIR, loadCardFiles, loadJson, loadProgramFiles } from "../helpers/data-files";

const cards = loadCardFiles(join(FIXTURES_DIR, "cards"));
const programs = loadProgramFiles(join(FIXTURES_DIR, "programs"));

describe("test fixtures", () => {
  it("has the expected fake cards and program", () => {
    expect(cards.map((c) => c.label).sort()).toEqual([
      "fake-bank/fake-flat-cash.json",
      "fake-bank/fake-grocery-cash.json",
      "fake-bank/fake-points.json",
    ]);
    expect(programs.map((p) => p.label)).toEqual(["fake-points-program.json"]);
  });

  it.each(cards.map((c) => [c.label, c] as const))("%s is a valid, clearly fake card", (_l, c) => {
    const r = validateCard(c.json);
    if (!r.ok) throw new Error(r.errors.join("\n"));
    expect(r.card.name).toMatch(/^FAKE /);
    expect(new URL(r.card.source_url).hostname).toBe("example.com");
    expect(r.card.issuer).toBe(c.dir);
    expect(`${r.card.id}.json`).toBe(c.file);
    if (r.card.program_id !== null) {
      expect(programs.map((p) => p.file)).toContain(`${r.card.program_id}.json`);
    }
  });

  it.each(programs.map((p) => [p.label, p] as const))("%s is a valid program", (_l, p) => {
    const r = validateProgram(p.json);
    if (!r.ok) throw new Error(r.errors.join("\n"));
    expect(`${r.program.id}.json`).toBe(p.file);
  });

  it("uses an issuer that is not a real listed issuer", () => {
    const r = validateIssuers(loadJson(join(DATA_DIR, "issuers.json")));
    if (!r.ok) throw new Error(r.errors.join("\n"));
    expect(r.issuers.map((i) => i.id)).not.toContain("fake-bank");
  });
});
