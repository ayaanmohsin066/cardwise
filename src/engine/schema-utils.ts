import { z } from "zod";

/**
 * A card or program term: a verified value, or an explicit `null` meaning
 * "not yet verified". The key itself must always be present.
 */
export const term = <T extends z.ZodType>(schema: T) => schema.nullable();

export const nonEmptyString = z.string({ error: "must be a non-empty string" }).min(1, {
  error: "must be a non-empty string",
});

export const httpsUrl = z.string().refine(
  (s) => {
    if (!s.startsWith("https://")) return false;
    try {
      new URL(s);
      return true;
    } catch {
      return false;
    }
  },
  { error: "must be an https:// URL" },
);

export const isoDate = z.string().refine(
  (s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  },
  { error: "must be a valid YYYY-MM-DD date" },
);

export const nonNegative = z.number().finite().nonnegative();

export const PERIODS = ["month", "quarter", "year"] as const;
export const period = z.enum(PERIODS);

type PathKey = PropertyKey;

/** ["earn_rules", 0, "cap"] -> "earn_rules[0].cap" */
export function formatPath(path: readonly PathKey[]): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === "number") return `${acc}[${key}]`;
    return acc ? `${acc}.${String(key)}` : String(key);
  }, "");
}

function hasKeyAt(raw: unknown, path: readonly PathKey[]): boolean {
  let cur: unknown = raw;
  for (const key of path) {
    if (typeof cur !== "object" || cur === null || !(key in cur)) return false;
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return true;
}

function valueAt(raw: unknown, path: readonly PathKey[]): unknown {
  return path.reduce<unknown>(
    (cur, key) => (cur as Record<PropertyKey, unknown> | undefined)?.[key],
    raw,
  );
}

const isPlainObject = (x: unknown) => typeof x === "object" && x !== null && !Array.isArray(x);

/** Messages set via `error:` in the schemas above are fragments to prefix with the path. */
const GENERIC = "is invalid";

/**
 * Turn Zod issues into flat, human-readable strings:
 *   "<path> is missing (use null if unverified)"
 *   "<path> is invalid"
 *   "<path> <specific message from the schema>"
 * `rootName` names the whole document when the path is empty (e.g. "card").
 */
export function formatIssues(
  raw: unknown,
  issues: readonly z.core.$ZodIssue[],
  rootName: string,
  base: readonly PathKey[] = [],
): string[] {
  return issues.flatMap((issue) => {
    const path = [...base, ...issue.path];
    const label = formatPath(path) || rootName;

    if (path.length > 0 && !hasKeyAt(raw, path)) {
      return [`${label} is missing (use null if unverified)`];
    }
    if (issue.code === "invalid_union") {
      // A union like `"none" | {amount, period}`: if the input is an object,
      // report the object branch's own errors instead of a generic failure.
      const value = valueAt(raw, path);
      if (isPlainObject(value)) {
        const branch = issue.errors.find(
          (errs) => !errs.some((e) => e.path.length === 0 && e.code !== "unrecognized_keys"),
        );
        if (branch) return formatIssues(raw, branch, rootName, path);
      }
      return [`${label} ${issue.message}`];
    }
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((k) => `${formatPath([...path, k])} is not a known field`);
    }
    if (path.length === 0 && issue.code === "invalid_type") {
      return [`${rootName} must be an object`];
    }
    return [`${label} ${issue.message}`];
  });
}

/** Per-parse fallback: anything without a schema-specific message is "is invalid". */
export const genericError = () => GENERIC;
