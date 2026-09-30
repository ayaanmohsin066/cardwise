import { z } from "zod";
import { formatIssues, genericError, nonEmptyString, nonNegative, term } from "./schema-utils";

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

export const programSchema = z.strictObject({
  id: nonEmptyString,
  name: nonEmptyString,
  redemptions: z.array(redemptionSchema),
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
