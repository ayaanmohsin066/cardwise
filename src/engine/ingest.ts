/**
 * Statement CSV import. Runs in the browser only: callers pass the file's text
 * (read with File.text()), and nothing here does any I/O.
 */
import Papa from "papaparse";
import type { ColumnMapping, CsvFormat, DateFormat } from "./presets/types";
import { roundCents } from "./money";
import { containsPhrase } from "./text";
import type { Confidence, Transaction, TransactionKind } from "./transaction-schema";

export interface ParsedCsv {
  columns: string[];
  rows: Record<string, string>[];
  errors: string[];
}

/** Label used for columns in an export with no header row. */
export const columnLabel = (index: number) => `Column ${index + 1}`;

/** Parse CSV text into rows keyed by column name. The delimiter is auto-detected. */
export function parseCsv(text: string, hasHeader: boolean): ParsedCsv {
  if (!text.replace(/^\uFEFF/, "").trim()) return { columns: [], rows: [], errors: [] };
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ""), {
    header: false,
    skipEmptyLines: "greedy",
  });
  const errors = result.errors.map((e) =>
    e.row === undefined ? e.message : `Line ${e.row + 1}: ${e.message}`,
  );
  const grid = result.data;
  if (grid.length === 0) return { columns: [], rows: [], errors };

  const width = Math.max(...grid.map((r) => r.length));
  const columns = hasHeader
    ? grid[0].map((h, i) => h.trim() || columnLabel(i))
    : Array.from({ length: width }, (_, i) => columnLabel(i));
  const body = hasHeader ? grid.slice(1) : grid;
  const rows = body.map((cells) =>
    Object.fromEntries(columns.map((c, i) => [c, (cells[i] ?? "").trim()])),
  );
  return { columns, rows, errors };
}

/**
 * Parse a money cell. Handles "$1,234.56", "1 234,56" (with decimal ","),
 * "(12.00)", "-12.00", "12.00-" and a trailing "CR" as negative.
 * Returns null for an empty or unreadable cell.
 */
export function parseAmount(cell: string, decimal: "." | ","): number | null {
  let s = cell.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\s*cr$/i.test(s)) {
    negative = !negative;
    s = s.replace(/\s*cr$/i, "");
  }
  s = s.replace(/[$\s ]/g, "").replace(/cad$/i, "");
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  s = decimal === "," ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}

/** Parse a date cell in the given format to YYYY-MM-DD, or null if invalid. */
export function parseDate(cell: string, format: DateFormat): string | null {
  const s = cell.trim();
  const m =
    format === "YYYY-MM-DD"
      ? /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s)
      : /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] =
    format === "YYYY-MM-DD"
      ? [m[1], m[2], m[3]]
      : format === "MM/DD/YYYY"
        ? [m[3], m[1], m[2]]
        : [m[3], m[2], m[1]];
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) ? iso : null;
}

// Statement-line phrases (English and French), matched on word boundaries.
const FEE_PHRASES = [
  "annual fee", "late fee", "late payment fee", "over limit fee", "overlimit fee",
  "foreign transaction fee", "cash advance fee", "balance transfer fee",
  "returned payment fee", "nsf fee", "frais annuels", "frais de retard",
  "frais de transaction etrangere", "frais d avance de fonds",
];
const INTEREST_WORDS = ["interest", "interet", "interets"];
const PAYMENT_WORDS = ["payment", "paiement"];
const PAYMENT_REVERSAL_PHRASES = ["returned payment", "payment reversal", "paiement retourne"];
/** Reward redemptions credited to the card are not refunds and don't reduce spend. */
const REWARD_CREDIT_PHRASES = [
  "cash back redemption", "cashback redemption", "rewards redemption",
  "points redemption", "redemption credit",
];

const matchesAny = (text: string, phrases: readonly string[]) =>
  phrases.some((p) => containsPhrase(text, p));

/**
 * Decide what a line is from its description and signed CAD amount
 * (positive = charge, negative = credit).
 *
 * - Charges: card fee, interest, a returned/reversed payment, else a purchase.
 * - Credits: a fee or interest reversal, a reward redemption or payment
 *   (both "payment"), else a refund.
 */
export function classifyKind(description: string, amountCad: number): TransactionKind {
  if (matchesAny(description, FEE_PHRASES)) return "fee";
  if (matchesAny(description, INTEREST_WORDS)) return "interest";
  if (amountCad >= 0) {
    return matchesAny(description, PAYMENT_REVERSAL_PHRASES) ? "payment" : "purchase";
  }
  if (matchesAny(description, REWARD_CREDIT_PHRASES)) return "payment";
  if (matchesAny(description, PAYMENT_WORDS)) return "payment";
  return "refund";
}

const FOREIGN_CURRENCY_CODES = [
  "usd", "eur", "gbp", "jpy", "mxn", "aud", "nzd", "chf", "cny", "hkd", "inr",
  "krw", "sek", "nok", "dkk", "sgd", "brl", "thb", "php",
];

/**
 * Whether a line was in a foreign currency.
 * - If the mapping has a currency or FX column, that column decides: high confidence.
 * - Otherwise, look for a currency code in the description: low confidence.
 */
export function detectForeign(
  row: Record<string, string>,
  mapping: ColumnMapping,
  description: string,
): { is_foreign: boolean; confidence: Confidence } {
  const cell = (col: string | null) => (col ? (row[col] ?? "").trim() : "");
  const hasFxColumn = Boolean(mapping.currency || mapping.foreign_amount || mapping.exchange_rate);
  if (hasFxColumn) {
    const currency = cell(mapping.currency).toUpperCase();
    const foreign =
      (currency !== "" && currency !== "CAD") ||
      cell(mapping.foreign_amount) !== "" ||
      cell(mapping.exchange_rate) !== "";
    return { is_foreign: foreign, confidence: "high" };
  }
  return { is_foreign: matchesAny(description, FOREIGN_CURRENCY_CODES), confidence: "low" };
}

/**
 * The CAD amount for a row, positive for charges and negative for credits.
 * With debit/credit columns: |debit| − |credit|. With one amount column, its
 * sign is flipped when the export shows purchases as negative.
 */
export function signedAmount(
  row: Record<string, string>,
  mapping: ColumnMapping,
  format: CsvFormat,
): number | null {
  const read = (col: string | null) => (col ? parseAmount(row[col] ?? "", format.decimal_separator) : null);
  if (mapping.amount) {
    const a = read(mapping.amount);
    if (a === null) return null;
    return format.purchase_sign === "negative" ? -a : a;
  }
  const debit = read(mapping.debit);
  const credit = read(mapping.credit);
  if (debit === null && credit === null) return null;
  return Math.abs(debit ?? 0) - Math.abs(credit ?? 0);
}

/** Stable id for a statement line (FNV-1a over its contents). */
export function transactionId(line: number, date: string, description: string, amount: number): string {
  const input = `${line}|${date}|${description}|${amount}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `tx-${line}-${h.toString(16).padStart(8, "0")}`;
}

export interface RowError {
  statement_line: number;
  message: string;
}

export interface IngestResult {
  transactions: Transaction[];
  errors: RowError[];
}

/** Turn parsed rows into Transactions. Rows with a bad date or amount are reported and skipped. */
export function normalizeRows(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  format: CsvFormat,
): IngestResult {
  const transactions: Transaction[] = [];
  const errors: RowError[] = [];
  rows.forEach((row, i) => {
    const statement_line = i + 1;
    const date = parseDate(row[mapping.date] ?? "", format.date_format);
    const amount = signedAmount(row, mapping, format);
    if (date === null) {
      errors.push({ statement_line, message: `Unreadable date "${row[mapping.date] ?? ""}"` });
      return;
    }
    if (amount === null) {
      errors.push({ statement_line, message: "Unreadable or missing amount" });
      return;
    }
    const description = row[mapping.description] ?? "";
    const foreign = detectForeign(row, mapping, description);
    const amount_cad = roundCents(amount);
    transactions.push({
      id: transactionId(statement_line, date, description, amount_cad),
      statement_line,
      date,
      description,
      amount_cad,
      kind: classifyKind(description, amount_cad),
      is_foreign: foreign.is_foreign,
      is_foreign_confidence: foreign.confidence,
      raw: row,
    });
  });
  return { transactions, errors };
}

/** Parse and normalize a statement in one step. */
export function ingestCsv(text: string, mapping: ColumnMapping, format: CsvFormat): IngestResult & { parse_errors: string[] } {
  const parsed = parseCsv(text, format.has_header);
  return { ...normalizeRows(parsed.rows, mapping, format), parse_errors: parsed.errors };
}

/**
 * Pre-fill the column-mapping form when a header is literally named "Date",
 * "Description" or "Amount" (any case). Not a bank-specific guess: the user
 * always confirms the mapping.
 */
export function suggestMapping(columns: string[]): Partial<ColumnMapping> {
  const find = (name: string) => columns.find((c) => c.trim().toLowerCase() === name) ?? null;
  const out: Partial<ColumnMapping> = {};
  const date = find("date");
  const description = find("description");
  const amount = find("amount");
  if (date) out.date = date;
  if (description) out.description = description;
  if (amount) out.amount = amount;
  return out;
}
