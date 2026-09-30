import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  categorizeAll,
  summarizeStatement,
  transactionId,
  validateCard,
  validateIssuers,
  validateMerchantRules,
  validateProgram,
  validateTransaction,
  type Transaction,
} from "@/engine";
import { DATA_DIR, FIXTURES_DIR, loadCardFiles, loadJson, loadProgramFiles } from "../helpers/data-files";

const cards = loadCardFiles(join(FIXTURES_DIR, "cards"));
const programs = loadProgramFiles(join(FIXTURES_DIR, "programs"));
// Fixtures may use built-in programs (e.g. cash-cad) as well as fixture programs.
const builtInPrograms = loadProgramFiles(join(DATA_DIR, "programs"));
const knownProgramFiles = [...programs, ...builtInPrograms].map((p) => p.file);

describe("test fixtures", () => {
  it("has the expected fake cards and program", () => {
    expect(cards.map((c) => c.label).sort()).toEqual([
      "fake-bank/fake-flat-cash.json",
      "fake-bank/fake-grocery-cash.json",
      "fake-bank/fake-points.json",
      "fake-bank/fake-shared-cap.json",
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
      expect(knownProgramFiles).toContain(`${r.card.program_id}.json`);
    }
  });

  it.each(programs.map((p) => [p.label, p] as const))("%s is a valid program", (_l, p) => {
    const r = validateProgram(p.json);
    if (!r.ok) throw new Error(r.errors.join("\n"));
    expect(`${r.program.id}.json`).toBe(p.file);
  });

  it("fake-shared-cap has two rules with different rates sharing one cap", () => {
    const c = cards.find((x) => x.file === "fake-shared-cap.json");
    const r = validateCard(c?.json);
    if (!r.ok) throw new Error(r.errors.join("\n"));
    const rules = r.card.earn_rules ?? [];
    expect(rules.map((x) => [x.rate, x.cap_id])).toEqual([
      [4, "combined-monthly"],
      [2, "combined-monthly"],
    ]);
    expect(r.card.caps).toEqual([{ id: "combined-monthly", amount: 1000, period: "month" }]);
  });

  it("uses an issuer that is not a real listed issuer", () => {
    const r = validateIssuers(loadJson(join(DATA_DIR, "issuers.json")));
    if (!r.ok) throw new Error(r.errors.join("\n"));
    expect(r.issuers.map((i) => i.id)).not.toContain("fake-bank");
  });
});

describe("transaction fixtures", () => {
  const seq = loadJson(join(FIXTURES_DIR, "transactions", "fake-shared-cap-2026-01.json")) as {
    card_id: string;
    transactions: unknown[];
  };
  const transactions: Transaction[] = seq.transactions.map((raw) => {
    const r = validateTransaction(raw);
    if (!r.ok) throw new Error(r.errors.join("\n"));
    return r.transaction;
  });

  it("fake-shared-cap-2026-01 is valid Transactions with stable ids", () => {
    expect(cards.map((c) => c.file)).toContain(`${seq.card_id}.json`);
    for (const t of transactions) {
      expect(t.id).toBe(transactionId(t.statement_line, t.date, t.description, t.amount_cad));
      expect([t.kind, t.is_foreign]).toEqual(["purchase", false]);
    }
  });

  it("categorizes to the totals of worked example B ($600 groceries + $600 dining)", () => {
    const rules = validateMerchantRules(loadJson(join(DATA_DIR, "merchant_rules.json")));
    if (!rules.ok) throw new Error(rules.errors.join("\n"));
    const s = summarizeStatement(categorizeAll(transactions, rules.rules));
    expect(s.spend_by_category).toMatchObject({ groceries: 600, dining: 600 });
    expect(s.purchases).toBe(1200);
  });

  it("is in posting order with statement lines 1..n and the line 3/4 same-date tie", () => {
    const lines = transactions.map((t) => t.statement_line);
    expect(lines).toEqual([1, 2, 3, 4, 5, 6]);
    const dates = transactions.map((t) => t.date);
    expect([...dates].sort()).toEqual(dates);
    expect(dates[2]).toBe(dates[3]);
    expect(new Set(dates).size).toBe(5);
  });
});
