import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAmount } from "@/engine";
import { parseTypedAmount } from "../../src/app/lib/typed-amount";

const COMPONENTS = ["ReconcileBox.tsx", "RedeemPanel.tsx"];
const source = (name: string) => readFileSync(join(__dirname, "..", "..", "src", "app", "components", name), "utf8");

describe("typed amounts (statement check and balance boxes)", () => {
  // Typed input, and whether ingest's parseAmount reads it.
  const cases: [string, number | null][] = [
    ["12500", 12500],
    ["12,500", 12500],
    ["$1,234.56", 1234.56],
    [" 42.10 ", 42.1],
    [".5", 0.5],
    ["0", 0],
    ["-12.00", -12],
    ["12.00-", -12],
    ["(12.00)", -12],
    ["12.00 CR", -12],
    ["", null],
    ["   ", null],
    ["abc", null],
    ["1.2.3", null],
    ["12 points", null],
    // The old regex + Number() accepted these; ingest does not.
    ["1e3", null],
    ["0x10", null],
    ["Infinity", null],
  ];

  it.each(cases)("%j is read exactly as ingest's parseAmount reads it", (input, expected) => {
    expect(parseAmount(input, ".")).toBe(expected);
    expect(parseTypedAmount(input)).toBe(parseAmount(input, "."));
  });

  it.each(COMPONENTS)("%s reads its typed amount only through parseTypedAmount", (name) => {
    const src = source(name);
    expect(src).toMatch(/import \{ parseTypedAmount \} from "\.\.\/lib\/typed-amount";/);
    expect(src).toMatch(/= parseTypedAmount\(input\);/);
    // No second parser: no Number()/parseFloat conversion of the input, no stripping regex.
    expect(src).not.toMatch(/Number\(input|parseFloat|parseInt|input\.replace\(/);
  });
});
