import type { Category, CategoryPolicy, CreditRule, PolicyStep } from "@/engine";
import { CATEGORY_LABELS, formatCad } from "./format";

const PERIOD = { month: "month", quarter: "quarter", year: "year" } as const;

function step(s: PolicyStep, name: (id: string) => string, isLast: boolean, own?: Category): string {
  if (!s.until_cap) return name(s.card_id);
  const others = s.until_cap.shared_with.filter((c) => c !== own);
  const shared = others.length > 0 && s.until_cap.shared_with.length > 1
    ? ` (shared with ${others.map((c) => CATEGORY_LABELS[c].toLowerCase()).join(" and ")})`
    : "";
  const cap = `its ${formatCad(s.until_cap.amount)}/${PERIOD[s.until_cap.period]} cap${shared}`;
  return isLast ? `${name(s.card_id)} (up to ${cap})` : `${name(s.card_id)} until ${cap} is reached`;
}

/**
 * "Card A until its $500/month cap (shared with dining) is reached, then Card B".
 * `own` is the category being described, left out of "shared with".
 */
export function describeSteps(steps: readonly PolicyStep[], name: (id: string) => string, own?: Category): string {
  return steps.map((s, i) => step(s, name, i === steps.length - 1, own)).join(", then ");
}

/** One plain sentence per category, e.g. "Groceries: use Card A until …, then Card B." */
export function describePolicy(p: CategoryPolicy, name: (id: string) => string): string[] {
  const out = [`${CATEGORY_LABELS[p.category]}: use ${describeSteps(p.steps, name, p.category)}.`];
  if (p.foreign_steps) {
    out.push(`${CATEGORY_LABELS[p.category]}, foreign-currency purchases: use ${describeSteps(p.foreign_steps, name, p.category)}.`);
  }
  return out;
}

/** "At fake air or fake hotels: use Card P first, until its $100/year credit (FAKE: …) is used." */
export function describeCreditRule(c: CreditRule, name: (id: string) => string): string {
  const where = c.merchant_keywords.map((k) => k.toUpperCase()).join(" or ");
  return `At ${where}: use ${name(c.card_id)} first, until its ${formatCad(c.limit)}/${PERIOD[c.period]} credit ("${c.description}") is used.`;
}
