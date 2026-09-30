/**
 * "Your points are worth": a points balance valued under each of the card's
 * program redemption methods. Dollars only via pointsValue() (value.ts).
 */
import { CASH_PROGRAM_ID } from "./card-schema";
import type { Program } from "./program-schema";
import { pointsValue } from "./value";

export interface RedemptionOption {
  method: string;
  /** $ value of the balance, or null when this method's value is unverified. */
  value: number | null;
  is_estimate: boolean;
  /** The program's stated basis for an estimate (its `notes`), or null. */
  basis: string | null;
}

export type RedemptionReport =
  | { kind: "unverified"; reason: string }
  /** Cash-back cards: the balance is already dollars; no methods to compare. */
  | { kind: "cash"; balance: number }
  | {
      kind: "points";
      balance: number;
      /** Highest value first; unverified methods last. */
      options: RedemptionOption[];
      /** Highest-value verified, non-estimate method. */
      best: RedemptionOption | null;
      /** Lowest-value verified, non-estimate method (null when only one). */
      lowest: RedemptionOption | null;
      /** best − lowest, in dollars (null when there's no pair to compare). */
      gap: number | null;
      /** An estimated method worth more than `best`, shown separately and labelled. */
      higher_estimate: RedemptionOption | null;
      unverified_count: number;
    };

/**
 * Value a balance under every redemption method of the card's program.
 * `balance` is points, or dollars for cash-back cards (program "cash-cad").
 */
export function redemptionValues(program: Program | null, balance: number): RedemptionReport {
  if (!program) return { kind: "unverified", reason: "This card's points program is not yet verified." };
  if (program.id === CASH_PROGRAM_ID) return { kind: "cash", balance };
  if (program.redemptions.length === 0) {
    return { kind: "unverified", reason: "This program's redemption options are not yet verified." };
  }

  const options: RedemptionOption[] = program.redemptions.map((r) => ({
    method: r.method,
    value: pointsValue(balance, program, r.method),
    is_estimate: r.is_estimate,
    basis: r.is_estimate ? r.notes : null,
  }));
  options.sort((a, b) =>
    a.value === null ? (b.value === null ? a.method.localeCompare(b.method) : 1)
      : b.value === null ? -1
        : b.value - a.value || a.method.localeCompare(b.method),
  );

  const firm = options.filter((o) => o.value !== null && !o.is_estimate);
  const best = firm[0] ?? null;
  const lowest = firm.length > 1 ? firm[firm.length - 1] : null;
  const topEstimate = options.find((o) => o.value !== null && o.is_estimate) ?? null;
  return {
    kind: "points",
    balance,
    options,
    best,
    lowest,
    gap: best && lowest ? best.value! - lowest.value! : null,
    higher_estimate: topEstimate && (!best || topEstimate.value! > best.value!) ? topEstimate : null,
    unverified_count: options.filter((o) => o.value === null).length,
  };
}
