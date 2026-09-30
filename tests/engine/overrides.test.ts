import { describe, expect, it } from "vitest";
import { overrideKey, parseOverrides, removeOverride, serializeOverrides, setOverride } from "@/engine";

describe("overrideKey", () => {
  it("ignores case, punctuation and tokens with digits", () => {
    expect(overrideKey("LOBLAWS #1234 TORONTO ON")).toBe("loblaws toronto on");
    expect(overrideKey("Loblaws #0567 Toronto, ON")).toBe("loblaws toronto on");
    expect(overrideKey("SHELL C12345")).toBe("shell");
  });

  it("falls back to the full normalized text when only digits remain", () => {
    expect(overrideKey("#12345")).toBe("12345");
  });
});

describe("setOverride / removeOverride", () => {
  it("adds and removes without mutating", () => {
    const empty = {};
    const one = setOverride(empty, "LOBLAWS #1", "dining");
    expect(empty).toEqual({});
    expect(one).toEqual({ loblaws: "dining" });
    expect(setOverride(one, "loblaws #2", "gas")).toEqual({ loblaws: "gas" });
    expect(removeOverride(one, "LOBLAWS #9")).toEqual({});
    expect(removeOverride(one, "SOBEYS")).toBe(one);
  });
});

describe("parseOverrides / serializeOverrides", () => {
  it("round-trips", () => {
    const o = setOverride({}, "NETFLIX", "streaming");
    expect(parseOverrides(serializeOverrides(o))).toEqual(o);
  });

  it("never throws on bad stored data", () => {
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides("")).toEqual({});
    expect(parseOverrides("{not json")).toEqual({});
    expect(parseOverrides("[1,2]")).toEqual({});
    expect(parseOverrides("null")).toEqual({});
    expect(parseOverrides('{"a":"groceries","b":"us_supermarkets","":"gas","c":3}')).toEqual({
      a: "groceries",
    });
  });
});
