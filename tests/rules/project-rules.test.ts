// Enforces the hard rules in CLAUDE.md that can be checked statically.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const rel = (p: string) => relative(ROOT, p);
const sourceFiles = (dir: string) =>
  walk(join(ROOT, dir)).filter((p) => /\.(ts|tsx|js|jsx|mjs)$/.test(p));

describe("project rules", () => {
  it("src/engine never imports React or Next", () => {
    const offenders = sourceFiles("src/engine").filter((p) =>
      /from\s+["'](react|react-dom|next)(\/[^"']*)?["']|require\(\s*["'](react|next)/.test(
        readFileSync(p, "utf8"),
      ),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("src/app has no API routes or server actions (statements stay in the browser)", () => {
    const files = sourceFiles("src/app");
    const routes = files.filter((p) => /[\\/]route\.(ts|js)$/.test(p) || /[\\/]pages[\\/]api[\\/]/.test(p));
    const serverActions = files.filter((p) => /^\s*["']use server["']/m.test(readFileSync(p, "utf8")));
    expect(routes.map(rel)).toEqual([]);
    expect(serverActions.map(rel)).toEqual([]);
  });

  it("only valuePerDollar converts points to dollars", () => {
    // Reading cents_per_point is the conversion. Only value.ts may do it
    // (program-schema.ts defines the field).
    const allowed = new Set(["src/engine/value.ts", "src/engine/program-schema.ts"]);
    const offenders = sourceFiles("src")
      .filter((p) => !allowed.has(rel(p).split("\\").join("/")))
      .filter((p) => /cents_per_point/.test(readFileSync(p, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("nothing in src makes network requests except loading the solver binary", () => {
    // Any reference to fetch at all (not just calls), so aliases like `const f = fetch` are caught too.
    const network = /\bfetch\b|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts\s*\(/;
    const ALLOWED = "src/app/lib/solver-asset.ts";
    const offenders = sourceFiles("src")
      .filter((p) => network.test(readFileSync(p, "utf8")))
      .map(rel)
      .filter((p) => p.split("\\").join("/") !== ALLOWED);
    expect(offenders).toEqual([]);
    // The one exception: a single fetch, only of the same-origin solver binary via the URL guard.
    const src = readFileSync(join(ROOT, ALLOWED), "utf8");
    expect(src.match(/\bfetch\s*\(/g)?.length ?? 0).toBe(0);
    expect(src.match(/fetchImpl\(/g)).toHaveLength(1);
    expect(src).toMatch(/const url = solverWasmUrl\(requested, origin\);\s*const res = await fetchImpl\(url,/);
    expect(src).not.toMatch(/XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
  });

  it("the Earn more worker is covered: one same-origin module worker, no other channels", () => {
    const WORKER = "src/app/workers/recommend.worker.ts";
    const files = sourceFiles("src");
    // The worker is scanned by the network rule above like every other file.
    expect(files.map(rel).map((p) => p.split("\\").join("/"))).toContain(WORKER);
    // Exactly one worker, created from our own bundled module file.
    const creators = files.filter((p) => /new\s+Worker\s*\(/.test(readFileSync(p, "utf8")));
    expect(creators.map(rel).map((p) => p.split("\\").join("/"))).toEqual(["src/app/components/EarnMore.tsx"]);
    const earnMore = readFileSync(join(ROOT, "src/app/components/EarnMore.tsx"), "utf8");
    expect(earnMore.match(/new\s+Worker\s*\(/g)).toHaveLength(1);
    expect(earnMore).toContain('new Worker(new URL("../workers/recommend.worker.ts", import.meta.url), { type: "module" })');
    // No other ways to move data out of the page or worker.
    const channels = /SharedWorker|serviceWorker|BroadcastChannel|MessageChannel|\.postMessage\([^)]*,\s*["'`*]/;
    expect(files.filter((p) => channels.test(readFileSync(p, "utf8"))).map(rel)).toEqual([]);
    // The worker only imports the pure computation and the guarded solver loader.
    const worker = readFileSync(join(ROOT, WORKER), "utf8");
    const imports = [...worker.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(["../lib/run-recommendations", "../lib/solver"]);
    // ...and the loader only reaches the network through solver-asset's guard, on our own origin.
    const loader = readFileSync(join(ROOT, "src/app/lib/solver.ts"), "utf8");
    expect(loader).toMatch(/fetchSolverWasm\(globalThis\.location\.origin\)/);
    expect(loader).not.toMatch(/\bfetch\b|locateFile|importScripts/);
  });

  it("the engine never loads a solver or touches the network", () => {
    const offenders = sourceFiles("src/engine").filter((p) => /from\s+["']highs["']|import\(\s*["']highs["']\s*\)|\bfetch\b/.test(readFileSync(p, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("sends a Content-Security-Policy that limits connections to our own origin", async () => {
    const config = (await import("../../next.config")).default;
    const rules = await config.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    expect(all?.headers).toContainEqual({ key: "Content-Security-Policy", value: "connect-src 'self'" });
  });

  it("client components never import the server-only catalog loader", () => {
    const client = sourceFiles("src/app").filter((p) => /^\s*["']use client["']/m.test(readFileSync(p, "utf8")));
    const offenders = client.filter((p) => /lib\/catalog["']/.test(readFileSync(p, "utf8").replace(/import\s+type[^;]+;/g, "")));
    expect(offenders.map(rel)).toEqual([]);
    expect(readFileSync(join(ROOT, "src/app/lib/catalog.ts"), "utf8")).toMatch(/^import "server-only";/);
  });

  it("there is no middleware/proxy that could see requests", () => {
    const candidates = ["middleware.ts", "proxy.ts", "src/middleware.ts", "src/proxy.ts"];
    const present = candidates.filter((f) => {
      try {
        return statSync(join(ROOT, f)).isFile();
      } catch {
        return false;
      }
    });
    expect(present).toEqual([]);
  });
});
