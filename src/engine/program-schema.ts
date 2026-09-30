import { z } from "zod";
import { formatIssues, genericError, httpsUrl, isoDate, nonEmptyString, nonNegative, term } from "./schema-utils";

export const redemptionSchema = z
  .strictObject({
    method: nonEmptyString,
    cents_per_point: term(nonNegative),
    /** true when cents_per_point is not a fixed issuer-published rate. */
    is_estimate: z.boolean(),
    notes: term(nonEmptyString),
  })
  .refine((r) => !r.is_estimate || r.notes !== null, {
    path: ["notes"],
    error: "must explain the basis of an estimate",
  });

export const programSchema = z
  .strictObject({
    id: nonEmptyString,
    name: nonEmptyString,
    redemptions: z.array(redemptionSchema),
    /** Issuer page the redemption values were checked against. null only for built-in units (cash-cad). */
    source_url: term(httpsUrl),
    /** When source_url was last checked. null exactly when source_url is null. */
    last_verified: term(isoDate),
  })
  .refine((p) => (p.source_url === null) === (p.last_verified === null), {
    path: ["last_verified"],
    error: "must be set exactly when source_url is set",
  });

export type Program = z.infer<typeof programSchema>;
export type Redemption = z.infer<typeof redemptionSchema>;
export type ProgramValidationResult =
  | { ok: true; program: Program }
  | { ok: false; errors: string[] };

/** Validate raw JSON against the points-program schema. */
export function validateProgram(raw: unknown): ProgramValidationResult {
  const r = programSchema.safeParse(raw, { error: genericError });
  return r.success
    ? { ok: true, program: r.data }
    : { ok: false, errors: formatIssues(raw, r.error.issues, "program") };
}
