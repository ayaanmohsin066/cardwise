/**
 * Core domain types. Canada only, CAD only.
 *
 * The data types are inferred from the Zod schemas, which are the single
 * source of truth. Any card term that has not been verified against the
 * issuer's own page is `null`, never a guess. The UI renders `null` as
 * "not yet verified".
 */

/** Amount in Canadian dollars. */
export type CAD = number;

/** A card term that is either verified or explicitly unknown. */
export type Term<T> = T | null;

export type { Category } from "./categories";
export type {
  Card,
  Cap,
  CardType,
  EarnRule,
  Network,
  Perk,
  PerkType,
  PurchaseCredit,
  WelcomeBonus,
} from "./card-schema";
export type { Program, Redemption } from "./program-schema";
export type { Issuer, IssuerTier } from "./issuer-schema";
