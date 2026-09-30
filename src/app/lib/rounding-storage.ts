import { isRoundingMode, type RoundingMode } from "@/engine";

/*
 * The issuer rounding mode that matched this card's statement, saved per card
 * in this browser's localStorage only. Holds one word ("per_transaction" or
 * "per_statement"), no statement data. Failures just mean "not saved".
 */

const key = (cardId: string) => `cardopt:rounding:${cardId}`;

export function loadRounding(cardId: string): RoundingMode | null {
  try {
    const v = window.localStorage.getItem(key(cardId));
    return isRoundingMode(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveRounding(cardId: string, mode: RoundingMode): boolean {
  try {
    window.localStorage.setItem(key(cardId), mode);
    return true;
  } catch {
    return false;
  }
}
