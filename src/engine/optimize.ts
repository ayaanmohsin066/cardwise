/**
 * "Earn more": route each category's monthly spend across a set of cards with
 * a linear program. The LP decides routing only; its objective is an upper
 * bound and is never shown (docs/decisions.md, "Shared caps"). The shown value
 * comes from replaying real transactions (policy.ts).
 *
 * Dollars only via valuePerDollar(). Any unverified term a card needs for this
 * spend excludes that card, with the reason; nothing is assumed.
 */
import { CATEGORIES, type Category } from "./categories";
import type { Card } from "./card-schema";
import { chooseRedemption } from "./benefits";
import type { CategorizedTransaction } from "./categorize";
import { periodKey } from "./dates";
import type { LpConstraint, LpSolver } from "./lp";
import { categoryEarning, type CategoryEarning } from "./points";
import type { Program, Redemption } from "./program-schema";
import { valuePerDollar } from "./value";

export type RoutingMode = "ongoing" | "first_year";

export interface CardSetEntry {
  card: Card;
  program: Program | null;
  /** Redemption method; default is the program's first non-estimate method. */
  redemption_method?: string | null;
  /** A card the user would newly open (first-year fee and welcome bonus apply in "first_year"). */
  is_new?: boolean;
}

/** Net spend for one category, calendar month and domestic/foreign split. */
export interface SpendCell {
  category: Category;
  /** "YYYY-MM" */
  month: string;
  foreign: boolean;
  /** Raw signed net (purchases minus refunds). */
  net: number;
}

/** Category × month × foreign totals from categorized statement lines (purchases and refunds). */
export function spendCells(items: readonly CategorizedTransaction[]): SpendCell[] {
  const map = new Map<string, SpendCell>();
  for (const { transaction: t, category } of items) {
    if (category === null || (t.kind !== "purchase" && t.kind !== "refund")) continue;
    const month = t.date.slice(0, 7);
    const key = `${category}|${month}|${t.is_foreign}`;
    const cell = map.get(key) ?? { category, month, foreign: t.is_foreign, net: 0 };
    cell.net += t.amount_cad;
    map.set(key, cell);
  }
  return [...map.values()].sort(
    (a, b) => a.month.localeCompare(b.month) || a.category.localeCompare(b.category) || Number(a.foreign) - Number(b.foreign),
  );
}

/** Every calendar month from the first to the last cell, inclusive. */
export function monthsSpanned(cells: readonly SpendCell[]): string[] {
  if (cells.length === 0) return [];
  const sorted = cells.map((c) => c.month).sort();
  const [y0, m0] = sorted[0].split("-").map(Number);
  const [y1, m1] = sorted[sorted.length - 1].split("-").map(Number);
  const out: string[] = [];
  for (let n = y0 * 12 + m0 - 1; n <= y1 * 12 + m1 - 1; n++) {
    out.push(`${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

/** One way a dollar can earn on a card: the bonus tier (capped), after the cap, or uncapped. */
export interface EarnOption {
  card_id: string;
  tier: "bonus" | "after" | "all";
  cap: { id: string; amount: number; period: "month" | "quarter" | "year" } | null;
  /** $ earned per $ spent, minus any FX cost for foreign spend. */
  value: number;
}

/** A card with its resolved redemption and value function, or the reasons it can't be used. */
export type ResolvedCard =
  | { ok: true; entry: CardSetEntry; redemption: Redemption; valueOf: (points: number) => number; fee: number; fx: number }
  | { ok: false; card_id: string; name: string; reasons: string[] };

const pct = (x: number) => x / 100;
const label = (c: Category) => c.replace(/_/g, " ");

/**
 * Check a card has every verified term needed for this spend and mode, and
 * resolve its value function. Unverified terms exclude the card, with reasons.
 */
export function resolveCard(entry: CardSetEntry, cells: readonly SpendCell[], mode: RoutingMode): ResolvedCard {
  const { card, program } = entry;
  const reasons: string[] = [];
  const redemption = chooseRedemption(program, entry.redemption_method);
  const perPoint = program && redemption ? valuePerDollar(1, program, redemption.method) : null;
  if (!program) reasons.push("its points program is not yet verified");
  else if (perPoint === null) reasons.push("its point value is not yet verified");

  const firstYearNew = mode === "first_year" && entry.is_new === true;
  const fee = firstYearNew ? card.first_year_fee : card.annual_fee;
  if (fee === null) reasons.push(firstYearNew ? "its first-year fee is not yet verified" : "its annual fee is not yet verified");

  const withSpend = new Set(cells.filter((c) => c.net > 0).map((c) => c.category));
  if (card.earn_rules === null) {
    reasons.push("its earn rates are not yet verified");
  } else {
    for (const c of CATEGORIES) {
      if (!withSpend.has(c)) continue;
      const e = categoryEarning(card, c);
      if (!e.ok) {
        reasons.push(
          e.reason === "cap" ? `its ${label(c)} spending cap is not yet verified`
            : e.reason === "base_rate" ? "its base earn rate is not yet verified"
              : `its ${label(c)} earn rate is not yet verified`,
        );
      } else if (e.cap && e.after_cap_rate === null) {
        reasons.push(`its rate after the ${label(c)} cap is not yet verified`);
      }
    }
  }
  if (cells.some((c) => c.foreign && c.net > 0) && card.fx_fee_pct === null) {
    reasons.push("its foreign transaction fee is not yet verified");
  }
  if (firstYearNew) {
    if (card.welcome_bonus === null) reasons.push("its welcome bonus is not yet verified");
    else if (card.welcome_bonus.some((b) => b.points_or_cash === null || b.min_spend === null || b.window_months === null)) {
      reasons.push("its welcome bonus terms are not yet verified");
    }
  }
  if (reasons.length) return { ok: false, card_id: card.id, name: card.name, reasons: [...new Set(reasons)] };
  return {
    ok: true,
    entry,
    redemption: redemption!,
    valueOf: (points) => valuePerDollar(points, program!, redemption!.method)!,
    fee: fee!,
    fx: card.fx_fee_pct === null ? 0 : pct(card.fx_fee_pct),
  };
}

/** How a dollar of `category` spend can earn on a resolved card. */
export function earnOptions(r: Extract<ResolvedCard, { ok: true }>, category: Category, foreign: boolean): EarnOption[] {
  const e: CategoryEarning = categoryEarning(r.entry.card, category);
  if (!e.ok) return [];
  // FX: the fee embedded in a converted amount, per $ (docs/decisions.md, Phase 3 rule 5).
  const fxCost = foreign ? r.fx / (1 + r.fx) : 0;
  const id = r.entry.card.id;
  if (e.cap === null) return [{ card_id: id, tier: "all", cap: null, value: r.valueOf(e.rate) - fxCost }];
  return [
    { card_id: id, tier: "bonus", cap: e.cap, value: r.valueOf(e.rate) - fxCost },
    { card_id: id, tier: "after", cap: null, value: r.valueOf(e.after_cap_rate!) - fxCost },
  ];
}

export interface BonusTarget {
  card_id: string;
  /** Spend required in the data window (pro-rated when the data is shorter than the window). */
  required: number;
  /** Months of the data inside the bonus window. */
  window_months_in_data: number;
  /** One-time value of the bonus (all its entries). */
  value: number;
  /** True when the data is shorter than the window, so `required` is a pace. */
  projected: boolean;
}

/** What pursuing each new card's welcome bonus would require, from the start of the data. */
export function bonusTargets(resolved: readonly ResolvedCard[], months: readonly string[]): BonusTarget[] {
  const out: BonusTarget[] = [];
  for (const r of resolved) {
    if (!r.ok || !r.entry.is_new || !r.entry.card.welcome_bonus?.length) continue;
    // All entries must be met; use the tightest pace. Each entry is fully verified (resolveCard).
    let required = 0;
    let inData = months.length;
    let projected = false;
    let value = 0;
    for (const b of r.entry.card.welcome_bonus) {
      const w = b.window_months!;
      const m = Math.min(w, months.length);
      const need = (b.min_spend! * m) / w;
      if (need > required) {
        required = need;
        inData = m;
      }
      projected ||= months.length < w;
      value += r.valueOf(b.points_or_cash!);
    }
    out.push({ card_id: r.entry.card.id, required, window_months_in_data: inData, value, projected });
  }
  return out;
}

export interface PolicyStep {
  card_id: string;
  /** Use this card until this cap is reached (then the next step). null = for the rest. */
  until_cap: { id: string; amount: number; period: "month" | "quarter" | "year"; shared_with: Category[] } | null;
}

export interface CategoryPolicy {
  category: Category;
  steps: PolicyStep[];
  /** Different steps for foreign-currency purchases, or null when the same. */
  foreign_steps: PolicyStep[] | null;
  /** False when the data has no spend here (steps are still the best available). */
  has_spend: boolean;
}

/**
 * A purchase credit the policy captures first: purchases matching its
 * merchant_keywords go to its card until the credit's limit for the period is
 * used, then normal routing (docs/decisions.md, "Earn more" rule 4).
 */
export interface CreditRule {
  card_id: string;
  description: string;
  merchant_keywords: string[];
  limit: number;
  period: "month" | "quarter" | "year";
}

/** Credit rules for the usable cards: verified credits with merchant keywords only. */
export function creditRules(cards: readonly Card[]): CreditRule[] {
  return cards.flatMap((card) =>
    (card.purchase_credits ?? []).flatMap((c) =>
      c.amount !== null && c.period !== null && c.merchant_keywords.length > 0
        ? [{ card_id: card.id, description: c.description, merchant_keywords: c.merchant_keywords, limit: c.amount, period: c.period }]
        : [],
    ),
  );
}

export interface RoutingCase {
  /** New cards whose welcome bonus this case pursues. */
  pursued: string[];
  /** LP objective for the data period (value − prorated fees + bonuses). An upper bound: never display it. */
  upper_bound: number;
  /** Spend routed to each card, by category (LP solution). */
  allocation: { card_id: string; category: Category; foreign: boolean; amount: number }[];
  policy: CategoryPolicy[];
  /** Applied before `policy`: credits captured first. */
  credit_rules: CreditRule[];
}

export interface RoutingResult {
  status: "ok" | "no_usable_cards" | "error";
  message?: string;
  mode: RoutingMode;
  months: string[];
  /** Cards used, in input order. */
  cards: string[];
  excluded: { card_id: string; name: string; reasons: string[] }[];
  bonus_targets: BonusTarget[];
  /** One case for "ongoing"; one per bonus combination (at most 8) for "first_year", infeasible ones dropped. */
  cases: RoutingCase[];
}

const EPS = 1e-7;
const MAX_BONUS_CASES = 8;

function capSharing(card: Card, capId: string): Category[] {
  return (card.earn_rules ?? []).filter((r) => r.cap_id === capId).flatMap((r) => r.categories);
}

/** Turn "options this category actually used" into ordered steps a person can follow. */
function stepsFrom(used: EarnOption[], fallback: EarnOption[], cardOf: (id: string) => Card): PolicyStep[] {
  const ordered = [...used].sort((a, b) => b.value - a.value || a.card_id.localeCompare(b.card_id));
  const steps: PolicyStep[] = [];
  const push = (o: EarnOption) => {
    if (o.tier === "bonus" && o.cap) {
      steps.push({ card_id: o.card_id, until_cap: { ...o.cap, shared_with: capSharing(cardOf(o.card_id), o.cap.id) } });
      return false;
    }
    // "after" or "all": for the rest. Collapse "card X until cap, then card X" into "card X".
    const last = steps[steps.length - 1];
    if (last && last.card_id === o.card_id) last.until_cap = null;
    else steps.push({ card_id: o.card_id, until_cap: null });
    return true;
  };
  for (const o of ordered) if (push(o)) return steps;
  // Every used option was capped: add the best uncapped option as the fallback once caps fill.
  const rest = [...fallback].filter((o) => o.tier !== "bonus").sort((a, b) => b.value - a.value)[0];
  if (rest) push(rest);
  return steps;
}

/**
 * Solve the routing LP for a card set. `solver` is injected (the engine never
 * loads one). For "first_year", every combination of new cards' welcome
 * bonuses (at most 8) is solved; infeasible combinations are dropped.
 */
export function solveRouting(
  cardSet: readonly CardSetEntry[],
  cells: readonly SpendCell[],
  mode: RoutingMode,
  solver: LpSolver,
): RoutingResult {
  const months = monthsSpanned(cells);
  const resolved = cardSet.map((e) => resolveCard(e, cells, mode));
  const usable = resolved.filter((r): r is Extract<ResolvedCard, { ok: true }> => r.ok);
  const excluded = resolved.filter((r): r is Extract<ResolvedCard, { ok: false }> => !r.ok)
    .map(({ card_id, name, reasons }) => ({ card_id, name, reasons }));
  const base = { mode, months, cards: usable.map((r) => r.entry.card.id), excluded };
  if (usable.length === 0) return { ...base, status: "no_usable_cards", bonus_targets: [], cases: [] };

  const cardOf = (id: string) => usable.find((r) => r.entry.card.id === id)!.entry.card;
  const demand = cells.filter((c) => c.net > EPS);

  // Variables: one per (card, cell, tier).
  interface VarMeta { name: string; cell: SpendCell; option: EarnOption }
  const vars: VarMeta[] = [];
  demand.forEach((cell, i) => {
    for (const r of usable) {
      for (const o of earnOptions(r, cell.category, cell.foreign)) {
        vars.push({ name: `${o.card_id}|${i}|${o.tier}`, cell, option: o });
      }
    }
  });
  const objective = new Map(vars.map((v) => [v.name, v.option.value]));
  const constraints: LpConstraint[] = [];
  demand.forEach((cell, i) => {
    const terms = new Map(vars.filter((v) => v.cell === demand[i]).map((v) => [v.name, 1]));
    constraints.push({ terms, lower: cell.net, upper: cell.net });
  });
  const capGroups = new Map<string, { limit: number; names: string[] }>();
  for (const v of vars) {
    if (v.option.tier !== "bonus" || !v.option.cap) continue;
    const key = `${v.option.card_id}|${v.option.cap.id}|${periodKey(`${v.cell.month}-01`, v.option.cap.period)}`;
    const g = capGroups.get(key) ?? { limit: v.option.cap.amount, names: [] };
    g.names.push(v.name);
    capGroups.set(key, g);
  }
  for (const g of capGroups.values()) constraints.push({ terms: new Map(g.names.map((n) => [n, 1])), upper: g.limit });

  const fees = usable.reduce((s, r) => s + (r.fee * months.length) / 12, 0);
  const targets = mode === "first_year" ? bonusTargets(usable, months) : [];
  const combos: string[][] = [[]];
  for (const t of targets.slice(0, 3)) {
    for (const c of [...combos]) combos.push([...c, t.card_id]);
  }

  const cases: RoutingCase[] = [];
  for (const pursued of combos.slice(0, MAX_BONUS_CASES)) {
    const extra: LpConstraint[] = pursued.map((id) => {
      const t = targets.find((x) => x.card_id === id)!;
      const window = new Set(months.slice(0, t.window_months_in_data));
      return {
        terms: new Map(vars.filter((v) => v.option.card_id === id && window.has(v.cell.month)).map((v) => [v.name, 1])),
        lower: t.required,
      };
    });
    const sol = solver({ objective, constraints: [...constraints, ...extra], variables: vars.map((v) => v.name) });
    if (sol.status !== "optimal") {
      if (sol.status === "infeasible") continue;
      return { ...base, status: "error", message: sol.message, bonus_targets: targets, cases: [] };
    }

    const bonusValue = pursued.reduce((s, id) => s + targets.find((t) => t.card_id === id)!.value, 0);
    const alloc = new Map<string, { card_id: string; category: Category; foreign: boolean; amount: number }>();
    const usedOptions = new Map<string, EarnOption[]>();
    for (const v of vars) {
      const x = sol.values.get(v.name) ?? 0;
      if (x <= EPS) continue;
      const k = `${v.option.card_id}|${v.cell.category}|${v.cell.foreign}`;
      const a = alloc.get(k) ?? { card_id: v.option.card_id, category: v.cell.category, foreign: v.cell.foreign, amount: 0 };
      a.amount += x;
      alloc.set(k, a);
      const g = `${v.cell.category}|${v.cell.foreign}`;
      const list = usedOptions.get(g) ?? [];
      if (!list.some((o) => o.card_id === v.option.card_id && o.tier === v.option.tier)) list.push(v.option);
      usedOptions.set(g, list);
    }

    const policy: CategoryPolicy[] = CATEGORIES.map((category) => {
      const all = (foreign: boolean) => usable.flatMap((r) => earnOptions(r, category, foreign));
      const hasSpend = demand.some((c) => c.category === category);
      const domestic = stepsFrom(usedOptions.get(`${category}|false`) ?? all(false), all(false), cardOf);
      // Foreign steps only where the data has foreign spend in this category.
      const foreignUsed = usedOptions.get(`${category}|true`);
      const foreignSteps = foreignUsed ? stepsFrom(foreignUsed, all(true), cardOf) : null;
      const same = foreignSteps === null || JSON.stringify(foreignSteps) === JSON.stringify(domestic);
      return { category, steps: domestic, foreign_steps: same ? null : foreignSteps, has_spend: hasSpend };
    });

    cases.push({
      pursued,
      upper_bound: sol.objective - fees + bonusValue,
      allocation: [...alloc.values()],
      policy,
      credit_rules: creditRules(usable.map((r) => r.entry.card)),
    });
  }
  return { ...base, status: "ok", bonus_targets: targets, cases };
}
