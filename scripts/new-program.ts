// npm run new-program -- <program-id>
// Creates src/data/programs/<program-id>.json with every key present and null.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isSlug, programSkeleton } from "@/engine";

const [id] = process.argv.slice(2);
const fail = (msg: string) => {
  console.error(`new-program: ${msg}`);
  console.error("usage: npm run new-program -- <program-id>");
  process.exit(1);
};
if (!id) fail("missing program id");
if (!isSlug(id)) fail(`program id "${id}" must be a lowercase slug`);
const file = join("src", "data", "programs", `${id}.json`);
if (existsSync(file)) fail(`${file} already exists; not overwriting`);
writeFileSync(file, JSON.stringify(programSkeleton(id), null, 2) + "\n");

console.log(`Created ${file}

Next steps:
  1. Set "name", and "source_url" to the program's official redemption page.
  2. Add "redemptions": one entry per method. "cents_per_point" only if the page states it;
     otherwise null. If a value is an estimate, set "is_estimate": true and explain its basis in "notes".
  3. Set "last_verified" to today's date (YYYY-MM-DD).
  4. Run: npm test && npm run program-status`);
