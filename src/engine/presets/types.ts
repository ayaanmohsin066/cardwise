/** How a bank's CSV export is laid out. */

export const DATE_FORMATS = ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export interface CsvFormat {
  /** False for exports with no header row; columns are then named "Column 1", "Column 2", ... */
  has_header: boolean;
  date_format: DateFormat;
  decimal_separator: "." | ",";
  /**
   * Only used with a single `amount` column: whether purchases appear as
   * positive or negative numbers. Debit/credit columns don't need it.
   */
  purchase_sign: "positive" | "negative";
}

/** Column names in the CSV. Either `amount`, or `debit` and/or `credit`. */
export interface ColumnMapping {
  date: string;
  description: string;
  amount: string | null;
  debit: string | null;
  credit: string | null;
  /** Optional: currency of the original transaction (e.g. "USD"). */
  currency: string | null;
  /** Optional: amount in the original currency. Non-empty means foreign. */
  foreign_amount: string | null;
  /** Optional: exchange rate applied. Non-empty means foreign. */
  exchange_rate: string | null;
}

export interface Preset {
  id: string;
  /** Issuer id from src/data/issuers.json, or null for the generic preset. */
  issuer_id: string | null;
  label: string;
  /**
   * True only when mapping and format were checked against a real sample
   * export. Unverified presets have mapping and format null, and the user
   * maps columns in the UI. Never guess column names.
   */
  verified: boolean;
  mapping: ColumnMapping | null;
  format: CsvFormat | null;
  notes: string;
}
