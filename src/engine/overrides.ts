import { isCategory, type Category } from "./categories";
import { normalizeText } from "./text";

/**
 * A user's category corrections for one card: merchant key -> category.
 * Persisted by the UI in the browser's localStorage only. These helpers are
 * pure; they never touch storage themselves.
 */
export type Overrides = Readonly<Record<string, Category>>;

/**
 * The key an override is saved under. Normalized description with any token
 * containing a digit removed, so store numbers and reference codes don't
 * matter: "LOBLAWS #1234 TORONTO" and "LOBLAWS #0567 TORONTO" share a key.
 * Falls back to the full normalized text if nothing else is left.
 */
export function overrideKey(description: string): string {
  const norm = normalizeText(description);
  const kept = norm.split(" ").filter((t) => t && !/\d/.test(t));
  return kept.length ? kept.join(" ") : norm;
}

export function setOverride(overrides: Overrides, description: string, category: Category): Overrides {
  return { ...overrides, [overrideKey(description)]: category };
}

export function removeOverride(overrides: Overrides, description: string): Overrides {
  const key = overrideKey(description);
  if (!(key in overrides)) return overrides;
  const next = { ...overrides };
  delete next[key];
  return next;
}

/**
 * Read overrides from stored JSON. Anything unreadable is ignored: a corrupt
 * or old entry must never break the app, so bad input gives {} and entries
 * whose category is not a master category are dropped.
 */
export function parseOverrides(json: string | null): Overrides {
  if (!json) return {};
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
  return Object.fromEntries(
    Object.entries(data).filter(([k, v]) => k !== "" && isCategory(v)),
  ) as Overrides;
}

export function serializeOverrides(overrides: Overrides): string {
  return JSON.stringify(overrides);
}
