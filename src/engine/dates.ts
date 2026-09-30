/** Calendar helpers on ISO dates (YYYY-MM-DD). All UTC, no time of day. */

export type Period = "month" | "quarter" | "year";

const parts = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
};
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The calendar period an ISO date falls in: "2026-01" (month), "2026-Q1"
 * (quarter) or "2026" (year).
 */
export function periodKey(iso: string, period: Period): string {
  const { y, m } = parts(iso);
  if (period === "month") return `${y}-${pad(m)}`;
  if (period === "quarter") return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  return String(y);
}

/** Add calendar months, clamping the day to the end of the target month (Jan 31 + 1 = Feb 28). */
export function addMonths(iso: string, months: number): string {
  const { y, m, d } = parts(iso);
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${pad(tm)}-${pad(Math.min(d, lastDay))}`;
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  const t = (iso: string) => {
    const { y, m, d } = parts(iso);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / 86_400_000);
}

const AVG_DAYS_PER_MONTH = 365.25 / 12;

/**
 * How many months a set of statement dates covers: the inclusive day span
 * divided by the average month length, rounded, and at least 1. So one
 * statement (about 30 days) is 1 month, and three statements are 3.
 */
export function monthsCovered(dates: readonly string[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...dates].sort();
  const days = daysBetween(sorted[0], sorted[sorted.length - 1]) + 1;
  return Math.max(1, Math.round(days / AVG_DAYS_PER_MONTH));
}
