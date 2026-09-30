import { createHighsSolver, type HighsLike, type LpSolver } from "@/engine";
import { fetchSolverWasm } from "./solver-asset";

/*
 * Loads HiGHS in the browser. The binary comes from our own origin
 * (solver-asset.ts) and is compiled here, then handed to HiGHS through its
 * instantiateWasm hook so HiGHS never fetches anything itself. Loaded once,
 * on first use. Works in the page and in the Web Worker (globalThis.location).
 */
let cached: Promise<LpSolver> | null = null;

export function loadSolver(): Promise<LpSolver> {
  cached ??= (async () => {
    const [{ default: loadHighs }, bytes] = await Promise.all([
      import("highs"),
      fetchSolverWasm(globalThis.location.origin),
    ]);
    const highs = await loadHighs({
      instantiateWasm: (
        imports: WebAssembly.Imports,
        done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
      ) => {
        WebAssembly.instantiate(bytes, imports).then((r) => done(r.instance, r.module));
        return {};
      },
    } as Parameters<typeof loadHighs>[0]);
    return createHighsSolver(highs as unknown as HighsLike);
  })();
  cached.catch(() => {
    cached = null; // allow a retry after a failed load
  });
  return cached;
}
