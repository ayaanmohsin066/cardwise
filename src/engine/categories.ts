/** The master spending categories. Every earn rule must use only these. */
export const CATEGORIES = [
  "groceries",
  "dining",
  "gas",
  "transit",
  "travel",
  "streaming",
  "drugstore",
  "recurring_bills",
  "entertainment",
  "home_improvement",
  "online_shopping",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(x: unknown): x is Category {
  return typeof x === "string" && (CATEGORIES as readonly string[]).includes(x);
}
