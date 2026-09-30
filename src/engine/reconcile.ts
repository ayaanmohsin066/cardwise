/**
 * Statement check: compare estimated points with the points total the user
 * reads off their statement, and suggest category fixes that would explain
 * the difference. Suggestions are never applied automatically; the UI saves
 * an accepted one as an override (Phase 2 mechanism).
 */
import type { Category } from "./categories";
import { CATEGORIES } from "./categories";
import type { Card } from "./card-schema";
import type { CategorizedTransaction } from "./categorize";
import { categoryEarning, effectiveRate, pointsEvaluator, ROUNDING_MODES, type RoundingMode } from "./points";

export interface ReconcileSuggestion {
  transaction_id: string;
  statement_line: number;
  date: string;
  description: string;
  amount_cad: number;
  from: Category;
  to: Category;
  /** Change in estimated points from this suggestion, applied in order. */
  points_change: number;
}

export type OtherCause =
  | "promo_points"
  | "posting_timing"
  | "prior_period_refunds"
  | "rounding"
  | "unverified_terms"
  | "welcome_bonus";

export interface ReconcileResult {
  /** Estimated points, under `rounding_mode` when one matched (else unrounded). */
  estimated_points: number;
  /** Estimated totals under each rounding: unrounded, per line, per statement. */
  totals: { exact: number; per_transaction: number; per_statement: number };
  /**
   * The issuer rounding that reproduces the statement exactly, if any. Save
   * it per card and pass it back as `options.rounding_mode`.
   */
  rounding_mode: RoundingMode | null;
  statement_points: number | null;
  /** statement − estimated. */
  difference: number | null;
  tolerance: number;
  status: "no_statement_total" | "matched" | "explained" | "partly_explained" | "unexplained";
  suggestions: ReconcileSuggestion[];
  /** Difference left after applying all suggestions. */
  remaining_difference: number | null;
  other_causes: OtherCause[];
  /** How many point totals were computed; bounded by `max_evaluations`. */
  evaluations: number;
}

export interface ReconcileOptions {
  /** Most category changes to suggest. Default 5. */
  max_changes?: number;
  /** How many candidate lines the exhaustive search looks at. Default 15. */
  exhaustive_candidates?: number;
  /** Hard limit on point recomputations, so the search always ends. Default 20,000. */
  max_evaluations?: number;
  /**
   * Fallback only, when neither rounding mode reproduces the statement exactly:
   * differences within this many points count as matched. Default: 0.5 per
   * spend line, at least 1.
   */
  tolerance?: number;
  /** The rounding mode previously found for this card. Tried first, and used for the search. */
  rounding_mode?: RoundingMode | null;
}

interface Change {
  id: string;
  to: Category;
}

/**
 * Explain the gap between estimated and statement points.
 *
 * First, if the total with per-transaction or per-statement rounding equals
 * the statement exactly, that's a match (and the mode is returned). Only if
 * neither matches does the `tolerance` fallback apply.
 *
 * Only low-confidence purchase/refund lines are candidates, and only moves to
 * categories whose headline rate on this card differs from the current one
 * (and is verified). Search: rank each candidate by its best single change,
 * keep the top `exhaustive_candidates`, then take the better of a greedy pass
 * and an exhaustive search over subsets of up to `max_changes` of them.
 */
export function reconcile(
  card: Card,
  items: readonly CategorizedTransaction[],
  statement_points: number | null,
  options: ReconcileOptions = {},
): ReconcileResult {
  const maxChanges = options.max_changes ?? 5;
  const topN = options.exhaustive_candidates ?? 15;
  const budget = options.max_evaluations ?? 20_000;
  const spend = items.filter((i) => i.category !== null && (i.transaction.kind === "purchase" || i.transaction.kind === "refund"));
  const tolerance = options.tolerance ?? Math.max(1, 0.5 * spend.length);

  let evaluations = 0;
  const stored = options.rounding_mode ?? null;
  const evaluate = pointsEvaluator(card, items, stored);
  const pointsWith = (changes: readonly Change[]): number => {
    evaluations += 1;
    return evaluate(changes.length ? new Map(changes.map((c) => [c.id, c.to])) : undefined);
  };
  // Categories that earn identically (same rule, or same rate/cap/after-cap)
  // are interchangeable for the search; keep one of each.
  const earningKey = (c: Category) => {
    const e = categoryEarning(card, c);
    return e.ok ? `${e.rule_index ?? "base"}|${e.rate}|${e.cap?.id ?? ""}|${e.after_cap_rate}` : "unverified";
  };

  const totals = {
    exact: pointsEvaluator(card, items)(),
    per_transaction: pointsEvaluator(card, items, "per_transaction")(),
    per_statement: pointsEvaluator(card, items, "per_statement")(),
  };
  const estimated = pointsWith([]);
  const hasUnverified = spend.some((i) => effectiveRate(card, i.category!) === null);
  const hasRefunds = spend.some((i) => i.transaction.kind === "refund");
  const causes = (): OtherCause[] => {
    const c: OtherCause[] = ["promo_points", "posting_timing"];
    if (hasRefunds) c.push("prior_period_refunds");
    c.push("rounding");
    if (hasUnverified) c.push("unverified_terms");
    if (card.welcome_bonus && card.welcome_bonus.length > 0) c.push("welcome_bonus");
    return c;
  };
  const base = { estimated_points: estimated, totals, rounding_mode: null as RoundingMode | null, tolerance };

  if (statement_points === null) {
    return { ...base, statement_points: null, difference: null, status: "no_statement_total", suggestions: [], remaining_difference: null, other_causes: [], evaluations };
  }
  // Exact match under the issuer's rounding (stored mode first). The epsilon
  // only absorbs float error, e.g. from reading $14.80 as 1,479.9999… points.
  const modes = stored ? [stored, ...ROUNDING_MODES.filter((m) => m !== stored)] : [...ROUNDING_MODES];
  for (const mode of modes) {
    if (Math.abs(statement_points - totals[mode]) < 1e-6) {
      return {
        ...base, estimated_points: totals[mode], rounding_mode: mode, statement_points, difference: 0,
        status: "matched", suggestions: [], remaining_difference: 0, other_causes: [], evaluations,
      };
    }
  }
  const difference = statement_points - estimated;
  if (Math.abs(difference) <= tolerance) {
    return { ...base, statement_points, difference, status: "matched", suggestions: [], remaining_difference: difference, other_causes: [], evaluations };
  }

  // Candidates: low-confidence spend lines and their alternative categories.
  const byId = new Map(spend.map((i) => [i.transaction.id, i]));
  const candidates = spend
    .filter((i) => i.confidence === "low")
    .flatMap((i) => {
      const current = effectiveRate(card, i.category!);
      const seenKeys = new Set<string>();
      const alts = CATEGORIES.filter((c) => {
        const r = effectiveRate(card, c);
        if (c === i.category || r === null || r === current) return false;
        const k = earningKey(c);
        if (seenKeys.has(k)) return false;
        seenKeys.add(k);
        return true;
      });
      return alts.length ? [{ item: i, alts }] : [];
    });

  const gapAfter = (changes: readonly Change[]) => statement_points - pointsWith(changes);

  // Rank each candidate by its best single change.
  const ranked = candidates
    .map(({ item, alts }) => {
      let best: { change: Change; gap: number } | null = null;
      for (const to of alts) {
        if (evaluations >= budget) break;
        const change = { id: item.transaction.id, to };
        const gap = Math.abs(gapAfter([change]));
        if (best === null || gap < best.gap) best = { change, gap };
      }
      return best;
    })
    .filter((b): b is { change: Change; gap: number } => b !== null && b.gap < Math.abs(difference))
    .sort((a, b) => a.gap - b.gap)
    .slice(0, topN);

  // Greedy: repeatedly add the single change (any alternative) that most shrinks the gap.
  const greedy: Change[] = [];
  let greedyGap = Math.abs(difference);
  for (let step = 0; step < maxChanges && greedyGap > tolerance; step++) {
    let bestStep: { change: Change; gap: number } | null = null;
    for (const { change } of ranked) {
      if (greedy.some((g) => g.id === change.id)) continue;
      const item = byId.get(change.id)!;
      for (const to of candidates.find((c) => c.item === item)!.alts) {
        if (evaluations >= budget) break;
        const next = { id: change.id, to };
        const gap = Math.abs(gapAfter([...greedy, next]));
        if (gap < (bestStep?.gap ?? greedyGap)) bestStep = { change: next, gap };
      }
    }
    if (!bestStep) break;
    greedy.push(bestStep.change);
    greedyGap = bestStep.gap;
  }

  // Exhaustive: subsets (up to maxChanges) of the ranked candidates, each using its best single change.
  let exhaustive: Change[] = [];
  let exhaustiveGap = Math.abs(difference);
  const pool = ranked.map((r) => r.change);
  const search = (start: number, chosen: Change[]) => {
    if (chosen.length > 0) {
      const gap = Math.abs(gapAfter(chosen));
      if (gap < exhaustiveGap - 1e-9 || (Math.abs(gap - exhaustiveGap) <= 1e-9 && chosen.length < exhaustive.length)) {
        exhaustive = [...chosen];
        exhaustiveGap = gap;
      }
    }
    if (chosen.length === maxChanges) return;
    for (let i = start; i < pool.length && evaluations < budget; i++) {
      chosen.push(pool[i]);
      search(i + 1, chosen);
      chosen.pop();
    }
  };
  search(0, []);

  const chosen =
    exhaustiveGap < greedyGap - 1e-9 || (Math.abs(exhaustiveGap - greedyGap) <= 1e-9 && exhaustive.length < greedy.length)
      ? exhaustive
      : greedy;

  // Report each suggestion's effect in order.
  const suggestions: ReconcileSuggestion[] = [];
  let prev = estimated;
  chosen.forEach((c, k) => {
    const now = pointsWith(chosen.slice(0, k + 1));
    const t = byId.get(c.id)!;
    suggestions.push({
      transaction_id: c.id,
      statement_line: t.transaction.statement_line,
      date: t.transaction.date,
      description: t.transaction.description,
      amount_cad: t.transaction.amount_cad,
      from: t.category!,
      to: c.to,
      points_change: now - prev,
    });
    prev = now;
  });
  const remaining = statement_points - prev;
  const status =
    suggestions.length === 0
      ? "unexplained"
      : Math.abs(remaining) <= tolerance
        ? "explained"
        : "partly_explained";
  return {
    ...base,
    statement_points,
    difference,
    status,
    suggestions,
    remaining_difference: remaining,
    other_causes: status === "explained" ? [] : causes(),
    evaluations,
  };
}
