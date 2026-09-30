// npm run program-status
// Lists every points program with its null-field count and last_verified age.
// Exits 1 if any program is stale or invalid. Built-in units (no source) are never stale.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { programStatus, STALE_DAYS, statusExitCode, type DataStatus } from "@/engine";
import { printStatus, today } from "./status-table";

const root = join("src", "data", "programs");
const rows: DataStatus[] = [];
if (existsSync(root)) {
  for (const f of readdirSync(root).filter((f) => f.endsWith(".json")).sort()) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(root, f), "utf8"));
    } catch {
      raw = "unparseable JSON";
    }
    rows.push(programStatus(f, raw, today()));
  }
}
printStatus("programs", rows, STALE_DAYS);
process.exit(statusExitCode(rows));
