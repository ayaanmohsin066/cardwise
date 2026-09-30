import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  categorizeAll,
  ingestCsv,
  validateMerchantRules,
  type ColumnMapping,
  type CsvFormat,
  type MerchantRules,
} from "@/engine";
import { DATA_DIR, FIXTURES_DIR, loadJson } from "./data-files";

/** Mappings for the FAKE statement layouts in tests/fixtures/statements. */
const none = { amount: null, debit: null, credit: null, currency: null, foreign_amount: null, exchange_rate: null };

export const STATEMENTS = {
  "amount-currency.csv": {
    mapping: { ...none, date: "Date", description: "Description", amount: "Amount", currency: "Currency" },
    format: { has_header: true, date_format: "YYYY-MM-DD", decimal_separator: ".", purchase_sign: "positive" },
  },
  "fake-shared-cap-2026-01.csv": {
    mapping: { ...none, date: "Date", description: "Description", amount: "Amount", currency: "Currency" },
    format: { has_header: true, date_format: "YYYY-MM-DD", decimal_separator: ".", purchase_sign: "positive" },
  },
  "phase3-walkthrough.csv": {
    mapping: { ...none, date: "Date", description: "Description", amount: "Amount", currency: "Currency" },
    format: { has_header: true, date_format: "YYYY-MM-DD", decimal_separator: ".", purchase_sign: "positive" },
  },
  "debit-credit.csv": {
    mapping: { ...none, date: "Transaction Date", description: "Details", debit: "Debit", credit: "Credit" },
    format: { has_header: true, date_format: "MM/DD/YYYY", decimal_separator: ".", purchase_sign: "positive" },
  },
  "fr-headerless.csv": {
    mapping: { ...none, date: "Column 1", description: "Column 2", amount: "Column 3" },
    format: { has_header: false, date_format: "DD/MM/YYYY", decimal_separator: ",", purchase_sign: "negative" },
  },
} satisfies Record<string, { mapping: ColumnMapping; format: CsvFormat }>;

export type StatementName = keyof typeof STATEMENTS;

export const readStatement = (name: StatementName) =>
  readFileSync(join(FIXTURES_DIR, "statements", name), "utf8");

export function seededRules(): MerchantRules {
  const r = validateMerchantRules(loadJson(join(DATA_DIR, "merchant_rules.json")));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.rules;
}

export function ingestStatement(name: StatementName) {
  const { mapping, format } = STATEMENTS[name];
  return ingestCsv(readStatement(name), mapping, format);
}

export function categorizedStatement(name: StatementName) {
  return categorizeAll(ingestStatement(name).transactions, seededRules());
}
