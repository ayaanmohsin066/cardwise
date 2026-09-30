// HiGHS in Node for tests. It reads highs.wasm from node_modules via the
// file system; no network. The browser loads it through src/app/lib/solver.ts.
import loadHighs from "highs";
import { createHighsSolver, type LpSolver } from "@/engine";

let cached: Promise<LpSolver> | null = null;

export function getSolver(): Promise<LpSolver> {
  cached ??= loadHighs().then((h) => createHighsSolver(h as unknown as Parameters<typeof createHighsSolver>[0]));
  return cached;
}
