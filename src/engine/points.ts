/**
 * Points earned per transaction, with caps applied in posting order.
 * See docs/decisions.md ("Shared caps" and "Refunds").
 *
 * - Posting order: by date, then statement_line.
 * - Each cap has separate state per calendar period (month, quarter or year of
 *   the transaction date). The card schema has no field for anniversary-based
 *   periods, so calendar periods are always used.
 * - Purchases fill the cap's remaining room at the rule's rate; spend above
 *   the cap earns that rule's own after_cap_rate.
 * - Refunds use raw signed amounts and are never floored, and reduce points in
 *   the period they post. A refund is first matched to an earlier purchase on
 *   the card: same merchant (overrideKey), purchase amount still refundable
 *   >= refund, most recent first. A matched refund reverses that purchase's
 *   after-cap part, then its bonus part, at the rates it earned, and releases
 *   the cap room in the purchase's period. An unmatched refund (low
 *   confidence) reverses the rule's after-cap spend in its own period, then
 *   bonus spend (freeing cap room); anything beyond that goes negative at the
 *   bonus rate.
 * - Unverified (null) terms are never treated as 0. The affected amount is
 *   reported as unverified and earns no counted points.
 */
import type { Category } from "./categories";
import type { Card, EarnRule } from "./card-schema";
import { NO_CAP } from "./card-schema";
import type { CategorizedTransaction } from "./categorize";
import { periodKey, type Period } from "./dates";
import { overrideKey } from "./overrides";
import type { Confidence, Transaction } from "./transaction-schema";

export type UnverifiedReason =
  | "earn_rules"
  | "earn_rate"
  | "base_rate"
  | "cap"
  | "after_cap_rate";

/** How spend in one category earns on a card, or why it can't be known. */
export type CategoryEarning =
  | { ok: false; reason: UnverifiedReason }
  | {
      ok: true;
      rate: number;
      /** Index into card.earn_rules, or null when the base rate applies. */
      rule_index: number | null;
      /** null when verified uncapped. */
      cap: { id: string; amount: number; period: Period } | null;
      /** Rate above the cap; null means unverified (only matters once the cap is reached). */
      after_cap_rate: number | null;
    };

/** Resolve how a category earns on a card. */
export function categoryEarning(card: Card, category: Category): CategoryEarning {
  if (card.earn_rules === null) return { ok: false, reason: "earn_rules" };
  const rule_index = card.earn_rules.findIndex((r) => r.categories.includes(category));
  if (rule_index === -1) {
    return card.base_rate === null
      ? { ok: false, reason: "base_rate" }
      : { ok: true, rate: card.base_rate, rule_index: null, cap: null, after_cap_rate: null };
  }
  const rule: EarnRule = card.earn_rules[rule_index];
  if (rule.rate === null) return { ok: false, reason: "earn_rate" };
  if (rule.cap_id === null) return { ok: false, reason: "cap" };
  if (rule.cap_id === NO_CAP) {
    return { ok: true, rate: rule.rate, rule_index, cap: null, after_cap_rate: null };
  }
  const cap = card.caps?.find((c) => c.id === rule.cap_id);
  if (!cap || cap.amount === null || cap.period === null) return { ok: false, reason: "cap" };
  return {
    ok: true,
    rate: rule.rate,
    rule_index,
    cap: { id: cap.id, amount: cap.amount, period: cap.period },
    after_cap_rate: rule.after_cap_rate,
  };
}

/** The headline rate for a category (bonus rate or base rate), or null if unverified. */
export function effectiveRate(card: Card, category: Category): number | null {
  const e = categoryEarning(card, category);
  return e.ok ? e.rate : null;
}

export interface TransactionPoints {
  transaction: Transaction;
  category: Category;
  /** Counted (verified) points. Negative for refunds. */
  points: number;
  /** Signed spend earned at the bonus (or base) rate. */
  bonus_amount: number;
  /** Signed spend earned at the after-cap rate. */
  after_cap_amount: number;
  /** Signed spend whose points are unknown because a term is unverified. */
  unverified_amount: number;
  unverified_reason: UnverifiedReason | null;
  cap_id: string | null;
  cap_period_key: string | null;
  /** Refunds only: the purchase it was matched to, or null if unmatched. */
  matched_purchase_id: string | null;
  /** Refunds only: "high" when matched to a purchase, "low" when not. null for purchases. */
  refund_confidence: Confidence | null;
}

export interface CapUsage {
  cap_id: string;
  period: Period;
  period_key: string;
  limit: number;
  /** Spend counted against the cap (bonus spend, net of refunds, not below 0). */
  used: number;
  /** Date the cap was first reached in this period, or null. */
  reached_on: string | null;
  categories: Category[];
}

export interface PointsResult {
  /** Spend transactions (purchases and refunds) in posting order. */
  transactions: TransactionPoints[];
  caps: CapUsage[];
}

/** Posting order: date, then statement line. */
export function postingOrder<T extends { transaction: Transaction }>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      a.transaction.date.localeCompare(b.transaction.date) ||
      a.transaction.statement_line - b.transaction.statement_line,
  );
}

interface CapState {
  usage: CapUsage;
  /** Per rule index: bonus spend and after-cap spend in this period (signed). */
  bonus: Map<number, number>;
  after: Map<number, number>;
}

/** What a purchase earned, so a later refund can reverse exactly that. */
interface PurchaseLot {
  id: string;
  merchant: string;
  /** Amount still refundable (bonus_left + after_left). */
  left: number;
  bonus_left: number;
  after_left: number;
  category: Category;
  earning: CategoryEarning;
  state_key: string | null;
}

export const ROUNDING_MODES = ["per_transaction", "per_statement"] as const;
/** How an issuer rounds points: each line to a whole point, or only the total. */
export type RoundingMode = (typeof ROUNDING_MODES)[number];

export function isRoundingMode(x: unknown): x is RoundingMode {
  return typeof x === "string" && (ROUNDING_MODES as readonly string[]).includes(x);
}

/** Round to a whole point, halves away from zero (2.5 -> 3, -2.5 -> -3). */
export function roundPoints(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x) + EPS);
}

const EPS = 1e-9;
/** Negate without producing -0. */
const neg = (x: number) => (x === 0 ? 0 : -x);

/**
 * The one implementation of the points rules. Walks `sorted` (already in
 * posting order), reading each line's category through `categoryOf`, and
 * calls `emit` for each spend line when given. Returns the total and caps.
 * With `roundEach`, each line's points are rounded before summing.
 */
function run(
  card: Card,
  sorted: readonly CategorizedTransaction[],
  categoryOf: (item: CategorizedTransaction) => Category | null,
  earning: (category: Category) => CategoryEarning,
  emit?: (t: TransactionPoints) => void,
  roundEach = false,
): { total: number; states: Map<string, CapState> } {
  const states = new Map<string, CapState>();
  const lots: PurchaseLot[] = [];
  let total = 0;

  const capCategories = (capId: string): Category[] =>
    (card.earn_rules ?? []).filter((r) => r.cap_id === capId).flatMap((r) => r.categories);

  const stateFor = (capId: string, amount: number, period: Period, key: string): CapState => {
    const stateKey = `${capId}|${key}`;
    let st = states.get(stateKey);
    if (!st) {
      st = {
        usage: { cap_id: capId, period, period_key: key, limit: amount, used: 0, reached_on: null, categories: capCategories(capId) },
        bonus: new Map(),
        after: new Map(),
      };
      states.set(stateKey, st);
    }
    return st;
  };
  const recomputeUsed = (st: CapState) => {
    let used = 0;
    for (const v of st.bonus.values()) used += Math.max(0, v);
    st.usage.used = used;
  };
  const record = (out: TransactionPoints) => {
    total += roundEach ? roundPoints(out.points) : out.points;
    emit?.(out);
  };

  for (const item of sorted) {
    const t = item.transaction;
    const category = categoryOf(item);
    if (category === null || (t.kind !== "purchase" && t.kind !== "refund")) continue;
    const a = t.amount_cad;
    const isRefund = a < 0;
    const merchant = overrideKey(t.description);
    const base = {
      transaction: t, category, points: 0, bonus_amount: 0, after_cap_amount: 0,
      unverified_amount: 0, unverified_reason: null as UnverifiedReason | null,
      cap_id: null as string | null, cap_period_key: null as string | null,
      matched_purchase_id: null as string | null,
      refund_confidence: (isRefund ? "low" : null) as Confidence | null,
    };

    // Matched refund: reverse exactly what the purchase earned.
    if (isRefund) {
      const r = -a;
      let lot: PurchaseLot | undefined;
      for (let i = lots.length - 1; i >= 0; i--) {
        if (lots[i].merchant === merchant && lots[i].left >= r - EPS) {
          lot = lots[i];
          break;
        }
      }
      if (lot) {
        const fromAfter = Math.min(r, lot.after_left);
        const fromBonus = r - fromAfter;
        lot.after_left -= fromAfter;
        lot.bonus_left -= fromBonus;
        lot.left -= r;
        const matched = { ...base, category: lot.category, matched_purchase_id: lot.id, refund_confidence: "high" as Confidence };
        const e = lot.earning;
        if (!e.ok) {
          record({ ...matched, unverified_amount: a, unverified_reason: e.reason });
          continue;
        }
        if (lot.state_key !== null && e.cap !== null) {
          const st = states.get(lot.state_key)!;
          const ri = e.rule_index!;
          st.bonus.set(ri, (st.bonus.get(ri) ?? 0) - fromBonus);
          st.after.set(ri, (st.after.get(ri) ?? 0) - fromAfter);
          recomputeUsed(st);
        }
        const afterVerified = e.after_cap_rate !== null || fromAfter <= EPS;
        record({
          ...matched,
          points: neg(fromBonus * e.rate + (e.after_cap_rate !== null ? fromAfter * e.after_cap_rate : 0)),
          bonus_amount: neg(fromBonus),
          after_cap_amount: neg(fromAfter),
          unverified_amount: afterVerified ? 0 : neg(fromAfter),
          unverified_reason: afterVerified ? null : "after_cap_rate",
          cap_id: e.cap?.id ?? null,
          cap_period_key: lot.state_key === null ? null : states.get(lot.state_key)!.usage.period_key,
        });
        continue;
      }
    }

    const e = earning(category);
    const addLot = (bonus: number, after: number, state_key: string | null) => {
      if (!isRefund && t.kind === "purchase") {
        lots.push({ id: t.id, merchant, left: a, bonus_left: bonus, after_left: after, category, earning: e, state_key });
      }
    };

    if (!e.ok) {
      addLot(a, 0, null);
      record({ ...base, unverified_amount: a, unverified_reason: e.reason });
      continue;
    }
    if (e.cap === null) {
      addLot(a, 0, null);
      record({ ...base, points: a * e.rate, bonus_amount: a });
      continue;
    }

    const key = periodKey(t.date, e.cap.period);
    const st = stateFor(e.cap.id, e.cap.amount, e.cap.period, key);
    const ri = e.rule_index!;
    const bonusR = st.bonus.get(ri) ?? 0;
    const afterR = st.after.get(ri) ?? 0;
    let bonus: number;
    let after: number;

    if (!isRefund) {
      const room = Math.max(0, e.cap.amount - st.usage.used);
      bonus = Math.min(a, room);
      after = a - bonus;
    } else {
      // Unmatched: reverse after-cap spend first, then bonus spend; the rest goes negative at the bonus rate.
      const fromAfter = Math.min(-a, Math.max(0, afterR));
      after = neg(fromAfter);
      bonus = a + fromAfter;
    }
    st.bonus.set(ri, bonusR + bonus);
    st.after.set(ri, afterR + after);
    recomputeUsed(st);
    if (st.usage.reached_on === null && st.usage.used >= e.cap.amount - EPS && (bonus > 0 || after > 0)) {
      st.usage.reached_on = t.date;
    }
    addLot(bonus, after, `${e.cap.id}|${key}`);

    const afterVerified = e.after_cap_rate !== null;
    record({
      ...base,
      points: bonus * e.rate + (afterVerified ? after * e.after_cap_rate! : 0),
      bonus_amount: bonus,
      after_cap_amount: after,
      unverified_amount: afterVerified ? 0 : after,
      unverified_reason: !afterVerified && Math.abs(after) > EPS ? "after_cap_rate" : null,
      cap_id: e.cap.id,
      cap_period_key: key,
    });
  }
  return { total, states };
}

/** categoryEarning for every category, computed once per card. */
function earningTable(card: Card): (category: Category) => CategoryEarning {
  const cache = new Map<Category, CategoryEarning>();
  return (c) => {
    let e = cache.get(c);
    if (!e) {
      e = categoryEarning(card, c);
      cache.set(c, e);
    }
    return e;
  };
}

/** Points for one card's categorized transactions. Payments, fees and interest earn nothing. */
export function earnPoints(card: Card, items: readonly CategorizedTransaction[]): PointsResult {
  const out: TransactionPoints[] = [];
  const { states } = run(card, postingOrder(items), (i) => i.category, earningTable(card), (t) => out.push(t));
  const caps = [...states.values()]
    .map((s) => s.usage)
    .sort((x, y) => x.cap_id.localeCompare(y.cap_id) || x.period_key.localeCompare(y.period_key));
  return { transactions: out, caps };
}

/**
 * A fast "total points if these lines had these categories" function for
 * search (reconcile). Sorts once and caches earnings; same rules as earnPoints.
 * `rounding` rounds each line ("per_transaction") or the total ("per_statement").
 */
export function pointsEvaluator(
  card: Card,
  items: readonly CategorizedTransaction[],
  rounding: RoundingMode | null = null,
): (changes?: ReadonlyMap<string, Category>) => number {
  const sorted = postingOrder(items);
  const earning = earningTable(card);
  return (changes) => {
    const { total } = run(
      card, sorted, (i) => changes?.get(i.transaction.id) ?? i.category, earning, undefined,
      rounding === "per_transaction",
    );
    return rounding === "per_statement" ? roundPoints(total) : total;
  };
}

/** Total counted points, optionally with the issuer's rounding. */
export function totalPoints(
  card: Card,
  items: readonly CategorizedTransaction[],
  rounding: RoundingMode | null = null,
): number {
  return pointsEvaluator(card, items, rounding)();
}
