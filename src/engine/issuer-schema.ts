import { z } from "zod";
import { formatIssues, genericError, nonEmptyString } from "./schema-utils";

export const issuerSchema = z.strictObject({
  /** Slug; also the directory name under src/data/cards/. */
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { error: "must be a lowercase slug" }),
  name: nonEmptyString,
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)], { error: "must be 1, 2 or 3" }),
});

export const issuerListSchema = z
  .strictObject({ issuers: z.array(issuerSchema) })
  .superRefine(({ issuers }, ctx) => {
    const seen = new Set<string>();
    issuers.forEach((iss, i) => {
      if (seen.has(iss.id)) {
        ctx.addIssue({ code: "custom", path: ["issuers", i, "id"], message: "is a duplicate" });
      }
      seen.add(iss.id);
    });
  });

export type Issuer = z.infer<typeof issuerSchema>;
export type IssuerTier = Issuer["tier"];
export type IssuerListValidationResult =
  | { ok: true; issuers: Issuer[] }
  | { ok: false; errors: string[] };

/** Validate the contents of src/data/issuers.json. */
export function validateIssuers(raw: unknown): IssuerListValidationResult {
  const r = issuerListSchema.safeParse(raw, { error: genericError });
  return r.success
    ? { ok: true, issuers: r.data.issuers }
    : { ok: false, errors: formatIssues(raw, r.error.issues, "issuers file") };
}
