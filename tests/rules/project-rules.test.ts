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

  it("nothing in src makes network requests (statements never leave the browser)", () => {
    const network = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket|new\s+EventSource/;
    const offenders = sourceFiles("src").filter((p) => network.test(readFileSync(p, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
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
