/**
 * Replay a routing policy on the user's real transactions and score it with
 * the Phase 3 engine (computeBenefits). This replayed value is what the UI
 * shows; the LP objective is only an upper bound (docs/decisions.md).
 */
import type { Category } from "./categories";
import { computeBenefits, type BenefitsReport } from "./benefits";
import type { CategorizedTransaction } from "./categorize";
import { periodKey } from "./dates";
import type { BonusTarget, CardSetEntry, CategoryPolicy, CreditRule, RoutingMode } from "./optimize";
import { overrideKey } from "./overrides";
import { postingOrder } from "./points";
import { containsPhrase } from "./text";

export interface Pool {
  /** Purchases and refunds from all cards, ids prefixed "<card>/" so they stay unique. */
  spend: CategorizedTransaction[];
  /** Issuer statement-credit lines, by the card they posted on (they stay with that card). */
  credits: Map<string, CategorizedTransaction[]>;
  /** Where each pooled line actually went. */
  actual_card: Map<string, string>;
}

/** Pool categorized statements from several cards. Fees, interest and payments are left out of replays. */
export function poolStatements(itemsByCard: ReadonlyMap<string, readonly CategorizedTransaction[]>): Pool {
  const spend: CategorizedTransaction[] = [];
  const credits = new Map<string, CategorizedTransaction[]>();
  const actual_card = new Map<string, string>();
  for (const [cardId, items] of itemsByCard) {
    for (const it of items) {
      const t = it.transaction;
      const pooled = { ...it, transaction: { ...t, id: `${cardId}/${t.id}` } };
      if (t.kind === "credit") {
        credits.set(cardId, [...(credits.get(cardId) ?? []), pooled]);
      } else if ((t.kind === "purchase" || t.kind === "refund") && it.category !== null) {
        spend.push(pooled);
        actual_card.set(pooled.transaction.id, cardId);
      }
    }
  }
  return { spend, credits, actual_card };
}

/** Each pooled spend line on the card it actually went on. */
export function actualAssignment(pool: Pool): Map<string, CategorizedTransaction[]> {
  const out = new Map<string, CategorizedTransaction[]>();
  for (const it of pool.spend) {
    const card = pool.actual_card.get(it.transaction.id)!;
    out.set(card, [...(out.get(card) ?? []), it]);
  }
  return out;
}

const EPS = 1e-9;

/**
 * Route real transactions by a policy, in posting order:
 * - A purchase at a merchant matching a credit rule goes to that card until
 *   the credit's limit for its period is used (credits captured first).
 * - During a pursued welcome bonus window, purchases go to that card until its
 *   required spend is reached.
 * - Otherwise the first policy step whose cap still has room this period
 *   ("Card A until its cap is reached, then Card B").
 * - A refund goes to the card its purchase went to (same merchant, most recent
 *   with enough left); otherwise to the category's first step.
 */
export function routeTransactions(
  policy: readonly CategoryPolicy[],
  spend: readonly CategorizedTransaction[],
  bonus: readonly (BonusTarget & { window_months: readonly string[] })[] = [],
  credits: readonly CreditRule[] = [],
): Map<string, CategorizedTransaction[]> {
  const creditUsed = new Map<string, number>();
  const byCategory = new Map(policy.map((p) => [p.category, p]));
  const room = new Map<string, number>();
  const bonusSpent = new Map<string, number>();
  const lots: { card: string; merchant: string; left: number }[] = [];
  const out = new Map<string, CategorizedTransaction[]>();
  const assign = (card: string, it: CategorizedTransaction) => out.set(card, [...(out.get(card) ?? []), it]);

  for (const it of postingOrder(spend)) {
    const t = it.transaction;
    const p = byCategory.get(it.category as Category);
    if (!p || p.steps.length === 0) continue;
    const steps = t.is_foreign && p.foreign_steps ? p.foreign_steps : p.steps;
    const merchant = overrideKey(t.description);

    if (t.amount_cad < 0) {
      let lot: (typeof lots)[number] | undefined;
      for (let i = lots.length - 1; i >= 0; i--) {
        if (lots[i].merchant === merchant && lots[i].left >= -t.amount_cad - EPS) {
          lot = lots[i];
          break;
        }
      }
      if (lot) lot.left += t.amount_cad;
      assign(lot ? lot.card : steps[0].card_id, it);
      continue;
    }

    const credit = credits.find((c) => {
      if (!c.merchant_keywords.some((k) => containsPhrase(t.description, k))) return false;
      return (creditUsed.get(`${c.card_id}|${c.description}|${periodKey(t.date, c.period)}`) ?? 0) < c.limit - EPS;
    });
    if (credit) {
      const key = `${credit.card_id}|${credit.description}|${periodKey(t.date, credit.period)}`;
      creditUsed.set(key, (creditUsed.get(key) ?? 0) + t.amount_cad);
      lots.push({ card: credit.card_id, merchant, left: t.amount_cad });
      assign(credit.card_id, it);
      continue;
    }

    const month = t.date.slice(0, 7);
    const target = bonus.find(
      (b) => b.window_months.includes(month) && (bonusSpent.get(b.card_id) ?? 0) < b.required - EPS,
    );
    let card: string;
    if (target) {
      card = target.card_id;
      bonusSpent.set(card, (bonusSpent.get(card) ?? 0) + t.amount_cad);
    } else {
      const step =
        steps.find((s) => {
          if (!s.until_cap) return true;
          const key = `${s.card_id}|${s.until_cap.id}|${periodKey(t.date, s.until_cap.period)}`;
          return (room.get(key) ?? s.until_cap.amount) > EPS;
        }) ?? steps[steps.length - 1];
      card = step.card_id;
      if (step.until_cap) {
        const key = `${step.card_id}|${step.until_cap.id}|${periodKey(t.date, step.until_cap.period)}`;
        room.set(key, (room.get(key) ?? step.until_cap.amount) - t.amount_cad);
      }
    }
    lots.push({ card, merchant, left: t.amount_cad });
    assign(card, it);
  }
  return out;
}

const PERIODS_PER_YEAR = { month: 12, quarter: 4, year: 1 } as const;

/**
 * Purchase credits per year: the credit used in the data × 12/months, but
 * never more than the credit's yearly limit (its per-period amount × periods
 * per year). Scaling $80 of a $100/year credit from one month must give $100,
 * not $960.
 */
export function annualCredits(report: BenefitsReport, factor: number): number {
  const byCredit = new Map<string, { used: number; cap: number }>();
  for (const c of report.credits) {
    if (!c.verified || c.used === null || c.limit === null || c.period === null) continue;
    const x = byCredit.get(c.description) ?? { used: 0, cap: c.limit * PERIODS_PER_YEAR[c.period] };
    x.used += c.used;
    byCredit.set(c.description, x);
  }
  let total = 0;
  for (const { used, cap } of byCredit.values()) total += Math.min(cap, used * factor);
  return total;
}

export interface CardScore {
  card_id: string;
  report: BenefitsReport;
  bonus: { pursued: boolean; met: boolean; projected: boolean; value: number } | null;
}

export interface Score {
  cards: CardScore[];
  months: number;
  /** Net value for the data period (rewards + credits − prorated fees − FX), without bonuses. */
  recurring_period: number;
  /**
   * Rewards − FX annualized (× 12 / months), plus credits annualized up to
   * their yearly limit (annualCredits), minus the full annual fee: a projection.
   */
  recurring_annual: number;
  /** One-time welcome bonus value earned in this replay (never annualized). */
  bonus_value: number;
  /** recurring_annual + bonus_value. */
  total_annual: number;
  /** Replayed value per category across cards, annualized; null when a value is unverified. */
  category_annual: Map<Category, number>;
  /** Spend per category per card (net), for the data period. */
  category_spend: Map<Category, Map<string, number>>;
}

/**
 * Score an assignment of real transactions to cards with computeBenefits.
 * `mode` "first_year" uses first-year fees for new cards (open date = start
 * of the data) and adds bonuses whose required spend was met.
 */
export function scoreAssignment(
  entries: readonly CardSetEntry[],
  assignment: ReadonlyMap<string, readonly CategorizedTransaction[]>,
  credits: ReadonlyMap<string, readonly CategorizedTransaction[]>,
  mode: RoutingMode,
  months: readonly string[],
  bonus: readonly (BonusTarget & { window_months: readonly string[] })[] = [],
): Score {
  const start = `${months[0]}-01`;
  const factor = 12 / months.length;
  const cards: CardScore[] = [];
  const category_annual = new Map<Category, number>();
  const category_spend = new Map<Category, Map<string, number>>();
  let recurring = 0;
  // Annualized without re-inflating a cent-rounded prorated fee: add the full fee back instead.
  let recurringAnnual = 0;
  let bonusValue = 0;

  for (const e of entries) {
    const id = e.card.id;
    const items = [...(assignment.get(id) ?? []), ...(credits.get(id) ?? [])];
    const report = computeBenefits({
      card: e.card,
      program: e.program,
      items,
      redemption_method: e.redemption_method,
      open_date: mode === "first_year" && e.is_new ? start : null,
      months_covered: months.length,
    });
    recurring += report.net_value;
    const prorated = report.fees.annual_fee_prorated ?? 0;
    recurringAnnual +=
      (report.net_value + prorated - report.credits_total) * factor -
      (report.fees.annual_fee_full ?? 0) +
      annualCredits(report, factor);
    for (const c of report.categories) {
      category_annual.set(c.category, (category_annual.get(c.category) ?? 0) + (c.value ?? 0) * factor);
      const m = category_spend.get(c.category) ?? new Map<string, number>();
      m.set(id, (m.get(id) ?? 0) + c.net_spend);
      category_spend.set(c.category, m);
    }
    const target = bonus.find((b) => b.card_id === id);
    let cardBonus: CardScore["bonus"] = null;
    if (target) {
      const inWindow = (assignment.get(id) ?? [])
        .filter((it) => target.window_months.includes(it.transaction.date.slice(0, 7)))
        .reduce((s, it) => s + it.transaction.amount_cad, 0);
      const met = inWindow >= target.required - 1e-6;
      cardBonus = { pursued: true, met, projected: target.projected, value: met ? target.value : 0 };
      bonusValue += cardBonus.value;
    }
    cards.push({ card_id: id, report, bonus: cardBonus });
  }
  const recurring_annual = recurringAnnual;
  return {
    cards,
    months: months.length,
    recurring_period: recurring,
    recurring_annual,
    bonus_value: bonusValue,
    total_annual: recurring_annual + bonusValue,
    category_annual,
    category_spend,
  };
}
