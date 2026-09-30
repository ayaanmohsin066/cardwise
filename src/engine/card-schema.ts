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
 * - Caps are defined once in `caps` and referenced by `earn_rules[].cap_id`,
 *   so several rules can share one cap. `cap_id` is `null` (unverified),
 *   `"none"` (verified uncapped) or the id of an entry in `caps`.
 * - Every rate, and every welcome-bonus amount, is in points of the card's
 *   program. Cashback cards use the "cash-cad" program (1 point = 1 cent), so
 *   2% back is rate 2. Only `valuePerDollar()` converts points to dollars.
 * - `card_type` is for display only and never changes how a rate is read.
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

/** The built-in program for cashback cards: 1 point = 1 cent. */
export const CASH_PROGRAM_ID = "cash-cad";

/** A cap_id value meaning "verified to have no cap". */
export const NO_CAP = "none";

export const capSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { error: "must be a lowercase slug" })
    .refine((id) => id !== NO_CAP, { error: `must not be "${NO_CAP}"` }),
  amount: term(nonNegative),
  period: term(period),
});

export const earnRuleSchema = z.strictObject({
  categories: z
    .array(category)
    .min(1, { error: "must list at least one category" })
    .refine((cs) => new Set(cs).size === cs.length, { error: "must not repeat a category" }),
  rate: term(nonNegative),
  /** null = unverified, "none" = verified uncapped, otherwise an id in `caps`. */
  cap_id: term(nonEmptyString),
  after_cap_rate: term(nonNegative),
});

export const welcomeBonusSchema = z.strictObject({
  /** In program points, like rates. For "cash-cad", $100 is 10000. */
  points_or_cash: term(nonNegative),
  min_spend: term(nonNegative),
  window_months: term(z.number().int().positive()),
});

export const purchaseCreditSchema = z.strictObject({
  description: nonEmptyString,
  /** Keywords matching purchases that are eligible for this credit (the merchant). */
  merchant_keywords: z.array(nonEmptyString),
  /**
   * Keywords identifying the issuer's own statement-credit line for this credit
   * (e.g. "annual travel credit"). null until verified from a real statement.
   */
  statement_keywords: term(z.array(nonEmptyString)),
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
    caps: term(z.array(capSchema)),
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

    // Cap ids are unique, every cap_id resolves, and every cap is used.
    const capIds = new Map<string, number>();
    card.caps?.forEach((cap, k) => {
      if (capIds.has(cap.id)) {
        ctx.addIssue({ code: "custom", path: ["caps", k, "id"], message: "is a duplicate" });
      } else {
        capIds.set(cap.id, k);
      }
    });
    const used = new Set<string>();
    card.earn_rules?.forEach((rule, i) => {
      // Empty ids already fail the field check; don't report them twice.
      if (!rule.cap_id || rule.cap_id === NO_CAP) return;
      used.add(rule.cap_id);
      if (!capIds.has(rule.cap_id)) {
        ctx.addIssue({
          code: "custom",
          path: ["earn_rules", i, "cap_id"],
          message: `"${rule.cap_id}" is not defined in caps`,
        });
      }
    });
    // Only check usage when the rules are known; with earn_rules null, caps
    // may be verified before the rules are.
    if (card.earn_rules !== null) {
      card.caps?.forEach((cap, k) => {
        if (cap.id !== NO_CAP && !used.has(cap.id) && capIds.get(cap.id) === k) {
          ctx.addIssue({
            code: "custom",
            path: ["caps", k],
            message: `("${cap.id}") is not used by any earn rule`,
          });
        }
      });
    }

    // Cashback cards are expressed in the cash program; points cards are not.
    if (card.card_type === "cashback" && card.program_id !== null && card.program_id !== CASH_PROGRAM_ID) {
      ctx.addIssue({
        code: "custom",
        path: ["program_id"],
        message: `must be "${CASH_PROGRAM_ID}" for a cashback card`,
      });
    }
    if (card.card_type === "points" && card.program_id === CASH_PROGRAM_ID) {
      ctx.addIssue({
        code: "custom",
        path: ["program_id"],
        message: `must not be "${CASH_PROGRAM_ID}" for a points card`,
      });
    }
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
