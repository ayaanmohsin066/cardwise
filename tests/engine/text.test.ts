import { describe, expect, it } from "vitest";
import { containsPhrase, normalizeText } from "@/engine";

describe("normalizeText", () => {
  it("lowercases, strips accents and collapses punctuation", () => {
    expect(normalizeText("Petro-Canada #123")).toBe("petro canada 123");
    expect(normalizeText("  ÉPICERIE  Montréal ")).toBe("epicerie montreal");
    expect(normalizeText("McDonald's")).toBe("mcdonald s");
    expect(normalizeText("---")).toBe("");
  });
});

describe("containsPhrase", () => {
  it("matches whole words only, case-insensitively", () => {
    expect(containsPhrase("SHELL C12345", "shell")).toBe(true);
    expect(containsPhrase("SHELLFISH MARKET", "shell")).toBe(false);
    expect(containsPhrase("BARBER SHOP", "bar")).toBe(false);
    expect(containsPhrase("uber eats toronto", "UBER EATS")).toBe(true);
  });

  it("matches multi-word phrases across punctuation", () => {
    expect(containsPhrase("PETRO-CANADA 1234", "petro canada")).toBe(true);
    expect(containsPhrase("BOOKING.COM AMSTERDAM", "booking.com")).toBe(true);
    expect(containsPhrase("AIR CANADA", "canada air")).toBe(false);
  });

  it("never matches an empty phrase", () => {
    expect(containsPhrase("anything", "")).toBe(false);
    expect(containsPhrase("anything", "  #  ")).toBe(false);
  });
});
