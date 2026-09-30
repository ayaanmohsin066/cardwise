import { parseOverrides, serializeOverrides, type Overrides } from "@/engine";

/*
 * Category corrections, saved per card in this browser's localStorage only.
 * They hold merchant names mapped to categories, never amounts or dates, and
 * are never sent anywhere. Storage can be unavailable (private mode, blocked
 * site data), so every call is guarded and failure just means "not saved".
 */

const key = (cardId: string) => `cardopt:overrides:${cardId}`;

export function loadOverrides(cardId: string): Overrides {
  try {
    return parseOverrides(window.localStorage.getItem(key(cardId)));
  } catch {
    return {};
  }
}

/** Returns false if the browser refused to save. */
export function saveOverrides(cardId: string, overrides: Overrides): boolean {
  try {
    if (Object.keys(overrides).length === 0) window.localStorage.removeItem(key(cardId));
    else window.localStorage.setItem(key(cardId), serializeOverrides(overrides));
    return true;
  } catch {
    return false;
  }
}
