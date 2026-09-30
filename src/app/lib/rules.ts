import rulesJson from "@/data/merchant_rules.json";
import { validateMerchantRules, type MerchantRules } from "@/engine";

// Bundled with the client so categorization runs in the browser.
const result = validateMerchantRules(rulesJson);
if (!result.ok) throw new Error(`merchant_rules.json is invalid:\n${result.errors.join("\n")}`);

export const MERCHANT_RULES: MerchantRules = result.rules;
