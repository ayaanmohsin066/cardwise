import { parseAmount } from "@/engine";

/**
 * A number the user typed into a balance or statement-total box, read with the
 * same parser as statement amounts (point as the decimal separator). null for
 * an empty or unreadable entry.
 */
export const parseTypedAmount = (input: string): number | null => parseAmount(input, ".");
