import { describe, expect, it } from "vitest";
import { createHighsSolver, toLpText, type LpProblem } from "@/engine";
import { getSolver } from "../helpers/solver";

const toy: LpProblem = {
  objective: new Map([["chairs", 30], ["tables", 50]]),
  constraints: [
    { terms: new Map([["chairs", 1], ["tables", 2]]), upper: 40 },
    { terms: new Map([["chairs", 2], ["tables", 1]]), upper: 50 },
  ],
  variables: ["chairs", "tables"],
};

describe("toLpText", () => {
  it("writes CPLEX LP with safe variable names", () => {
    const { text, names } = toLpText({
      objective: new Map([["a|b", 1.5], ["c", -2]]),
      constraints: [
        { terms: new Map([["a|b", 1]]), lower: 1, upper: 1 },
        { terms: new Map([["c", 1]]), lower: 0.25 },
        { terms: new Map([["a|b", 1], ["c", 1]]), upper: 10 },
      ],
      variables: ["a|b", "c"],
    });
    expect(names).toEqual(new Map([["a|b", "x0"], ["c", "x1"]]));
    expect(text).toBe(
      "Maximize\n obj: 1.5 x0 - 2 x1\nSubject To\n c0: 1 <= 1 x0 <= 1\n c1: 1 x1 >= 0.25\n c2: 1 x0 + 1 x1 <= 10\nBounds\n x0 >= 0\n x1 >= 0\nEnd",
    );
  });

  it("rejects undeclared variables and non-finite coefficients", () => {
    expect(() => toLpText({ objective: new Map([["z", 1]]), constraints: [], variables: [] })).toThrow("not declared");
    expect(() => toLpText({ objective: new Map([["z", Infinity]]), constraints: [], variables: ["z"] })).toThrow("finite");
  });
});

describe("createHighsSolver", () => {
  it("solves the toy LP", async () => {
    const solve = await getSolver();
    const r = solve(toy);
    expect(r.status).toBe("optimal");
    if (r.status !== "optimal") return;
    expect(r.objective).toBeCloseTo(1100, 6);
    expect(r.values.get("chairs")).toBeCloseTo(20, 6);
    expect(r.values.get("tables")).toBeCloseTo(10, 6);
  });

  it("reports infeasible problems", async () => {
    const solve = await getSolver();
    const r = solve({ objective: new Map([["x", 1]]), constraints: [{ terms: new Map([["x", 1]]), upper: -1 }], variables: ["x"] });
    expect(r.status).toBe("infeasible");
  });

  it("handles an empty problem and solver errors", () => {
    const throwing = createHighsSolver({ solve: () => { throw new Error("boom"); } });
    expect(throwing({ objective: new Map(), constraints: [], variables: [] })).toEqual({ status: "optimal", objective: 0, values: new Map() });
    expect(throwing(toy)).toMatchObject({ status: "error" });
    const odd = createHighsSolver({ solve: () => ({ Status: "Time limit reached", ObjectiveValue: 0, Columns: {} }) });
    expect(odd(toy)).toEqual({ status: "error", message: "Solver status: Time limit reached" });
  });
});
