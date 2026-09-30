// Copies the HiGHS WebAssembly binary into public/ so the browser loads it
// from our own origin (/solver/highs.wasm). Runs before dev and build.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const src = require.resolve("highs/runtime");
const dest = join(process.cwd(), "public", "solver", "highs.wasm");
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`copied ${src} -> ${dest}`);
