import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatIssues, formatPath } from "@/engine";

describe("formatPath", () => {
  it("formats keys and array indexes", () => {
    expect(formatPath([])).toBe("");
    expect(formatPath(["a"])).toBe("a");
    expect(formatPath(["earn_rules", 0, "cap", "amount"])).toBe("earn_rules[0].cap.amount");
    expect(formatPath([0, "x"])).toBe("[0].x");
  });
});

describe("formatIssues", () => {
  const schema = z.strictObject({ a: z.number().nullable(), b: z.string({ error: "must be text" }) });
  const run = (raw: unknown) => {
    const r = schema.safeParse(raw, { error: () => "is invalid" });
    return r.success ? [] : formatIssues(raw, r.error.issues, "doc");
  };

  it("distinguishes missing keys from invalid values", () => {
    expect(run({ b: "x" })).toEqual(["a is missing (use null if unverified)"]);
    expect(run({ a: "1", b: "x" })).toEqual(["a is invalid"]);
  });

  it("uses schema-specific messages", () => {
    expect(run({ a: 1, b: 2 })).toEqual(["b must be text"]);
  });

  it("reports unknown keys and non-object roots", () => {
    expect(run({ a: 1, b: "x", c: 1 })).toEqual(["c is not a known field"]);
    expect(run(5)).toEqual(["doc must be an object"]);
  });
});
