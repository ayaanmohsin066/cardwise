/**
 * "Earn more" recommendations. All values shown come from replaying real
 * transactions (policy.ts), annualized from the months covered and labelled a
 * projection. LP objectives are never returned for display.
 */
import { CATEGORIES, type Category } from "./categories";
import type { CategorizedTransaction } from "./categorize";
import type { LpSolver } from "./lp";
import {
  earnOptions,
  resolveCard,
  solveRouting,
  spendCells,
  type BonusTarget,
  type CardSetEntry,
  type CategoryPolicy,
  type CreditRule,
  type RoutingMode,
  type SpendCell,
} from "./optimize";
import { actualAssignment, annualCredits, poolStatements, routeTransactions, scoreAssignment, type Pool, type Score } from "./policy";
import { valuePerDollar } from "./value";

/** Annualization note shared by every recommendation. */
export interface Projection {
  months: number;
  /** Multiply period values by this to annualize (12 / months). */
  factor: number;
  /** Fewer than 3 months: seasonal spending may skew the projection. */
  short_data: boolean;
}

export function projection(months: number): Projection {
  return { months, factor: months > 0 ? 12 / months : 0, short_data: months < 3 };
}

interface Evaluation {
  score: Score;
  policy: CategoryPolicy[];
  credit_rules: CreditRule[];
  pursued: string[];
  /** Pursued bonuses whose required spend is a pace (data shorter than the window). */
  projected_bonus: boolean;
}

type Excluded = { card_id: string; name: string; reasons: string[] };

/** Solve, replay every case, and keep the best replayed value. */
function evaluateSet(
  entries: readonly CardSetEntry[],
  pool: Pool,
  cells: readonly SpendCell[],
  mode: RoutingMode,
  solver: LpSolver,
): { evaluation: Evaluation | null; excluded: Excluded[]; error?: string } {
  const r = solveRouting(entries, cells, mode, solver);
  if (r.status === "error") return { evaluation: null, excluded: r.excluded, error: r.message };
  if (r.status !== "ok" || r.excluded.length > 0) return { evaluation: null, excluded: r.excluded };
  const windowOf = (t: BonusTarget) => ({ ...t, window_months: r.months.slice(0, t.window_months_in_data) });
  let best: Evaluation | null = null;
  for (const c of r.cases) {
    const targets = r.bonus_targets.filter((t) => c.pursued.includes(t.card_id)).map(windowOf);
    const assignment = routeTransactions(c.policy, pool.spend, targets, c.credit_rules);
    const score = scoreAssignment(entries, assignment, pool.credits, mode, r.months, targets);
    if (!best || score.total_annual > best.score.total_annual + 1e-9) {
      best = { score, policy: c.policy, credit_rules: c.credit_rules, pursued: c.pursued, projected_bonus: targets.some((t) => t.projected) };
    }
  }
  return { evaluation: best, excluded: [] };
}

export interface CategoryMove {
  category: Category;
  /** Net spend by card, data period. */
  current: { card_id: string; spend: number }[];
  suggested: { card_id: string; spend: number }[];
  /** Replayed value change for this category, per year (projection). */
  gain_annual: number;
}

export interface UseBetterResult {
  status: "ok" | "no_data" | "no_usable_cards" | "error";
  message?: string;
  projection: Projection;
  /** Owned cards left out because a needed term is unverified (their spend is left out too). */
  excluded: Excluded[];
  policy: CategoryPolicy[];
  /** Purchase credits the policy captures first. */
  credit_rules: CreditRule[];
  current: Score | null;
  suggested: Score | null;
  /** suggested − current, per year (projection). */
  gain_annual: number;
  moves: CategoryMove[];
  /** Purchase credits captured (suggested − current), per year. Not part of any category. */
  credit_gain_annual: number;
  /** The rest of gain_annual (FX fees, rounding): gain − Σ moves − credits, so the parts add up. */
  other_gain_annual: number;
}

const toList = (m: Map<string, number> | undefined) =>
  [...(m ?? new Map<string, number>())].map(([card_id, spend]) => ({ card_id, spend })).filter((x) => Math.abs(x.spend) > 1e-9);

/**
 * "Use your cards better": the best routing of the user's own spend across
 * the cards they already hold, compared with what they actually did.
 */
export function bestUseOfCards(
  owned: readonly CardSetEntry[],
  itemsByCard: ReadonlyMap<string, readonly CategorizedTransaction[]>,
  solver: LpSolver,
): UseBetterResult {
  const empty = { policy: [], credit_rules: [], current: null, suggested: null, gain_annual: 0, moves: [], credit_gain_annual: 0, other_gain_annual: 0 };
  const allCells = spendCells([...itemsByCard.values()].flat());
  const probe = solveRouting(owned, allCells, "ongoing", solver);
  const usable = owned.filter((e) => probe.cards.includes(e.card.id));
  const pool = poolStatements(new Map([...itemsByCard].filter(([id]) => probe.cards.includes(id))));
  const cells = spendCells(pool.spend);
  const proj = projection(probe.months.length);
  if (pool.spend.length === 0 && usable.length > 0) return { ...empty, status: "no_data", projection: proj, excluded: probe.excluded };
  if (usable.length === 0) return { ...empty, status: "no_usable_cards", projection: proj, excluded: probe.excluded };

  const r = evaluateSet(usable, pool, cells, "ongoing", solver);
  if (!r.evaluation) return { ...empty, status: "error", message: r.error, projection: proj, excluded: probe.excluded };
  const months = r.evaluation.score.months;
  const current = scoreAssignment(usable, actualAssignment(pool), pool.credits, "ongoing", monthList(cells, months));
  const suggested = r.evaluation.score;

  const moves: CategoryMove[] = CATEGORIES.filter((c) => current.category_spend.has(c) || suggested.category_spend.has(c))
    .map((category) => ({
      category,
      current: toList(current.category_spend.get(category)),
      suggested: toList(suggested.category_spend.get(category)),
      gain_annual: (suggested.category_annual.get(category) ?? 0) - (current.category_annual.get(category) ?? 0),
    }))
    .sort((a, b) => b.gain_annual - a.gain_annual);

  const factor = 12 / months;
  const credits = (sc: Score) => sc.cards.reduce((t, c) => t + annualCredits(c.report, factor), 0);
  const gain_annual = suggested.total_annual - current.total_annual;
  const credit_gain_annual = credits(suggested) - credits(current);
  const other_gain_annual = gain_annual - moves.reduce((t, m) => t + m.gain_annual, 0) - credit_gain_annual;

  return {
    status: "ok",
    projection: projection(months),
    excluded: probe.excluded,
    policy: r.evaluation.policy,
    credit_rules: r.evaluation.credit_rules,
    current,
    suggested,
    gain_annual,
    moves,
    credit_gain_annual,
    other_gain_annual,
  };
}

function monthList(cells: readonly SpendCell[], count: number): string[] {
  const months = [...new Set(cells.map((c) => c.month))].sort();
  if (months.length === 0) return [];
  const [y, m] = months[0].split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const n = y * 12 + m - 1 + i;
    return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
  });
}

export interface CardChange {
  /** "replace" swaps `remove` for `add`; "add" adds a card (fewer than 3 held). */
  action: "replace" | "add";
  remove: string | null;
  add: string;
  cards: string[];
  /**
   * gain_annual: versus the current cards used as suggested (the card change alone).
   * total_gain_annual: versus how the cards were actually used (routing gain + gain_annual).
   */
  ongoing: { total_annual: number; gain_annual: number; total_gain_annual: number; policy: CategoryPolicy[]; credit_rules: CreditRule[] };
  first_year: {
    total_annual: number;
    gain_annual: number;
    total_gain_annual: number;
    bonus_value: number;
    bonus_pursued: boolean;
    /** The bonus spend requirement was checked against a pace (data shorter than the window). */
    bonus_projected: boolean;
  };
}

export interface ChangeResult {
  projection: Projection;
  /** Value of the user's current cards used as suggested (the baseline for gains), per year. */
  baseline_annual: number;
  /** Value of the user's current cards as actually used, per year (same spend pool). */
  actual_annual: number;
  /** baseline_annual − actual_annual: the gain from routing alone. */
  routing_gain_annual: number;
  /** Candidates evaluated and, if pruning ran, how many were skipped. */
  evaluated: number;
  pruned: string[];
  changes: CardChange[];
  /** Catalogue cards that couldn't be evaluated, with reasons. */
  excluded: Excluded[];
}

/**
 * "Change a card": replace each owned card with each catalogue card, and add
 * one when fewer than 3 are held. Ranked by ongoing gain after fees versus the
 * user's current cards used well. First-year and ongoing are separate.
 */
export interface ChangeOptions {
  /** Called after each candidate set is evaluated. */
  onProgress?: (done: number, total: number) => void;
  /**
   * Skip catalogue cards that can't beat the current cards (see pruneCatalogue).
   * Default false: 100 cards × 3 owned runs in under a second (tests/engine/benchmark.test.ts).
   */
  prune?: boolean;
}

export function changeACard(
  owned: readonly CardSetEntry[],
  itemsByCard: ReadonlyMap<string, readonly CategorizedTransaction[]>,
  catalogue: readonly CardSetEntry[],
  solver: LpSolver,
  options: ChangeOptions = {},
): ChangeResult {
  const allCells = spendCells([...itemsByCard.values()].flat());
  const probe = solveRouting(owned, allCells, "ongoing", solver);
  const usableOwned = owned.filter((e) => probe.cards.includes(e.card.id)).map((e) => ({ ...e, is_new: false }));
  // Same spend pool as bestUseOfCards (owned cards with verified terms), so
  // routing gain + card-change gain adds up to the gain versus actual use.
  const pool = poolStatements(new Map([...itemsByCard].filter(([id]) => probe.cards.includes(id))));
  const cells = spendCells(pool.spend);
  const baseline = evaluateSet(usableOwned, pool, cells, "ongoing", solver).evaluation;
  const baseline_annual = baseline?.score.total_annual ?? 0;
  const actual_annual = usableOwned.length && cells.length
    ? scoreAssignment(usableOwned, actualAssignment(pool), pool.credits, "ongoing", monthList(cells, baseline?.score.months ?? 1)).total_annual
    : 0;
  const routing_gain_annual = baseline_annual - actual_annual;
  const ownedIds = new Set(owned.map((e) => e.card.id));
  const excluded = new Map<string, Excluded>();
  const changes: CardChange[] = [];

  const all = catalogue.filter((c) => !ownedIds.has(c.card.id));
  const { keep, pruned } = options.prune ? pruneCatalogue(all, usableOwned, cells) : { keep: all, pruned: [] as string[] };
  const sets: { action: CardChange["action"]; remove: string | null; add: CardSetEntry; entries: CardSetEntry[] }[] = [];
  for (const add of keep) {
    const fresh = { ...add, is_new: true };
    for (const o of usableOwned) {
      sets.push({ action: "replace", remove: o.card.id, add: fresh, entries: usableOwned.map((e) => (e === o ? fresh : e)) });
    }
    if (usableOwned.length < 3) sets.push({ action: "add", remove: null, add: fresh, entries: [...usableOwned, fresh] });
  }

  sets.forEach((s, i) => {
    const ongoing = evaluateSet(s.entries, pool, cells, "ongoing", solver);
    const firstYear = evaluateSet(s.entries, pool, cells, "first_year", solver);
    options.onProgress?.(i + 1, sets.length);
    for (const x of [...ongoing.excluded, ...firstYear.excluded]) {
      if (x.card_id === s.add.card.id) {
        const prev = excluded.get(x.card_id);
        excluded.set(x.card_id, { ...x, reasons: [...new Set([...(prev?.reasons ?? []), ...x.reasons])] });
      }
    }
    if (!ongoing.evaluation || !firstYear.evaluation) return;
    const fy = firstYear.evaluation;
    const og = ongoing.evaluation.score.total_annual - baseline_annual;
    const fg = fy.score.total_annual - baseline_annual;
    changes.push({
      action: s.action,
      remove: s.remove,
      add: s.add.card.id,
      cards: s.entries.map((e) => e.card.id),
      ongoing: {
        total_annual: ongoing.evaluation.score.total_annual,
        gain_annual: og,
        total_gain_annual: routing_gain_annual + og,
        policy: ongoing.evaluation.policy,
        credit_rules: ongoing.evaluation.credit_rules,
      },
      first_year: {
        total_annual: fy.score.total_annual,
        gain_annual: fg,
        total_gain_annual: routing_gain_annual + fg,
        bonus_value: fy.score.bonus_value,
        bonus_pursued: fy.pursued.length > 0,
        bonus_projected: fy.projected_bonus,
      },
    });
  });
  changes.sort((a, b) => b.ongoing.gain_annual - a.ongoing.gain_annual || a.add.localeCompare(b.add) || (a.remove ?? "").localeCompare(b.remove ?? ""));
  return {
    projection: projection(baseline?.score.months ?? 0),
    baseline_annual,
    actual_annual,
    routing_gain_annual,
    evaluated: keep.length,
    pruned,
    changes,
    excluded: [...excluded.values()],
  };
}

/**
 * Candidate pruning for "change a card". A catalogue card is kept if ANY of:
 * - in some category the user spends in, its headline value per $ (through
 *   valuePerDollar, domestic) beats the best of the current cards;
 * - it has a welcome bonus or a purchase credit (value not captured by rates);
 * - its annual fee is below the highest current card's fee (it might replace
 *   an expensive card at similar rates).
 * Cards whose value can't be resolved (unverified terms) are kept, so they are
 * reported as excluded with reasons rather than silently dropped.
 */
export function pruneCatalogue(
  candidates: readonly CardSetEntry[],
  owned: readonly CardSetEntry[],
  cells: readonly SpendCell[],
): { keep: CardSetEntry[]; pruned: string[] } {
  const spent = [...new Set(cells.filter((c) => c.net > 0).map((c) => c.category))];
  const rate = (e: CardSetEntry, c: Category): number | null => {
    const r = resolveCard(e, cells, "ongoing");
    if (!r.ok) return null;
    const opts = earnOptions(r, c, false);
    return opts.length ? Math.max(...opts.map((o) => o.value)) : null;
  };
  const best = new Map(spent.map((c) => [c, Math.max(-Infinity, ...owned.map((o) => rate(o, c) ?? -Infinity))]));
  const maxFee = Math.max(0, ...owned.map((o) => o.card.annual_fee ?? 0));
  const keep: CardSetEntry[] = [];
  const pruned: string[] = [];
  for (const e of candidates) {
    const resolved = resolveCard(e, cells, "ongoing");
    const extras = (e.card.welcome_bonus?.length ?? 0) > 0 || (e.card.purchase_credits?.length ?? 0) > 0;
    const cheaper = e.card.annual_fee !== null && e.card.annual_fee < maxFee;
    const beats = spent.some((c) => {
      const v = rate(e, c);
      return v !== null && v > (best.get(c) ?? -Infinity) + 1e-12;
    });
    if (!resolved.ok || extras || cheaper || beats) keep.push(e);
    else pruned.push(e.card.id);
  }
  return { keep, pruned };
}

export interface Stability {
  /** Perturbed scenarios only. The base case is never counted (legacy bug 4). */
  scenarios: number;
  held: number;
  /** held / scenarios, or null when there are no scenarios. */
  share: number | null;
}

/**
 * How often a ranking survives the scenarios. `scenarioRankings` must contain
 * perturbed scenarios only; the base ranking is the reference, not a scenario.
 */
export function rankingStability(baseRanking: readonly string[], scenarioRankings: readonly (readonly string[])[]): Stability {
  const held = scenarioRankings.filter(
    (r) => r.length === baseRanking.length && r.every((id, i) => id === baseRanking[i]),
  ).length;
  const scenarios = scenarioRankings.length;
  return { scenarios, held, share: scenarios === 0 ? null : held / scenarios };
}

export interface SensitivityScenario {
  program_id: string;
  /** The redemption method used for this program in the scenario. */
  method: string;
  bound: "low" | "high";
  ranking: string[];
  held: boolean;
}

export interface SensitivityResult extends Stability {
  base_ranking: string[];
  details: SensitivityScenario[];
}

/**
 * Re-rank the top changes with each points program valued at the low and high
 * end of its verified redemption values (cents per point across its methods).
 * A program with one value has no range and adds no scenario.
 */
export function sensitivity(
  top: readonly CardChange[],
  owned: readonly CardSetEntry[],
  itemsByCard: ReadonlyMap<string, readonly CategorizedTransaction[]>,
  catalogue: readonly CardSetEntry[],
  solver: LpSolver,
  onProgress?: (done: number, total: number) => void,
): SensitivityResult {
  const idOf = (c: CardChange) => `${c.remove ?? "+"}>${c.add}`;
  const base_ranking = top.map(idOf);
  const byId = new Map([...owned, ...catalogue].map((e) => [e.card.id, e]));
  const probe = solveRouting(owned, spendCells([...itemsByCard.values()].flat()), "ongoing", solver);
  const pool = poolStatements(new Map([...itemsByCard].filter(([id]) => probe.cards.includes(id))));
  const cells = spendCells(pool.spend);

  // Programs used by these sets, with their verified value range.
  const programs = new Map<string, NonNullable<CardSetEntry["program"]>>();
  for (const c of top) for (const id of c.cards) {
    const p = byId.get(id)?.program;
    if (p) programs.set(p.id, p);
  }
  const details: SensitivityScenario[] = [];
  const ranged = [...programs.values()].filter((p) => p.redemptions.filter((r) => valuePerDollar(1, p, r.method) !== null).length > 1);
  let done = 0;
  for (const p of programs.values()) {
    const valued = p.redemptions
      .map((r) => ({ method: r.method, v: valuePerDollar(1, p, r.method) }))
      .filter((x): x is { method: string; v: number } => x.v !== null);
    if (valued.length < 2) continue;
    const low = valued.reduce((a, b) => (b.v < a.v ? b : a));
    const high = valued.reduce((a, b) => (b.v > a.v ? b : a));
    if (low.v === high.v) continue;
    for (const [bound, pick] of [["low", low], ["high", high]] as const) {
      const scored = top.map((c) => {
        const entries = c.cards.map((id) => {
          const e = byId.get(id)!;
          const fresh = { ...e, is_new: id === c.add };
          return e.program?.id === p.id ? { ...fresh, redemption_method: pick.method } : fresh;
        });
        const ev = evaluateSet(entries, pool, cells, "ongoing", solver).evaluation;
        return { id: idOf(c), value: ev?.score.total_annual ?? -Infinity };
      });
      const ranking = [...scored].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id)).map((x) => x.id);
      details.push({ program_id: p.id, method: pick.method, bound, ranking, held: ranking.join() === base_ranking.join() });
      onProgress?.(++done, ranged.length * 2);
    }
  }
  return { ...rankingStability(base_ranking, details.map((d) => d.ranking)), base_ranking, details };
}
