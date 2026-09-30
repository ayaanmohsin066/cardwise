import { describe, expect, it } from "vitest";
import { categorize, classifyStatementCredits, matchStatementCredit, summarizeStatement, type Card } from "@/engine";
import { fixtureCard, item } from "../helpers/cards";
import { seededRules } from "../helpers/statements";

const card = fixtureCard("fake-points"); // credit: merchant "fake air"/"fake hotels", statement "fake travel credit"
const tx = (description: string, amount: number, kind?: "refund" | "payment" | "purchase") =>
  item("2026-03-01", "travel", amount, { description, ...(kind ? { kind } : {}) }).transaction;

describe("matchStatementCredit", () => {
  it("matches by statement_keywords on word boundaries", () => {
    expect(matchStatementCredit(card, "FAKE TRAVEL CREDIT 2026")?.description).toBe("FAKE: $100 annual travel credit");
    expect(matchStatementCredit(card, "FAKE AIR REFUND")).toBeNull();
    expect(matchStatementCredit(card, "FAKE TRAVEL CREDITS")).toBeNull();
  });

  it("never matches when statement_keywords or the credit list are unverified", () => {
    const unverified: Card = { ...card, purchase_credits: [{ ...card.purchase_credits![0], statement_keywords: null }] };
    expect(matchStatementCredit(unverified, "FAKE TRAVEL CREDIT")).toBeNull();
    expect(matchStatementCredit({ ...card, purchase_credits: null }, "FAKE TRAVEL CREDIT")).toBeNull();
  });
});

describe("classifyStatementCredits", () => {
  it("turns matching credit-side lines into kind credit and leaves the rest", () => {
    const out = classifyStatementCredits(card, [
      tx("FAKE TRAVEL CREDIT", -100),
      tx("FAKE TRAVEL CREDIT", -100, "payment"),
      tx("FAKE AIR", -50), // a real merchant refund stays a refund
      tx("FAKE TRAVEL CREDIT", 100), // a charge is never a credit
    ]);
    expect(out.map((t) => t.kind)).toEqual(["credit", "credit", "refund", "purchase"]);
  });

  it("does not mutate the input", () => {
    const input = [tx("FAKE TRAVEL CREDIT", -100)];
    classifyStatementCredits(card, input);
    expect(input[0].kind).toBe("refund");
  });

  it("credit lines are excluded from categories and reported as statement credits", () => {
    const [credit] = classifyStatementCredits(card, [tx("FAKE TRAVEL CREDIT", -100)]);
    const c = categorize(credit, seededRules());
    expect([c.category, c.source]).toEqual([null, "excluded"]);
    const s = summarizeStatement([c]);
    expect([s.statement_credits, s.refunds, s.spend_by_category.travel]).toEqual([100, 0, 0]);
  });
});
