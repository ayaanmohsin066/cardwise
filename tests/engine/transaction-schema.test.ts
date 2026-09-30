import { describe, expect, it } from "vitest";
import { validateTransaction } from "@/engine";

const tx = (over: Record<string, unknown> = {}) => ({
  id: "tx-1",
  statement_line: 1,
  date: "2026-03-01",
  description: "LOBLAWS",
  amount_cad: 10,
  kind: "purchase",
  is_foreign: false,
  is_foreign_confidence: "high",
  raw: { Date: "2026-03-01" },
  ...over,
});

const errorsOf = (raw: unknown) => {
  const r = validateTransaction(raw);
  return r.ok ? [] : r.errors;
};

describe("validateTransaction", () => {
  it("accepts a valid transaction", () => {
    expect(errorsOf(tx())).toEqual([]);
    expect(errorsOf(tx({ amount_cad: -10, kind: "refund" }))).toEqual([]);
  });

  it("rejects bad kinds, dates, lines and raw values", () => {
    expect(
      errorsOf(tx({ kind: "cash_advance", date: "2026-13-01", statement_line: 0, raw: { a: 1 } })),
    ).toEqual([
      "statement_line is invalid",
      "date must be a valid YYYY-MM-DD date",
      "kind is invalid",
      "raw.a is invalid",
    ]);
  });

  it("requires every field and rejects unknown ones", () => {
    const t = tx({ category: "groceries" });
    delete (t as Record<string, unknown>).is_foreign_confidence;
    expect(errorsOf(t)).toEqual([
      "is_foreign_confidence is missing (use null if unverified)",
      "category is not a known field",
    ]);
  });
});
