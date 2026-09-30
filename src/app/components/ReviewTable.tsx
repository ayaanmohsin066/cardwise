"use client";

import { useState } from "react";
import { CATEGORIES, type CategorizedTransaction, type Category } from "@/engine";
import { CATEGORY_LABELS, formatCad, KIND_LABELS } from "../lib/format";

interface Props {
  items: CategorizedTransaction[];
  onCategory: (description: string, category: Category) => void;
  onReset: (description: string) => void;
  /** Refund id -> statement line of the purchase it matched, or null if unmatched. */
  refundMatches?: ReadonlyMap<string, number | null>;
}

const SOURCE_LABELS = {
  override: "Your correction",
  rule: "Merchant rule",
  unmatched: "No match",
  excluded: "Not spending",
} as const;

export function ReviewTable({ items, onCategory, onReset, refundMatches }: Props) {
  const [onlyReview, setOnlyReview] = useState(false);
  const toReview = items.filter((i) => i.confidence === "low").length;
  const shown = onlyReview ? items.filter((i) => i.confidence === "low") : items;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Transactions{" "}
          <span className="font-normal text-muted">
            ({items.length}; {toReview} to review)
          </span>
        </h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
          Show only rows to review
        </label>
      </div>
      <p className="text-xs text-muted">
        Highlighted rows are unsure guesses. Changing a category saves a correction for that merchant
        on this card, and it&apos;s applied to every matching line.
      </p>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-background text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Line</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Category</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((item) => {
              const t = item.transaction;
              const review = item.confidence === "low";
              return (
                <tr
                  key={t.id}
                  className={`border-t border-border ${review ? "bg-review" : ""}`}
                  aria-label={review ? "Needs review" : undefined}
                >
                  <td className="px-3 py-2 tabular-nums text-muted">{t.statement_line}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{t.date}</td>
                  <td className="px-3 py-2">
                    <div>{t.description}</div>
                    {t.is_foreign && (
                      <div className="text-xs text-muted">
                        Foreign currency{t.is_foreign_confidence === "low" ? " (unsure)" : ""}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatCad(t.amount_cad)}</td>
                  <td className="px-3 py-2">
                    <div>{KIND_LABELS[t.kind]}</div>
                    {t.kind === "refund" && refundMatches?.has(t.id) && (
                      <div className="text-xs text-muted">
                        {refundMatches.get(t.id) === null
                          ? "Not matched to a purchase (points estimated)"
                          : `Matches line ${refundMatches.get(t.id)}`}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {item.category === null ? (
                      <span className="text-muted">Not spending</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <select
                          className={`rounded-md border bg-surface px-2 py-1 text-sm text-foreground ${review ? "border-review-border" : "border-border"}`}
                          value={item.category}
                          aria-label={`Category for ${t.description}`}
                          onChange={(e) => onCategory(t.description, e.target.value as Category)}
                        >
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {CATEGORY_LABELS[c]}
                            </option>
                          ))}
                        </select>
                        <span className="text-xs text-muted">
                          {SOURCE_LABELS[item.source]}
                          {item.source === "override" && (
                            <>
                              {" · "}
                              <button type="button" className="underline" onClick={() => onReset(t.description)}>
                                undo
                              </button>
                            </>
                          )}
                        </span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
