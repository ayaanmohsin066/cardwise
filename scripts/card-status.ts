// npm run card-status
// Lists every card with its null-field count and last_verified age. Exits 1 if
// any card is stale (older than STALE_DAYS) or invalid, so CI flags it.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cardStatus, STALE_DAYS, statusExitCode, type DataStatus } from "@/engine";
import { printStatus, today } from "./status-table";

const root = join("src", "data", "cards");
const rows: DataStatus[] = [];
if (existsSync(root)) {
  for (const issuer of readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory()).sort()) {
    for (const f of readdirSync(join(root, issuer)).filter((f) => f.endsWith(".json")).sort()) {
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(join(root, issuer, f), "utf8"));
      } catch {
        raw = "unparseable JSON";
      }
      rows.push(cardStatus(`${issuer}/${f}`, raw, today()));
    }
  }
}
printStatus("cards", rows, STALE_DAYS);
process.exit(statusExitCode(rows));
