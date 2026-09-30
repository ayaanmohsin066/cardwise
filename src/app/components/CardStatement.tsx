"use client";

import { useMemo, useState } from "react";
import {
  categorizeAll,
  isUsablePreset,
  normalizeRows,
  parseCsv,
  presetForIssuer,
  removeOverride,
  setOverride,
  suggestMapping,
  summarizeStatement,
  type Category,
  type CsvFormat,
  type Overrides,
  type RowError,
  type Transaction,
} from "@/engine";
import type { CardOption } from "../lib/catalog";
import { loadOverrides, saveOverrides } from "../lib/overrides-storage";
import { MERCHANT_RULES } from "../lib/rules";
import { draftToMapping, emptyDraft, MappingForm, type MappingDraft } from "./MappingForm";
import { ReviewTable } from "./ReviewTable";
import { StatementSummary } from "./StatementSummary";

const DEFAULT_FORMAT: CsvFormat = {
  has_header: true,
  date_format: "YYYY-MM-DD",
  decimal_separator: ".",
  purchase_sign: "positive",
};

function draftFor(columns: string[]): MappingDraft {
  const s = suggestMapping(columns);
  return emptyDraft({ date: s.date ?? "", description: s.description ?? "", amount: s.amount ?? "" });
}

interface Props {
  card: CardOption;
  issuerName: string;
}

export function CardStatement({ card, issuerName }: Props) {
  const preset = presetForIssuer(card.issuer);
  const usable = isUsablePreset(preset);

  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [readError, setReadError] = useState<string | null>(null);
  const [format, setFormat] = useState<CsvFormat>(usable && preset.format ? preset.format : DEFAULT_FORMAT);
  const [draft, setDraft] = useState<MappingDraft>(emptyDraft());
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [rowErrors, setRowErrors] = useState<RowError[]>([]);
  // Created after the user adds the card, so reading localStorage here is safe.
  const [overrides, setOverrides] = useState<Overrides>(() => loadOverrides(card.id));
  const [saveFailed, setSaveFailed] = useState(false);

  const parsed = useMemo(() => parseCsv(text, format.has_header), [text, format.has_header]);
  const mapping = draftToMapping(draft);
  const categorized = useMemo(
    () => (transactions ? categorizeAll(transactions, MERCHANT_RULES, overrides) : []),
    [transactions, overrides],
  );
  const summary = useMemo(() => summarizeStatement(categorized), [categorized]);

  async function onFile(file: File | undefined) {
    setTransactions(null);
    setRowErrors([]);
    setReadError(null);
    if (!file) return;
    try {
      // Read locally. The file never leaves the browser.
      const content = await file.text();
      setFileName(file.name);
      setText(content);
      setDraft(draftFor(parseCsv(content, format.has_header).columns));
    } catch {
      setReadError("Couldn't read that file.");
    }
  }

  function onFormat(next: CsvFormat) {
    if (next.has_header !== format.has_header) {
      setDraft(draftFor(parseCsv(text, next.has_header).columns));
      setTransactions(null);
    }
    setFormat(next);
  }

  function runImport() {
    if (!mapping) return;
    const result = normalizeRows(parsed.rows, mapping, format);
    setTransactions(result.transactions);
    setRowErrors(result.errors);
  }

  function updateOverrides(next: Overrides) {
    setOverrides(next);
    setSaveFailed(!saveOverrides(card.id, next));
  }

  const onCategory = (description: string, category: Category) =>
    updateOverrides(setOverride(overrides, description, category));
  const onResetCategory = (description: string) => updateOverrides(removeOverride(overrides, description));
  const overrideCount = Object.keys(overrides).length;

  return (
    <section className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{card.name}</h2>
          <p className="text-sm text-muted">
            {issuerName}
            {card.is_fixture && " · FAKE test fixture"}
          </p>
        </div>
        {overrideCount > 0 && (
          <button
            type="button"
            className="text-sm text-muted underline hover:text-danger"
            onClick={() => updateOverrides({})}
          >
            Clear {overrideCount} saved correction{overrideCount === 1 ? "" : "s"}
          </button>
        )}
      </header>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={`file-${card.id}`}>
          Statement CSV
        </label>
        <input
          id={`file-${card.id}`}
          type="file"
          accept=".csv,text/csv"
          className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        {readError && <p className="text-sm text-danger">{readError}</p>}
        <p className="text-xs text-muted">
          {usable
            ? `Using the verified ${preset.label} format.`
            : preset.issuer_id
              ? `We don't have a verified ${preset.label} export format yet, so choose the columns below.`
              : "Choose which column is which below."}
        </p>
      </div>

      {fileName && parsed.columns.length > 0 && (
        <div className="flex flex-col gap-4 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">
            Columns in {fileName} <span className="font-normal text-muted">({parsed.rows.length} rows)</span>
          </h3>
          <MappingForm columns={parsed.columns} draft={draft} format={format} onDraft={setDraft} onFormat={onFormat} />
          {parsed.errors.length > 0 && (
            <p className="text-sm text-danger">Some lines couldn&apos;t be read: {parsed.errors.slice(0, 3).join("; ")}</p>
          )}
          <div>
            <button
              type="button"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
              disabled={!mapping}
              onClick={runImport}
            >
              {transactions ? "Re-import with these columns" : "Import transactions"}
            </button>
          </div>
        </div>
      )}
      {fileName && parsed.columns.length === 0 && (
        <p className="text-sm text-danger">That file has no rows.</p>
      )}

      {transactions && (
        <div className="flex flex-col gap-5 border-t border-border pt-4">
          {rowErrors.length > 0 && (
            <div className="rounded-md border border-danger px-3 py-2 text-sm">
              {rowErrors.length} line{rowErrors.length === 1 ? " was" : "s were"} skipped:
              <ul className="mt-1 list-disc pl-5 text-muted">
                {rowErrors.slice(0, 5).map((e) => (
                  <li key={e.statement_line}>
                    Line {e.statement_line}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {saveFailed && (
            <p className="text-sm text-danger">
              This browser blocked saving, so your corrections will be lost when you close the tab.
            </p>
          )}
          <StatementSummary summary={summary} />
          <ReviewTable items={categorized} onCategory={onCategory} onReset={onResetCategory} />
        </div>
      )}
    </section>
  );
}
