/*
 * The ONE network exception in src/ (see CLAUDE.md and tests/rules):
 * the browser loads the HiGHS solver binary from our own origin as a static
 * asset. No statement data is involved. Any other URL is refused before a
 * request is made, and the Content-Security-Policy (connect-src 'self') in
 * next.config.ts blocks other origins in the browser as a second layer.
 */

/** Where scripts/copy-solver-wasm.mjs puts the binary (public/solver/highs.wasm). */
export const SOLVER_WASM_PATH = "/solver/highs.wasm";

/**
 * The absolute URL of the solver binary on `origin`. Throws unless `requested`
 * resolves to exactly SOLVER_WASM_PATH on that same origin.
 */
export function solverWasmUrl(requested: string, origin: string): string {
  const base = new URL(origin);
  const url = new URL(requested, base);
  if (url.origin !== base.origin || url.pathname !== SOLVER_WASM_PATH || url.search || url.hash) {
    throw new Error(`Refusing to load solver from ${url.href}: only ${SOLVER_WASM_PATH} on ${base.origin} is allowed`);
  }
  return url.href;
}

/** Fetch the solver binary from our own origin. The only fetch in src/. */
export async function fetchSolverWasm(
  origin: string,
  requested: string = SOLVER_WASM_PATH,
  fetchImpl: typeof fetch = fetch,
): Promise<ArrayBuffer> {
  const url = solverWasmUrl(requested, origin);
  const res = await fetchImpl(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Solver binary failed to load (${res.status})`);
  return res.arrayBuffer();
}
