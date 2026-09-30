import { z } from "zod";
import { CATEGORIES } from "./categories";
import { formatIssues, genericError, nonEmptyString } from "./schema-utils";
import { normalizeText } from "./text";

/*
 * src/data/merchant_rules.json: merchant names -> master category.
 * Merchant names only. Never put card terms (rates, caps, fees) here.
 */

export const merchantRuleSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { error: "must be a lowercase slug" }),
  category: z.enum(CATEGORIES, { error: "is not a known category" }),
  keywords: z
    .array(
      nonEmptyString.refine((k) => normalizeText(k) !== "", {
        error: "must contain a letter or digit",
      }),
    )
    .min(1, { error: "must list at least one keyword" }),
});

export const merchantRulesSchema = z
  .strictObject({
    version: z.literal(1),
    rules: z.array(merchantRuleSchema),
  })
  .superRefine(({ rules }, ctx) => {
    const ruleIds = new Set<string>();
    const keywordOwner = new Map<string, number>();
    rules.forEach((rule, i) => {
      if (ruleIds.has(rule.id)) {
        ctx.addIssue({ code: "custom", path: ["rules", i, "id"], message: "is a duplicate" });
      }
      ruleIds.add(rule.id);
      rule.keywords.forEach((k, j) => {
        const norm = normalizeText(k);
        if (!norm) return;
        const owner = keywordOwner.get(norm);
        if (owner !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["rules", i, "keywords", j],
            message:
              owner === i
                ? `("${k}") is repeated in this rule`
                : `("${k}") is already used by rules[${owner}]`,
          });
        } else {
          keywordOwner.set(norm, i);
        }
      });
    });
  });

export type MerchantRule = z.infer<typeof merchantRuleSchema>;
export type MerchantRules = z.infer<typeof merchantRulesSchema>;
export type MerchantRulesValidationResult =
  | { ok: true; rules: MerchantRules }
  | { ok: false; errors: string[] };

/** Validate the contents of src/data/merchant_rules.json. */
export function validateMerchantRules(raw: unknown): MerchantRulesValidationResult {
  const r = merchantRulesSchema.safeParse(raw, { error: genericError });
  return r.success
    ? { ok: true, rules: r.data }
    : { ok: false, errors: formatIssues(raw, r.error.issues, "merchant rules") };
}
