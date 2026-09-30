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

/**
 * The inverse, for reading a statement: how many points a dollar amount of
 * rewards represents (e.g. $32.00 of cash back in "cash-cad" is 3,200 points).
 * Built on valuePerDollar so there is still one conversion rule. Returns null
 * when the redemption value is unverified or zero.
 */
export function pointsFromDollars(dollars: number, program: Program, redemptionMethod: string): Term<number> {
  const perPoint = valuePerDollar(1, program, redemptionMethod);
  if (perPoint === null || perPoint === 0) return null;
  return dollars / perPoint;
}

/**
 * Dollar value of a points balance redeemed by `redemptionMethod`. The
 * companion to valuePerDollar for balances (a balance of N points is "N
 * points per $1 × $1"), so there is still one conversion rule. null when the
 * redemption's value is unverified. Throws on an unknown method.
 */
export function pointsValue(points: number, program: Program, redemptionMethod: string): Term<number> {
  return valuePerDollar(points, program, redemptionMethod);
}
