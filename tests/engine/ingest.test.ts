import { describe, expect, it } from "vitest";
import {
  classifyKind,
  columnLabel,
  detectForeign,
  ingestCsv,
  normalizeRows,
  parseAmount,
  parseCsv,
  parseDate,
  signedAmount,
  suggestMapping,
  transactionId,
  validateTransaction,
  type ColumnMapping,
  type CsvFormat,
} from "@/engine";
import { ingestStatement, STATEMENTS } from "../helpers/statements";

const none = { amount: null, debit: null, credit: null, currency: null, foreign_amount: null, exchange_rate: null };
const mapping = (over: Partial<ColumnMapping> = {}): ColumnMapping => ({
  ...none,
  date: "Date",
  description: "Description",
  amount: "Amount",
  ...over,
});
const format = (over: Partial<CsvFormat> = {}): CsvFormat => ({
  has_header: true,
  date_format: "YYYY-MM-DD",
  decimal_separator: ".",
  purchase_sign: "positive",
  ...over,
});

describe("parseCsv", () => {
  it("uses the header row for column names and trims cells", () => {
    const r = parseCsv("Date,Description,Amount\n2026-01-01, COFFEE ,4.00\n", true);
    expect(r.columns).toEqual(["Date", "Description", "Amount"]);
    expect(r.rows).toEqual([{ Date: "2026-01-01", Description: "COFFEE", Amount: "4.00" }]);
    expect(r.errors).toEqual([]);
  });

  it("names columns 'Column N' without a header, padding short rows", () => {
    const r = parseCsv("a,b,c\nd,e\n", false);
    expect(r.columns).toEqual(["Column 1", "Column 2", "Column 3"]);
    expect(r.rows[1]).toEqual({ "Column 1": "d", "Column 2": "e", "Column 3": "" });
    expect(columnLabel(0)).toBe("Column 1");
  });

  it("handles quoted commas, a BOM, blank lines and semicolons", () => {
    expect(parseCsv('﻿A,B\n"x, y",1\n\n', true).rows).toEqual([{ A: "x, y", B: "1" }]);
    expect(parseCsv("A;B\n1,5;x\n", true).rows).toEqual([{ A: "1,5", B: "x" }]);
  });

  it("returns nothing for empty input", () => {
    expect(parseCsv("", true)).toEqual({ columns: [], rows: [], errors: [] });
  });

  it("reports malformed CSV with a line number", () => {
    const r = parseCsv('A,B\n"unclosed,1\n', true);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("parseAmount", () => {
  it.each([
    ["12.34", ".", 12.34],
    ["$1,234.56", ".", 1234.56],
    ["-12.00", ".", -12],
    ["12.00-", ".", -12],
    ["(12.00)", ".", -12],
    ["12.00 CR", ".", -12],
    ["+5", ".", 5],
    [".50", ".", 0.5],
    ["1 234,56", ",", 1234.56],
    ["1.234,56", ",", 1234.56],
    ["-45,67", ",", -45.67],
    ["12.50 CAD", ".", 12.5],
  ] as const)("%s (decimal %s) -> %s", (cell, dec, expected) => {
    expect(parseAmount(cell, dec)).toBe(expected);
  });

  it("returns null for empty or unreadable cells", () => {
    expect(parseAmount("", ".")).toBeNull();
    expect(parseAmount("abc", ".")).toBeNull();
    expect(parseAmount("1.2.3", ".")).toBeNull();
  });
});

describe("parseDate", () => {
  it("parses each supported format to ISO", () => {
    expect(parseDate("2026-03-05", "YYYY-MM-DD")).toBe("2026-03-05");
    expect(parseDate("2026/3/5", "YYYY-MM-DD")).toBe("2026-03-05");
    expect(parseDate("03/05/2026", "MM/DD/YYYY")).toBe("2026-03-05");
    expect(parseDate("05/03/2026", "DD/MM/YYYY")).toBe("2026-03-05");
    expect(parseDate("5-3-2026", "DD/MM/YYYY")).toBe("2026-03-05");
  });

  it("rejects impossible dates and the wrong format", () => {
    expect(parseDate("02/30/2026", "MM/DD/YYYY")).toBeNull();
    expect(parseDate("13/45/2026", "MM/DD/YYYY")).toBeNull();
    expect(parseDate("2026-03-05", "DD/MM/YYYY")).toBeNull();
    expect(parseDate("", "YYYY-MM-DD")).toBeNull();
  });
});

describe("classifyKind", () => {
  it("classifies charges", () => {
    expect(classifyKind("LOBLAWS #1234", 50)).toBe("purchase");
    expect(classifyKind("ANNUAL FEE", 120)).toBe("fee");
    expect(classifyKind("FOREIGN TRANSACTION FEE", 4.75)).toBe("fee");
    expect(classifyKind("FRAIS ANNUELS", 120)).toBe("fee");
    expect(classifyKind("PURCHASE INTEREST", 12.34)).toBe("interest");
    expect(classifyKind("INTÉRÊTS", 8.9)).toBe("interest");
    expect(classifyKind("RETURNED PAYMENT", 300)).toBe("payment");
    expect(classifyKind("RETURNED PAYMENT FEE", 45)).toBe("fee");
  });

  it("treats a bill paid with the card as a purchase", () => {
    expect(classifyKind("HYDRO ONE PAYMENT", 80)).toBe("purchase");
  });

  it("classifies credits", () => {
    expect(classifyKind("PAYMENT - THANK YOU", -500)).toBe("payment");
    expect(classifyKind("PAIEMENT MERCI", -500)).toBe("payment");
    expect(classifyKind("CASH BACK REDEMPTION", -25)).toBe("payment");
    expect(classifyKind("ANNUAL FEE REVERSAL", -120)).toBe("fee");
    expect(classifyKind("INTEREST ADJUSTMENT", -3)).toBe("interest");
    expect(classifyKind("LOBLAWS #1234", -30)).toBe("refund");
  });

  it("does not treat words containing 'fee' as fees", () => {
    expect(classifyKind("COFFEE TIME", 3)).toBe("purchase");
    expect(classifyKind("CITY PARKING FEES", 10)).toBe("purchase");
  });
});

describe("detectForeign", () => {
  it("trusts a currency column (high confidence)", () => {
    const m = mapping({ currency: "Cur" });
    expect(detectForeign({ Cur: "USD" }, m, "X")).toEqual({ is_foreign: true, confidence: "high" });
    expect(detectForeign({ Cur: "cad" }, m, "X USD")).toEqual({ is_foreign: false, confidence: "high" });
    expect(detectForeign({ Cur: "" }, m, "X")).toEqual({ is_foreign: false, confidence: "high" });
  });

  it("trusts foreign-amount and exchange-rate columns (high confidence)", () => {
    const m = mapping({ foreign_amount: "FA", exchange_rate: "FX" });
    expect(detectForeign({ FA: "25.00", FX: "" }, m, "X")).toEqual({ is_foreign: true, confidence: "high" });
    expect(detectForeign({ FA: "", FX: "1.3654" }, m, "X")).toEqual({ is_foreign: true, confidence: "high" });
    expect(detectForeign({ FA: "", FX: "" }, m, "X")).toEqual({ is_foreign: false, confidence: "high" });
  });

  it("falls back to currency codes in the description (low confidence)", () => {
    const m = mapping();
    expect(detectForeign({}, m, "HOTEL LISBOA EUR 120.00")).toEqual({ is_foreign: true, confidence: "low" });
    expect(detectForeign({}, m, "LOBLAWS")).toEqual({ is_foreign: false, confidence: "low" });
    expect(detectForeign({}, m, "BUSD STORE")).toEqual({ is_foreign: false, confidence: "low" });
  });
});

describe("signedAmount", () => {
  it("uses one amount column, flipping when purchases are negative", () => {
    expect(signedAmount({ Amount: "10" }, mapping(), format())).toBe(10);
    expect(signedAmount({ Amount: "-10" }, mapping(), format({ purchase_sign: "negative" }))).toBe(10);
    expect(signedAmount({ Amount: "" }, mapping(), format())).toBeNull();
  });

  it("uses debit minus credit, ignoring the sign they are written with", () => {
    const m = mapping({ amount: null, debit: "Dr", credit: "Cr" });
    expect(signedAmount({ Dr: "10", Cr: "" }, m, format())).toBe(10);
    expect(signedAmount({ Dr: "", Cr: "10" }, m, format())).toBe(-10);
    expect(signedAmount({ Dr: "", Cr: "-10" }, m, format())).toBe(-10);
    expect(signedAmount({ Dr: "", Cr: "" }, m, format())).toBeNull();
  });
});

describe("transactionId", () => {
  it("is stable and differs by line", () => {
    const a = transactionId(1, "2026-01-01", "X", 1);
    expect(a).toBe(transactionId(1, "2026-01-01", "X", 1));
    expect(a).toMatch(/^tx-1-[0-9a-f]{8}$/);
    expect(transactionId(2, "2026-01-01", "X", 1)).not.toBe(a);
  });
});

describe("normalizeRows", () => {
  it("keeps statement order, rounds to cents and reports bad rows", () => {
    const rows = [
      { Date: "2026-01-02", Description: "B", Amount: "1.005" },
      { Date: "nope", Description: "C", Amount: "1" },
      { Date: "2026-01-01", Description: "A", Amount: "" },
    ];
    const r = normalizeRows(rows, mapping(), format());
    expect(r.transactions.map((t) => [t.statement_line, t.amount_cad])).toEqual([[1, 1.01]]);
    expect(r.errors).toEqual([
      { statement_line: 2, message: 'Unreadable date "nope"' },
      { statement_line: 3, message: "Unreadable or missing amount" },
    ]);
  });
});

describe("suggestMapping", () => {
  it("pre-fills only exact Date/Description/Amount headers", () => {
    expect(suggestMapping(["DATE", "Description", " amount "])).toEqual({
      date: "DATE",
      description: "Description",
      amount: " amount ",
    });
    expect(suggestMapping(["Transaction Date", "Details", "Debit"])).toEqual({});
  });
});

describe("ingestCsv on fixture statements", () => {
  it("produces valid Transactions for every fixture", () => {
    for (const name of Object.keys(STATEMENTS) as (keyof typeof STATEMENTS)[]) {
      for (const t of ingestStatement(name).transactions) {
        const v = validateTransaction(t);
        if (!v.ok) throw new Error(`${name}: ${v.errors.join(", ")}`);
      }
    }
  });

  it("amount-currency.csv: kinds, signs and currency-column FX", () => {
    const { transactions, errors, parse_errors } = ingestStatement("amount-currency.csv");
    expect(errors).toEqual([]);
    expect(parse_errors).toEqual([]);
    expect(transactions).toHaveLength(17);
    const by = (d: string) => transactions.filter((t) => t.description === d);
    expect(by("LOBLAWS #1234 TORONTO ON").map((t) => [t.kind, t.amount_cad])).toEqual([
      ["purchase", 100],
      ["refund", -30],
    ]);
    expect(by("PAYMENT - THANK YOU")[0].kind).toBe("payment");
    expect(by("ANNUAL FEE")[0].kind).toBe("fee");
    expect(by("PURCHASE INTEREST")[0].kind).toBe("interest");
    expect(by("BEST BAKERY, INC")[0].amount_cad).toBe(9);
    const foreign = transactions.filter((t) => t.is_foreign);
    expect(foreign.map((t) => t.description)).toEqual(["UNITED AIRLINES 0162345678"]);
    expect(transactions.every((t) => t.is_foreign_confidence === "high")).toBe(true);
  });

  it("debit-credit.csv: credits, reward redemption, heuristic FX, bad rows", () => {
    const { transactions, errors } = ingestStatement("debit-credit.csv");
    expect(errors.map((e) => e.statement_line)).toEqual([9, 10]);
    expect(transactions.map((t) => [t.date, t.kind, t.amount_cad])).toEqual([
      ["2026-03-01", "purchase", 3.3],
      ["2026-03-02", "purchase", 22.1],
      ["2026-03-03", "refund", -22.1],
      ["2026-03-04", "purchase", 190],
      ["2026-03-05", "payment", -300],
      ["2026-03-06", "purchase", 1234.56],
      ["2026-03-07", "payment", -25],
      ["2026-03-08", "fee", 4.75],
    ]);
    const hotel = transactions[3];
    expect([hotel.is_foreign, hotel.is_foreign_confidence]).toEqual([true, "low"]);
    expect(transactions.every((t) => t.is_foreign_confidence === "low")).toBe(true);
  });

  it("fr-headerless.csv: no header, DD/MM, comma decimals, negative purchases", () => {
    const { transactions, errors } = ingestStatement("fr-headerless.csv");
    expect(errors).toEqual([]);
    expect(transactions.map((t) => [t.date, t.kind, t.amount_cad])).toEqual([
      ["2026-03-05", "purchase", 45.67],
      ["2026-03-06", "purchase", 12],
      ["2026-03-07", "refund", -12],
      ["2026-03-08", "purchase", 3.75],
      ["2026-03-09", "payment", -500],
      ["2026-03-10", "interest", 8.9],
      ["2026-03-11", "fee", 120],
      ["2026-03-12", "purchase", 1234.56],
    ]);
    expect(transactions[7].is_foreign).toBe(true);
    expect(transactions[0].raw).toEqual({
      "Column 1": "05/03/2026",
      "Column 2": "ÉPICERIE METRO #123 MONTRÉAL",
      "Column 3": "-45,67",
    });
  });

  it("ingestCsv reports parse errors separately", () => {
    const r = ingestCsv('Date,Description,Amount\n"2026-01-01,X,1\n', mapping(), format());
    expect(r.parse_errors.length).toBeGreaterThan(0);
  });
});
