import { z } from "zod";
import { CATEGORIES } from "./categories";
import {
  formatIssues,
  genericError,
  httpsUrl,
  isoDate,
  nonEmptyString,
  nonNegative,
  period,
  term,
} from "./schema-utils";

/*
 * Single source of truth for card data. Types in ./types are z.infer of these.
 *
 * Conventions (see CLAUDE.md):
 * - Every key is required. An unverified value is an explicit `null`.
 * - Lists are `null` when unverified and `[]` when verified to have none.
 * - A cap is `null` (unverified), `"none"` (verified uncapped) or an object.
 * - Rates are percent for `card_type: "cashback"` and points per CAD 1 for
 *   `card_type: "points"`.
 */

export const NETWORKS = ["visa", "mastercard", "amex"] as const;
export const CARD_TYPES = ["cashback", "points"] as const;
export const PERK_TYPES = [
  "travel_medical",
  "trip_cancellation",
  "rental_car",
  "purchase_protection",
  "extended_warranty",
  "lounge",
  "mobile_device",
  "other",
] as const;

const category = z.enum(CATEGORIES, { error: "is not a known category" });

export const capSchema = z.strictObject({
  amount: term(nonNegative),
  period: term(period),
});

export const earnRuleSchema = z.strictObject({
  categories: z
    .array(category)
    .min(1, { error: "must list at least one category" })
    .refine((cs) => new Set(cs).size === cs.length, { error: "must not repeat a category" }),
  rate: term(nonNegative),
  cap: term(z.union([z.literal("none"), capSchema])),
  after_cap_rate: term(nonNegative),
});

export const welcomeBonusSchema = z.strictObject({
  /** Points for points cards, CAD for cashback cards. */
  points_or_cash: term(nonNegative),
  min_spend: term(nonNegative),
  window_months: term(z.number().int().positive()),
});

export const purchaseCreditSchema = z.strictObject({
  description: nonEmptyString,
  /** Lowercase keywords used to match statement lines to this credit. */
  merchant_keywords: z.array(nonEmptyString),
  amount: term(nonNegative),
  period: term(period),
});

export const perkSchema = z.strictObject({
  type: z.enum(PERK_TYPES),
  summary: nonEmptyString,
  conditions: term(nonEmptyString),
  requires_enrollment: term(z.boolean()),
  source_url: httpsUrl,
});

export const cardSchema = z
  .strictObject({
    id: nonEmptyString,
    name: nonEmptyString,
    issuer: nonEmptyString,
    country: z.literal("CA", { error: 'must be "CA"' }),
    currency: z.literal("CAD", { error: 'must be "CAD"' }),
    network: term(z.enum(NETWORKS)),
    card_type: term(z.enum(CARD_TYPES)),
    program_id: term(nonEmptyString),
    annual_fee: term(nonNegative),
    first_year_fee: term(nonNegative),
    fx_fee_pct: term(nonNegative),
    base_rate: term(nonNegative),
    earn_rules: term(z.array(earnRuleSchema)),
    welcome_bonus: term(z.array(welcomeBonusSchema)),
    purchase_credits: term(z.array(purchaseCreditSchema)),
    perks: term(z.array(perkSchema)),
    source_url: httpsUrl,
    last_verified: isoDate,
  })
  .superRefine((card, ctx) => {
    // Each category may be covered by at most one earn rule, so the rate for a
    // category is never ambiguous.
    const seen = new Map<string, number>();
    card.earn_rules?.forEach((rule, i) => {
      rule.categories.forEach((c, j) => {
        const first = seen.get(c);
        if (first !== undefined && first !== i) {
          ctx.addIssue({
            code: "custom",
            path: ["earn_rules", i, "categories", j],
            message: `is already covered by earn_rules[${first}]`,
          });
        } else if (first === undefined) {
          seen.set(c, i);
        }
      });
    });
  });

export type Card = z.infer<typeof cardSchema>;
export type EarnRule = z.infer<typeof earnRuleSchema>;
export type Cap = z.infer<typeof capSchema>;
export type WelcomeBonus = z.infer<typeof welcomeBonusSchema>;
export type PurchaseCredit = z.infer<typeof purchaseCreditSchema>;
export type Perk = z.infer<typeof perkSchema>;
export type Network = (typeof NETWORKS)[number];
export type CardType = (typeof CARD_TYPES)[number];
export type PerkType = (typeof PERK_TYPES)[number];

export type CardValidationResult = { ok: true; card: Card } | { ok: false; errors: string[] };

/** Validate raw JSON against the card schema. */
export function validateCard(raw: unknown): CardValidationResult {
  const r = cardSchema.safeParse(raw, { error: genericError });
  return r.success
    ? { ok: true, card: r.data }
    : { ok: false, errors: formatIssues(raw, r.error.issues, "card") };
}
