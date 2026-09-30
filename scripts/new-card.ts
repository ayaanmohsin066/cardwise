// npm run new-card -- <issuer> <card-id>
// Creates src/data/cards/<issuer>/<card-id>.json with every key present and null.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cardSkeleton, isSlug, validateIssuers } from "@/engine";

const [issuer, id] = process.argv.slice(2);
const fail = (msg: string) => {
  console.error(`new-card: ${msg}`);
  console.error("usage: npm run new-card -- <issuer> <card-id>");
  process.exit(1);
};
if (!issuer || !id) fail("missing arguments");
if (!isSlug(id)) fail(`card id "${id}" must be a lowercase slug, e.g. td-cash-back-visa`);

const issuers = validateIssuers(JSON.parse(readFileSync(join("src", "data", "issuers.json"), "utf8")));
if (!issuers.ok) fail("src/data/issuers.json is invalid");
else if (!issuers.issuers.some((i) => i.id === issuer)) {
  fail(`unknown issuer "${issuer}". Known: ${issuers.issuers.map((i) => i.id).join(", ")}`);
}

const dir = join("src", "data", "cards", issuer);
const file = join(dir, `${id}.json`);
if (existsSync(file)) fail(`${file} already exists; not overwriting`);
mkdirSync(dir, { recursive: true });
writeFileSync(file, JSON.stringify(cardSkeleton(issuer, id), null, 2) + "\n");

console.log(`Created ${file}

Next steps (see CLAUDE.md, "Never invent card terms"):
  1. Open the issuer's official page for this card. Set "source_url" to it and "name" to the card's name.
  2. Fill in only terms you can read on that page. Leave anything you can't verify as null.
     - Rates are points per $1; cashback cards use program_id "cash-cad" (2% = rate 2).
     - Caps go in "caps" and rules point to them with "cap_id" ("none" = verified uncapped).
     - Lists: null = not verified, [] = verified to have none.
  3. Set "last_verified" to today's date (YYYY-MM-DD).
  4. Run: npm test && npm run card-status`);
