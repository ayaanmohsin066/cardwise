import { describe, expect, it } from "vitest";
import { roundCents, toCents } from "@/engine";

describe("toCents", () => {
  it("converts to integer cents without float drift", () => {
    expect(toCents(1.005)).toBe(101);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(-12.345)).toBe(-1234);
    expect(toCents(1234.56)).toBe(123456);
    expect(toCents(0)).toBe(0);
  });
});

describe("roundCents", () => {
  it("rounds to the cent", () => {
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(2.675)).toBe(2.68);
    expect(roundCents(45.67)).toBe(45.67);
  });
});
