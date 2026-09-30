/*
 * Runs "Earn more" off the main thread. Receives statement data from the page
 * and replies only to the page (postMessage). Its only network request is the
 * solver binary from our own origin, through the same single-URL guard
 * (solver.ts -> solver-asset.ts); the CSP (connect-src 'self') also applies.
 */
import { runRecommendations, type RecommendRequest, type WorkerMessage } from "../lib/run-recommendations";
import { loadSolver } from "../lib/solver";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<RecommendRequest>) => void) | null;
  postMessage: (m: WorkerMessage) => void;
};

ctx.onmessage = async (e) => {
  const { id, ...req } = e.data;
  try {
    ctx.postMessage({ id, type: "progress", stage: "loading", done: 0, total: 1 });
    const solver = await loadSolver();
    const results = runRecommendations(req, solver, (stage, done, total) =>
      ctx.postMessage({ id, type: "progress", stage, done, total }),
    );
    ctx.postMessage({ id, type: "result", results });
  } catch (err) {
    ctx.postMessage({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
