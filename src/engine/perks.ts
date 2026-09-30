/**
 * "Benefits you may not be using": the card's perks as stated in its JSON,
 * plus informational nudges triggered by the user's transactions.
 *
 * Nothing here states coverage amounts, limits or conditions that aren't in
 * the card JSON. Perk text is passed through verbatim; null fields surface as
 * "details not verified" in the UI, with the perk's source_url.
 */
import type { BenefitsReport } from "./benefits";
import type { Card, Perk } from "./card-schema";
import type { CategorizedTransaction } from "./categorize";
import { daysBetween, periodBounds, periodKey } from "./dates";
import type { MerchantRules } from "./merchant-rules-schema";
import { containsPhrase } from "./text";

export interface PerkInfo {
  perk: Perk;
  /** False when conditions, requires_enrollment or requires_charge_to_card is null (unverified). */
  details_verified: boolean;
}

export type PerkListing = { status: "unverified" } | { status: "ok"; perks: PerkInfo[] };

/** The card's perks, exactly as listed. `perks: null` means not yet verified. */
export function listPerks(card: Card): PerkListing {
  if (card.perks === null) return { status: "unverified" };
  return {
    status: "ok",
    perks: card.perks.map((perk) => ({
      perk,
      details_verified:
        perk.conditions !== null && perk.requires_enrollment !== null && perk.requires_charge_to_card !== null,
    })),
  };
}

export interface NudgePurchase {
  id: string;
  date: string;
  description: string;
  amount: number;
}

export type Nudge =
  /** Purchases at electronics/appliance stores, and the card lists purchase protection or extended warranty. */
  | { kind: "protection"; perk: Perk; purchases: NudgePurchase[] }
  /** Travel purchases, and the perk has requires_charge_to_card: true. */
  | { kind: "travel_charge"; perk: Perk; purchases: NudgePurchase[] }
  /** The perk requires enrollment (requires_enrollment: true). */
  | { kind: "enrollment"; perk: Perk }
  /** A purchase credit with money left in the period containing `as_of`. */
  | {
      kind: "credit";
      description: string;
      merchant_keywords: string[];
      limit: number;
      /** Left in the current period, based on the uploaded statements only. */
      remaining: number;
      period_end: string;
      days_left: number;
    };

const PROTECTION_TYPES = new Set<Perk["type"]>(["purchase_protection", "extended_warranty"]);
const TRAVEL_TYPES = new Set<Perk["type"]>(["travel_medical", "trip_cancellation", "rental_car"]);

const toPurchase = (i: CategorizedTransaction): NudgePurchase => ({
  id: i.transaction.id,
  date: i.transaction.date,
  description: i.transaction.description,
  amount: i.transaction.amount_cad,
});

/**
 * Informational nudges for one card. `report` supplies credit usage from the
 * benefits report; `as_of` is today (YYYY-MM-DD).
 */
export function perkNudges(
  card: Card,
  items: readonly CategorizedTransaction[],
  rules: MerchantRules,
  report: BenefitsReport | null,
  as_of: string,
): Nudge[] {
  const nudges: Nudge[] = [];
  const purchases = items.filter((i) => i.transaction.kind === "purchase");

  for (const perk of card.perks ?? []) {
    if (PROTECTION_TYPES.has(perk.type)) {
      const matched = purchases.filter((i) =>
        rules.nudge_merchants.electronics_appliances.some((k) => containsPhrase(i.transaction.description, k)),
      );
      if (matched.length) nudges.push({ kind: "protection", perk, purchases: matched.map(toPurchase) });
    }
    // Only an explicit, verified `true` triggers this reminder; null (unverified) never does.
    if (TRAVEL_TYPES.has(perk.type) && perk.requires_charge_to_card === true) {
      const travel = purchases.filter((i) => i.category === "travel");
      if (travel.length) nudges.push({ kind: "travel_charge", perk, purchases: travel.map(toPurchase) });
    }
    if (perk.requires_enrollment === true) nudges.push({ kind: "enrollment", perk });
  }

  for (const c of card.purchase_credits ?? []) {
    if (c.amount === null || c.period === null) continue;
    const bounds = periodBounds(as_of, c.period);
    const key = periodKey(as_of, c.period);
    const used = report?.credits.find((x) => x.description === c.description && x.period_key === key)?.used ?? 0;
    const remaining = Math.max(0, c.amount - used);
    if (remaining > 0) {
      nudges.push({
        kind: "credit",
        description: c.description,
        merchant_keywords: c.merchant_keywords,
        limit: c.amount,
        remaining,
        period_end: bounds.end,
        days_left: daysBetween(as_of, bounds.end),
      });
    }
  }
  return nudges;
}
