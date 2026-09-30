/**
 * Pure helpers for the card-entry scripts (scripts/new-card.ts,
 * scripts/card-status.ts and the program equivalents). No file I/O here.
 */
import { cardSchema, validateCard } from "./card-schema";
import { daysBetween } from "./dates";
import { programSchema, validateProgram } from "./program-schema";

/** Data older than this many days is stale; card-status exits non-zero. */
export const STALE_DAYS = 180;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const isSlug = (s: string) => SLUG.test(s);

/**
 * A new card with every schema key present. Everything is null except what
 * the arguments and the project rules fix (id, issuer, CA, CAD). It fails
 * validation until name, source_url and last_verified are filled in.
 */
export function cardSkeleton(issuer: string, id: string): Record<string, unknown> {
  const fixed: Record<string, unknown> = { id, issuer, country: "CA", currency: "CAD" };
  return Object.fromEntries(Object.keys(cardSchema.shape).map((k) => [k, k in fixed ? fixed[k] : null]));
}

/** A new program with every schema key present and null (except its id). */
export function programSkeleton(id: string): Record<string, unknown> {
  return Object.fromEntries(Object.keys(programSchema.shape).map((k) => [k, k === "id" ? id : null]));
}

/** Number of null values anywhere in a JSON value. */
export function countNulls(value: unknown): number {
  if (value === null) return 1;
  if (Array.isArray(value)) return value.reduce((s: number, v) => s + countNulls(v), 0);
  if (typeof value === "object") return Object.values(value as object).reduce((s: number, v) => s + countNulls(v), 0);
  return 0;
}

export interface DataStatus {
  file: string;
  id: string;
  valid: boolean;
  errors: string[];
  nulls: number;
  last_verified: string | null;
  /** Days since last_verified; null when not set (or a built-in unit). */
  age_days: number | null;
  stale: boolean;
}

function status(file: string, raw: unknown, errors: string[], today: string): DataStatus {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const last = typeof obj.last_verified === "string" ? obj.last_verified : null;
  const age = last && /^\d{4}-\d{2}-\d{2}$/.test(last) ? daysBetween(last, today) : null;
  return {
    file,
    id: typeof obj.id === "string" ? obj.id : "(no id)",
    valid: errors.length === 0,
    errors,
    nulls: countNulls(raw),
    last_verified: last,
    age_days: age,
    stale: age !== null && age > STALE_DAYS,
  };
}

export function cardStatus(file: string, raw: unknown, today: string): DataStatus {
  const r = validateCard(raw);
  return status(file, raw, r.ok ? [] : r.errors, today);
}

export function programStatus(file: string, raw: unknown, today: string): DataStatus {
  const r = validateProgram(raw);
  return status(file, raw, r.ok ? [] : r.errors, today);
}

/** Exit code for the status scripts: 1 if anything is stale or invalid. */
export function statusExitCode(rows: readonly DataStatus[]): number {
  return rows.some((r) => r.stale || !r.valid) ? 1 : 0;
}
