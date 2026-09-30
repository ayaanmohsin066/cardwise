"use client";

import { DATE_FORMATS, type ColumnMapping, type CsvFormat, type DateFormat } from "@/engine";

/** Editable form state. Empty string means "not chosen". */
export interface MappingDraft {
  date: string;
  description: string;
  amountMode: "single" | "split";
  amount: string;
  debit: string;
  credit: string;
  currency: string;
  foreign_amount: string;
  exchange_rate: string;
}

export const emptyDraft = (over: Partial<MappingDraft> = {}): MappingDraft => ({
  date: "",
  description: "",
  amountMode: "single",
  amount: "",
  debit: "",
  credit: "",
  currency: "",
  foreign_amount: "",
  exchange_rate: "",
  ...over,
});

/** The ColumnMapping for a complete draft, or null if required columns are missing. */
export function draftToMapping(d: MappingDraft): ColumnMapping | null {
  const opt = (s: string) => (s ? s : null);
  if (!d.date || !d.description) return null;
  if (d.amountMode === "single" && !d.amount) return null;
  if (d.amountMode === "split" && !d.debit && !d.credit) return null;
  return {
    date: d.date,
    description: d.description,
    amount: d.amountMode === "single" ? d.amount : null,
    debit: d.amountMode === "split" ? opt(d.debit) : null,
    credit: d.amountMode === "split" ? opt(d.credit) : null,
    currency: opt(d.currency),
    foreign_amount: opt(d.foreign_amount),
    exchange_rate: opt(d.exchange_rate),
  };
}

const field = "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground";

interface Props {
  columns: string[];
  draft: MappingDraft;
  format: CsvFormat;
  onDraft: (d: MappingDraft) => void;
  onFormat: (f: CsvFormat) => void;
}

export function MappingForm({ columns, draft, format, onDraft, onFormat }: Props) {
  const column = (label: string, key: keyof MappingDraft, optional = false) => (
    <label className="flex flex-col gap-1 text-sm">
      <span>
        {label}
        {optional && <span className="text-muted"> (optional)</span>}
      </span>
      <select className={field} value={draft[key]} onChange={(e) => onDraft({ ...draft, [key]: e.target.value })}>
        <option value="">{optional ? "None" : "Choose a column"}</option>
        {columns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={format.has_header}
          onChange={(e) => onFormat({ ...format, has_header: e.target.checked })}
        />
        The first row is column names
      </label>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {column("Date", "date")}
        {column("Description", "description")}
        <label className="flex flex-col gap-1 text-sm">
          Date format
          <select
            className={field}
            value={format.date_format}
            onChange={(e) => onFormat({ ...format, date_format: e.target.value as DateFormat })}
          >
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Amounts</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={draft.amountMode === "single"}
              onChange={() => onDraft({ ...draft, amountMode: "single" })}
            />
            One amount column
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={draft.amountMode === "split"}
              onChange={() => onDraft({ ...draft, amountMode: "split" })}
            />
            Separate debit and credit columns
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {draft.amountMode === "single" ? (
            <>
              {column("Amount", "amount")}
              <label className="flex flex-col gap-1 text-sm">
                Purchases are shown as
                <select
                  className={field}
                  value={format.purchase_sign}
                  onChange={(e) =>
                    onFormat({ ...format, purchase_sign: e.target.value as CsvFormat["purchase_sign"] })
                  }
                >
                  <option value="positive">Positive numbers (refunds negative)</option>
                  <option value="negative">Negative numbers (refunds positive)</option>
                </select>
              </label>
            </>
          ) : (
            <>
              {column("Debit (charges)", "debit")}
              {column("Credit (refunds, payments)", "credit")}
            </>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Decimal separator
            <select
              className={field}
              value={format.decimal_separator}
              onChange={(e) =>
                onFormat({ ...format, decimal_separator: e.target.value as CsvFormat["decimal_separator"] })
              }
            >
              <option value=".">Point (12.34)</option>
              <option value=",">Comma (12,34)</option>
            </select>
          </label>
        </div>
      </fieldset>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Foreign-currency columns (optional)</summary>
        <p className="mt-2 text-muted">
          If your export has any of these, foreign purchases are detected reliably. Otherwise
          CardOpt guesses from the description and marks the guess as unsure.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {column("Currency", "currency", true)}
          {column("Foreign amount", "foreign_amount", true)}
          {column("Exchange rate", "exchange_rate", true)}
        </div>
      </details>
    </div>
  );
}
