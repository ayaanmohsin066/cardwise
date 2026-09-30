import { describe, expect, it } from "vitest";
import { addMonths, daysBetween, monthsCovered, periodBounds, periodKey } from "@/engine";

describe("periodKey", () => {
  it("gives calendar month, quarter and year keys", () => {
    expect(periodKey("2026-01-31", "month")).toBe("2026-01");
    expect(periodKey("2026-03-31", "quarter")).toBe("2026-Q1");
    expect(periodKey("2026-04-01", "quarter")).toBe("2026-Q2");
    expect(periodKey("2026-12-31", "quarter")).toBe("2026-Q4");
    expect(periodKey("2026-12-31", "year")).toBe("2026");
  });
});

describe("addMonths", () => {
  it("adds calendar months and clamps to month end", () => {
    expect(addMonths("2026-01-15", 3)).toBe("2026-04-15");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-03-10", 12)).toBe("2027-03-10");
  });
});

describe("daysBetween", () => {
  it("counts whole days", () => {
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
    expect(daysBetween("2026-03-01", "2026-02-01")).toBe(-28);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
  });
});

describe("monthsCovered", () => {
  it("rounds the day span to months, minimum 1", () => {
    expect(monthsCovered([])).toBe(0);
    expect(monthsCovered(["2026-01-03", "2026-01-25"])).toBe(1);
    expect(monthsCovered(["2026-01-15", "2026-02-14"])).toBe(1);
    expect(monthsCovered(["2026-01-01", "2026-03-31"])).toBe(3);
    expect(monthsCovered(["2026-01-01", "2026-12-31"])).toBe(12);
  });
});

describe("periodBounds", () => {
  it("gives the first and last day of the calendar period", () => {
    expect(periodBounds("2026-02-14", "month")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(periodBounds("2028-02-14", "month")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(periodBounds("2026-05-20", "quarter")).toEqual({ start: "2026-04-01", end: "2026-06-30" });
    expect(periodBounds("2026-12-31", "quarter")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(periodBounds("2026-07-01", "year")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });
});
