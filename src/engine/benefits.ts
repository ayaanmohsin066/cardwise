/**
 * Benefits report for one card and its statement transactions. Pure: no I/O.
 *
 * Rules (see docs/decisions.md):
 * - Points come from earnPoints() (posting-order caps, raw signed refunds).
 * - Dollars only come from valuePerDollar(): the value of P points is
 *   valuePerDollar(P, program, method), meaning P points per $1 times $1.
 * - A null (unverified) term is never treated as 0. Anything that depends on
 *   one is left out of the totals and listed in `unverified`.
 */
import type { Category } from "./categories";
import type { Card } from "./card-schema";
import type { CategorizedTransaction } from "./categorize";
import { addMonths, daysBetween, monthsCovered, periodKey, type Period } from "./dates";
import { isFxFeeLine } from "./ingest";
import { roundCents } from "./money";
import { earnPoints, type CapUsage, type TransactionPoints, type UnverifiedReason } from "./points";
import type { Program, Redemption } from "./program-schema";
import { matchStatementCredit } from "./credits";
import { containsPhrase } from "./text";
import type { Transaction } from "./transaction-schema";
import { valuePerDollar } from "./value";

export type UnverifiedKind =
  | UnverifiedReason
  | "program"
  | "redemption_value"
  | "purchase_credits"
  | "credit_terms"
  | "credit_statement_text"
  | "fx_fee"
  | "annual_fee"
  | "welcome_bonus";

export interface UnverifiedItem {
  kind: UnverifiedKind;
  label: string;
  /** How many transactions or entries are affected. */
  count: number;
  /** Signed CAD spend affected, when that applies. */
  amount: number | null;
}

export interface CategoryBenefit {
  category: Category;
  /** Raw signed net spend (purchases minus refunds). */
  net_spend: number;
  points: number;
  /** null when the dollar value is unverified. */
  value: number | null;
  unverified_amount: number;
  unverified_count: number;
}

export interface TransactionBenefit extends TransactionPoints {
  value: number | null;
}

export interface CreditUsage {
  description: string;
  period: Period | null;
  period_key: string | null;
  /** null when the credit amount is unverified. */
  limit: number | null;
  /** Net spend at matching merchants in the period (refunds reduce it). */
  eligible_spend: number;
  matched_count: number;
  /**
   * Credit used. "posted": the issuer's statement-credit lines in the period
   * (the actual credit). "estimated": eligible spend up to the limit, when no
   * credit line has posted. null if unverified.
   */
  used: number | null;
  method: "posted" | "estimated" | null;
  /** Statement-credit lines found for this credit in the period, as a positive total. */
  posted: number;
  /** Credit left in this period, based on the uploaded statements only. */
  remaining: number | null;
  verified: boolean;
}

export interface FxEstimate {
  /**
   * "posted": the statement has separate FX fee lines, so those are used and
   * nothing is estimated (no double counting). "embedded_estimate": the fee
   * is assumed to be built into the converted CAD amount.
   */
  method: "posted" | "embedded_estimate" | "none" | "unverified";
  /** CAD cost of FX fees, or null when unverified. */
  amount: number | null;
  is_estimate: boolean;
  foreign_spend: number;
  foreign_count: number;
  /** Foreign flags guessed from descriptions rather than read from a column. */
  low_confidence_count: number;
}

export interface FeeSummary {
  /** Which fee applies to this period. */
  basis: "annual_fee" | "first_year_fee";
  annual_fee_full: number | null;
  months_covered: number;
  /** annual fee × months_covered / 12, or null if unverified. */
  annual_fee_prorated: number | null;
  /** Fee lines posted on the statements, shown separately and not added to net value (FX lines are part of `fx`). */
  posted_fee_lines: number;
  posted_fx_fee_lines: number;
  interest: number;
}

export interface BenefitsReport {
  card_id: string;
  program_id: string | null;
  redemption: Redemption | null;
  /** True when the dollar value uses an estimated cents-per-point. */
  value_is_estimate: boolean;
  period: { start: string | null; end: string | null };
  points_total: number;
  rewards_value: number | null;
  categories: CategoryBenefit[];
  transactions: TransactionBenefit[];
  caps: CapUsage[];
  credits: CreditUsage[];
  credits_total: number;
  fx: FxEstimate;
  fees: FeeSummary;
  /** Net value from the verified parts only: rewards + credits − prorated annual fee − FX cost. */
  net_value: number;
  /** Parts left out of net_value because they are unverified. */
  net_value_excludes: string[];
  unverified: UnverifiedItem[];
}

export interface BenefitsInput {
  card: Card;
  /** The card's program, or null when card.program_id is null or unknown. */
  program: Program | null;
  items: readonly CategorizedTransaction[];
  /** Redemption method to value points with. Default: the program's first non-estimate method. */
  redemption_method?: string | null;
  /** Card open date (YYYY-MM-DD). Used to pick the first-year fee. */
  open_date?: string | null;
  /** Override the months the statements cover. */
  months_covered?: number | null;
}

/** The redemption to value points with: the requested one, else the first non-estimate, else the first. */
export function chooseRedemption(program: Program | null, requested?: string | null): Redemption | null {
  if (!program || program.redemptions.length === 0) return null;
  return (
    (requested ? program.redemptions.find((r) => r.method === requested) : undefined) ??
    program.redemptions.find((r) => !r.is_estimate) ??
    program.redemptions[0]
  );
}

const REASON_LABELS: Record<UnverifiedReason, string> = {
  earn_rules: "Earn rates for this card are not yet verified",
  earn_rate: "An earn rate is not yet verified",
  base_rate: "The base earn rate is not yet verified",
  cap: "A spending cap is not yet verified",
  after_cap_rate: "The rate after a cap is not yet verified",
};

const isSpend = (t: Transaction) => t.kind === "purchase" || t.kind === "refund";

export function computeBenefits(input: BenefitsInput): BenefitsReport {
  const { card, program, items } = input;
  const unverified: UnverifiedItem[] = [];
  const addUnverified = (u: UnverifiedItem) => {
    const existing = unverified.find((x) => x.kind === u.kind && x.label === u.label);
    if (existing) {
      existing.count += u.count;
      existing.amount = existing.amount === null || u.amount === null ? null : roundCents(existing.amount + u.amount);
    } else unverified.push({ ...u });
  };

  // Dollar valuation.
  const redemption = chooseRedemption(program, input.redemption_method);
  // valuePerDollar returns null when the redemption's value is unverified.
  const canValue = program !== null && redemption !== null && valuePerDollar(1, program, redemption.method) !== null;
  const toDollars = (points: number): number | null =>
    canValue ? valuePerDollar(points, program!, redemption!.method) : null;
  if (program === null) {
    addUnverified({ kind: "program", label: "The card's points program is not yet verified", count: 1, amount: null });
  } else if (!canValue) {
    addUnverified({ kind: "redemption_value", label: "The point value for this redemption is not yet verified", count: 1, amount: null });
  }

  // Points.
  const earned = earnPoints(card, items);
  for (const t of earned.transactions) {
    if (t.unverified_reason) {
      addUnverified({ kind: t.unverified_reason, label: REASON_LABELS[t.unverified_reason], count: 1, amount: t.unverified_amount });
    }
  }
  const transactions: TransactionBenefit[] = earned.transactions.map((t) => ({ ...t, value: toDollars(t.points) }));
  const points_total = earned.transactions.reduce((s, t) => s + t.points, 0);

  const byCat = new Map<Category, CategoryBenefit>();
  for (const t of earned.transactions) {
    const row = byCat.get(t.category) ?? {
      category: t.category, net_spend: 0, points: 0, value: null, unverified_amount: 0, unverified_count: 0,
    };
    row.net_spend = roundCents(row.net_spend + t.transaction.amount_cad);
    row.points += t.points;
    if (t.unverified_reason) {
      row.unverified_amount = roundCents(row.unverified_amount + t.unverified_amount);
      row.unverified_count += 1;
    }
    byCat.set(t.category, row);
  }
  const categories = [...byCat.values()]
    .map((r) => ({ ...r, value: toDollars(r.points) }))
    .sort((a, b) => b.points - a.points || a.category.localeCompare(b.category));

  // Purchase credits. Statement-credit lines (kind "credit") are the actual
  // credit; otherwise estimate from eligible spend. Never both.
  const spendItems = items.filter((i) => isSpend(i.transaction));
  const creditLines = items.filter((i) => i.transaction.kind === "credit");
  const credits: CreditUsage[] = [];
  if (card.purchase_credits === null) {
    addUnverified({ kind: "purchase_credits", label: "Purchase credits for this card are not yet verified", count: 1, amount: null });
  } else {
    for (const c of card.purchase_credits) {
      const matched = spendItems.filter((i) =>
        c.merchant_keywords.some((k) => containsPhrase(i.transaction.description, k)),
      );
      const ownLines = creditLines.filter((i) => matchStatementCredit(card, i.transaction.description) === c);
      if (c.statement_keywords === null) {
        addUnverified({
          kind: "credit_statement_text",
          label: `How "${c.description}" appears on statements is not yet verified, so a posted credit line may be read as a refund`,
          count: 1,
          amount: null,
        });
      }
      if (c.amount === null || c.period === null) {
        addUnverified({ kind: "credit_terms", label: `Terms of "${c.description}" are not yet verified`, count: 1, amount: null });
        credits.push({
          description: c.description, period: c.period, period_key: null, limit: c.amount,
          eligible_spend: roundCents(matched.reduce((s, i) => s + i.transaction.amount_cad, 0)),
          matched_count: matched.length, used: null, method: null,
          posted: roundCents(-ownLines.reduce((s, i) => s + i.transaction.amount_cad, 0)),
          remaining: null, verified: false,
        });
        continue;
      }
      const periodKeys = [...new Set(items.map((i) => periodKey(i.transaction.date, c.period!)))].sort();
      for (const key of periodKeys) {
        const inPeriod = matched.filter((i) => periodKey(i.transaction.date, c.period!) === key);
        const postedLines = ownLines.filter((i) => periodKey(i.transaction.date, c.period!) === key);
        const eligible = roundCents(inPeriod.reduce((s, i) => s + i.transaction.amount_cad, 0));
        const posted = roundCents(-postedLines.reduce((s, i) => s + i.transaction.amount_cad, 0));
        const method = postedLines.length > 0 ? "posted" : "estimated";
        const used = method === "posted" ? posted : roundCents(Math.min(Math.max(eligible, 0), c.amount));
        credits.push({
          description: c.description, period: c.period, period_key: key, limit: c.amount,
          eligible_spend: eligible, matched_count: inPeriod.length, used, method, posted,
          remaining: roundCents(Math.max(0, c.amount - used)), verified: true,
        });
      }
    }
  }
  const credits_total = roundCents(credits.reduce((s, c) => s + (c.used ?? 0), 0));

  // Foreign transactions.
  const foreign = spendItems.filter((i) => i.transaction.is_foreign);
  const foreign_spend = roundCents(foreign.reduce((s, i) => s + i.transaction.amount_cad, 0));
  const postedFx = items.filter((i) => isFxFeeLine(i.transaction));
  const posted_fx_fee_lines = roundCents(postedFx.reduce((s, i) => s + i.transaction.amount_cad, 0));
  const fxBase = {
    foreign_spend,
    foreign_count: foreign.length,
    low_confidence_count: foreign.filter((i) => i.transaction.is_foreign_confidence === "low").length,
  };
  let fx: FxEstimate;
  if (postedFx.length > 0) {
    fx = { ...fxBase, method: "posted", amount: posted_fx_fee_lines, is_estimate: false };
  } else if (foreign.length === 0) {
    fx = { ...fxBase, method: "none", amount: 0, is_estimate: false };
  } else if (card.fx_fee_pct === null) {
    fx = { ...fxBase, method: "unverified", amount: null, is_estimate: true };
    addUnverified({ kind: "fx_fee", label: "The foreign transaction fee is not yet verified", count: foreign.length, amount: foreign_spend });
  } else {
    const f = card.fx_fee_pct / 100;
    fx = { ...fxBase, method: "embedded_estimate", amount: roundCents((foreign_spend * f) / (1 + f)), is_estimate: true };
  }

  // Fees.
  const dates = items.map((i) => i.transaction.date).sort();
  const start = dates[0] ?? null;
  const end = dates[dates.length - 1] ?? null;
  const months = input.months_covered ?? monthsCovered(dates);
  const firstYear = Boolean(input.open_date && start && start < addMonths(input.open_date, 12));
  const annual_fee_full = firstYear ? card.first_year_fee : card.annual_fee;
  if (annual_fee_full === null) {
    addUnverified({
      kind: "annual_fee",
      label: firstYear ? "The first-year fee is not yet verified" : "The annual fee is not yet verified",
      count: 1,
      amount: null,
    });
  }
  const fees: FeeSummary = {
    basis: firstYear ? "first_year_fee" : "annual_fee",
    annual_fee_full,
    months_covered: months,
    annual_fee_prorated: annual_fee_full === null ? null : roundCents((annual_fee_full * months) / 12),
    posted_fee_lines: roundCents(
      items.filter((i) => i.transaction.kind === "fee" && !isFxFeeLine(i.transaction))
        .reduce((s, i) => s + i.transaction.amount_cad, 0),
    ),
    posted_fx_fee_lines,
    interest: roundCents(
      items.filter((i) => i.transaction.kind === "interest").reduce((s, i) => s + i.transaction.amount_cad, 0),
    ),
  };

  // Net value from verified parts only.
  const rewards_value = toDollars(points_total);
  const net_value_excludes: string[] = [];
  let net = credits_total;
  if (rewards_value === null) net_value_excludes.push("rewards value");
  else net += rewards_value;
  if (fees.annual_fee_prorated === null) net_value_excludes.push("annual fee");
  else net -= fees.annual_fee_prorated;
  if (fx.amount === null) net_value_excludes.push("foreign transaction fees");
  else net -= fx.amount;
  if (unverified.some((u) => u.kind in REASON_LABELS)) net_value_excludes.push("points on unverified earn terms");

  return {
    card_id: card.id,
    program_id: card.program_id,
    redemption,
    value_is_estimate: redemption?.is_estimate ?? false,
    period: { start, end },
    points_total,
    rewards_value: rewards_value === null ? null : roundCents(rewards_value),
    categories,
    transactions,
    caps: earned.caps,
    credits,
    credits_total,
    fx,
    fees,
    net_value: roundCents(net),
    net_value_excludes,
    unverified,
  };
}

export interface WelcomeBonusProgress {
  bonus_index: number;
  points_or_cash: number | null;
  min_spend: number | null;
  window_end: string | null;
  /** Net purchases (purchases minus refunds) in the uploaded statements within the window. */
  spend_so_far: number;
  /** null when min_spend is unverified. */
  remaining_spend: number | null;
  days_left: number | null;
  status: "open" | "met" | "expired" | "unverified";
}

/**
 * Progress toward each welcome bonus. Counts only the uploaded statements,
 * so spend on other statements is missing. `as_of` is today's date.
 */
export function welcomeBonusProgress(
  card: Card,
  items: readonly CategorizedTransaction[],
  open_date: string,
  as_of: string,
): WelcomeBonusProgress[] {
  if (!card.welcome_bonus) return [];
  return card.welcome_bonus.map((wb, bonus_index) => {
    const window_end = wb.window_months === null ? null : addMonths(open_date, wb.window_months);
    const spend = items.filter(
      (i) =>
        isSpend(i.transaction) &&
        i.transaction.date >= open_date &&
        (window_end === null || i.transaction.date < window_end),
    );
    const spend_so_far = roundCents(spend.reduce((s, i) => s + i.transaction.amount_cad, 0));
    const remaining_spend = wb.min_spend === null ? null : roundCents(Math.max(0, wb.min_spend - spend_so_far));
    const days_left = window_end === null ? null : Math.max(0, daysBetween(as_of, window_end));
    let status: WelcomeBonusProgress["status"];
    if (window_end === null || wb.min_spend === null) status = "unverified";
    else if (spend_so_far >= wb.min_spend) status = "met";
    else if (as_of >= window_end) status = "expired";
    else status = "open";
    return { bonus_index, points_or_cash: wb.points_or_cash, min_spend: wb.min_spend, window_end, spend_so_far, remaining_spend, days_left, status };
  });
}
