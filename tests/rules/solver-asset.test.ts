// The one network exception: the solver binary, from our own origin only.
import { describe, expect, it, vi } from "vitest";
import { fetchSolverWasm, SOLVER_WASM_PATH, solverWasmUrl } from "../../src/app/lib/solver-asset";

const ORIGIN = "https://cardopt.example";

describe("solverWasmUrl", () => {
  it("allows exactly the solver binary on our own origin", () => {
    expect(solverWasmUrl(SOLVER_WASM_PATH, ORIGIN)).toBe(`${ORIGIN}/solver/highs.wasm`);
    expect(solverWasmUrl(`${ORIGIN}/solver/highs.wasm`, ORIGIN)).toBe(`${ORIGIN}/solver/highs.wasm`);
  });

  it.each([
    "https://evil.example/solver/highs.wasm",
    "//evil.example/solver/highs.wasm",
    "http://cardopt.example/solver/highs.wasm",
    "https://cardopt.example:8443/solver/highs.wasm",
    "/solver/other.wasm",
    "/solver/../api/upload",
    "/solver/highs.wasm?statement=1",
    "/solver/highs.wasm#x",
    "/api/statements",
    "data:application/wasm;base64,AA==",
  ])("refuses %s", (url) => {
    expect(() => solverWasmUrl(url, ORIGIN)).toThrow("Refusing to load solver");
  });
});

describe("fetchSolverWasm", () => {
  it("fetches only the same-origin binary, once", async () => {
    const bytes = new ArrayBuffer(4);
    const fetchImpl = vi.fn(async () => new Response(bytes, { status: 200 }));
    await expect(fetchSolverWasm(ORIGIN, SOLVER_WASM_PATH, fetchImpl as unknown as typeof fetch)).resolves.toBeInstanceOf(ArrayBuffer);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(`${ORIGIN}/solver/highs.wasm`, { credentials: "same-origin" });
  });

  it("a fetch to any other URL fails before any request is made", async () => {
    const fetchImpl = vi.fn();
    for (const url of ["https://evil.example/solver/highs.wasm", "/api/statements", "//evil.example/x"]) {
      await expect(fetchSolverWasm(ORIGIN, url, fetchImpl as unknown as typeof fetch)).rejects.toThrow("Refusing to load solver");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a failed load", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));
    await expect(fetchSolverWasm(ORIGIN, SOLVER_WASM_PATH, fetchImpl as unknown as typeof fetch)).rejects.toThrow("(404)");
  });
});
