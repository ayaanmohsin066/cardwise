import type { DataStatus } from "@/engine";

/** Today in local time, YYYY-MM-DD. Override with STATUS_TODAY for reproducible output. */
export function today(): string {
  if (process.env.STATUS_TODAY) return process.env.STATUS_TODAY;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function printStatus(kind: string, rows: readonly DataStatus[], staleDays: number): void {
  if (rows.length === 0) {
    console.log(`No ${kind} yet.`);
    return;
  }
  const table = rows.map((r) => ({
    file: r.file,
    valid: r.valid ? "yes" : `NO (${r.errors.length} error${r.errors.length === 1 ? "" : "s"})`,
    "null fields": r.nulls,
    last_verified: r.last_verified ?? "—",
    "age (days)": r.age_days ?? "—",
    status: !r.valid ? "INVALID" : r.stale ? `STALE (> ${staleDays} days)` : "ok",
  }));
  console.table(table);
  for (const r of rows.filter((x) => !x.valid)) {
    console.log(`\n${r.file}:\n  ${r.errors.join("\n  ")}`);
  }
  const stale = rows.filter((r) => r.stale).length;
  const invalid = rows.filter((r) => !r.valid).length;
  console.log(`\n${rows.length} ${kind}: ${invalid} invalid, ${stale} stale (last_verified older than ${staleDays} days).`);
}
