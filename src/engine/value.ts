import type { Program } from "./program-schema";
import type { Term } from "./types";

/**
 * Dollars earned per CAD 1 of spend, for a rate in points per $1 redeemed by
 * `redemptionMethod` in `program`.
 *
 * This is the only place in the codebase that converts points to dollars.
 * Returns null when the rate or the redemption's cents_per_point is unverified.
 * Throws if the program has no such redemption method (a programming error).
 */
export function valuePerDollar(
  rate: Term<number>,
  program: Program,
  redemptionMethod: string,
): Term<number> {
  const redemption = program.redemptions.find((r) => r.method === redemptionMethod);
  if (!redemption) {
    throw new Error(`Program "${program.id}" has no redemption method "${redemptionMethod}"`);
  }
  if (rate === null || redemption.cents_per_point === null) return null;
  return (rate * redemption.cents_per_point) / 100;
}
