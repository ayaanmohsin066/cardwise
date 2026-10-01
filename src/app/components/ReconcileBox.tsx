"use client";

import { useState } from "react";
import {
  pointsFromDollars,
  reconcile,
  valuePerDollar,
  setOverride,
  type Card,
  type CategorizedTransaction,
  type OtherCause,
  type Overrides,
  type Program,
  type ReconcileResult,
  type RoundingMode,
} from "@/engine";
import { CATEGORY_LABELS, formatCad, formatPoints } from "../lib/format";
import { loadRounding, saveRounding } from "../lib/rounding-storage";
import { parseTypedAmount } from "../lib/typed-amount";

interface Props {
  card: Card;
  program: Program | null;
  redemptionMethod: string | null;
  isCash: boolean;
  items: CategorizedTransaction[];
  overrides: Overrides;
  onOverrides: (o: Overrides) => void;
}

const CAUSES: Record<OtherCause, string> = {
  promo_points: "Promotional or bonus points the issuer added",
  posting_timing: "Purchases near the statement date posted in a different period",
  prior_period_refunds: "Refunds for purchases from an earlier statement",
  rounding: "The issuer rounding points differently",
  unverified_terms: "Card terms that aren't verified yet, so they're left out of the estimate",
  welcome_bonus: "Welcome bonus points posted on this statement",
};

export function ReconcileBox({ card, program, redemptionMethod, isCash, items, overrides, onOverrides }: Props) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Mounted after the user imports a statement, so reading localStorage here is safe.
  const [rounding, setRounding] = useState<RoundingMode | null>(() => loadRounding(card.id));
  const fmt = (points: number) => {
    const d = isCash && program && redemptionMethod ? valuePerDollar(points, program, redemptionMethod) : null;
    return d === null ? `${formatPoints(points)} pts` : formatCad(d);
  };

  function check() {
    setError(null);
    const n = parseTypedAmount(input);
    if (n === null) {
      setError(isCash ? "Enter the cash back shown on your statement." : "Enter the points shown on your statement.");
      return;
    }
    let statementPoints: number | null = n;
    if (isCash) {
      statementPoints = program && redemptionMethod ? pointsFromDollars(n, program, redemptionMethod) : null;
      if (statementPoints === null) {
        setError("This card's cash-back value isn't verified, so it can't be compared.");
        return;
      }
    }
    const r = reconcile(card, items, statementPoints, { rounding_mode: rounding });
    if (r.rounding_mode && r.rounding_mode !== rounding) {
      saveRounding(card.id, r.rounding_mode);
      setRounding(r.rounding_mode);
    }
    setResult(r);
  }

  function accept(description: string, to: keyof typeof CATEGORY_LABELS) {
    onOverrides(setOverride(overrides, description, to));
    setResult(null);
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
      <div className="flex flex-col gap-1">
      <p className="eyebrow">Statement check</p>
      <h4 className="section-title">Check against your statement</h4>
      <p className="max-w-2xl text-xs leading-relaxed text-muted">
        Type the {isCash ? "cash back" : "points"} your statement says you earned for this period. If it
        doesn&apos;t match, CardOpt looks for unsure categories that would explain the difference.
      </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {isCash ? "Cash back on statement ($)" : "Points on statement"}
          <input
            inputMode="decimal"
            className="field w-44 font-normal tabular-nums"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          onClick={check}
        >
          Check
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      {result && result.difference !== null && (
        <div className="flex flex-col gap-3 border-t border-border pt-4 text-sm" role="status">
          {result.status === "matched" ? (
            <p>
              {result.rounding_mode
                ? `Matches exactly (${fmt(result.estimated_points)}) when ${result.rounding_mode === "per_transaction" ? "each purchase is rounded to a whole point" : "only the statement total is rounded"}. CardOpt will remember this for this card.`
                : `Matches the estimate (${fmt(result.estimated_points)}) within rounding, though neither rounding method matches exactly.`}
            </p>
          ) : (
            <>
              <p>
                Estimate {fmt(result.estimated_points)}, statement {fmt(result.statement_points!)}: a difference of{" "}
                {fmt(result.difference)}.
              </p>
              {result.suggestions.length > 0 && (
                <>
                  <p className="text-muted">These category changes would explain {result.status === "explained" ? "it" : "part of it"}:</p>
                  <ul className="flex flex-col gap-2">
                    {result.suggestions.map((s) => (
                      <li key={s.transaction_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                        <span>
                          Line {s.statement_line}, {s.date}: {s.description} ({formatCad(s.amount_cad)}):{" "}
                          {CATEGORY_LABELS[s.from]} → <strong>{CATEGORY_LABELS[s.to]}</strong>{" "}
                          <span className={`tabular-nums ${s.points_change > 0 ? "text-gain" : s.points_change < 0 ? "text-loss" : "text-muted"}`}>
                            ({s.points_change >= 0 ? "+" : ""}{fmt(s.points_change)})
                          </span>
                        </span>
                        <button type="button" className="btn btn-sm" onClick={() => accept(s.description, s.to)}>
                          Accept
                        </button>
                      </li>
                    ))}
                  </ul>
                  {result.status !== "explained" && result.remaining_difference !== null && (
                    <p className="text-muted">Still unexplained: {fmt(result.remaining_difference)}.</p>
                  )}
                </>
              )}
              {result.other_causes.length > 0 && (
                <>
                  <p className="text-muted">Other possible reasons:</p>
                  <ul className="list-disc pl-5 text-muted">
                    {result.other_causes.map((c) => (
                      <li key={c}>{CAUSES[c]}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
