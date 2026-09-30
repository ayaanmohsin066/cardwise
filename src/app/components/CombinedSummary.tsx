"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CASH_PROGRAM_ID, CATEGORIES } from "@/engine";
import { CATEGORY_LABELS, formatCad, formatPoints, seriesColor } from "../lib/format";
import type { CardReport } from "./Importer";
import { StatTile } from "./StatTile";

/**
 * Totals across the selected cards. Dollars add up across cards; points from
 * different programs don't, so points are listed per card, never summed.
 */
export function CombinedSummary({ reports }: { reports: CardReport[] }) {
  const valued = reports.filter((r) => r.report.rewards_value !== null);
  const notValued = reports.filter((r) => r.report.rewards_value === null);
  const net = reports.reduce((s, r) => s + r.report.net_value, 0);
  const rewards = valued.reduce((s, r) => s + (r.report.rewards_value ?? 0), 0);
  const credits = reports.reduce((s, r) => s + r.report.credits_total, 0);
  const fees = reports.reduce((s, r) => s + (r.report.fees.annual_fee_prorated ?? 0) + (r.report.fx.amount ?? 0), 0);
  const unverified = reports.reduce((s, r) => s + r.report.unverified.reduce((a, u) => a + u.count, 0), 0);
  const anyExcluded = reports.some((r) => r.report.net_value_excludes.length > 0);

  const rows = CATEGORIES.map((c) => {
    const row: Record<string, number | string> = { name: CATEGORY_LABELS[c] };
    let total = 0;
    for (const r of valued) {
      const v = r.report.categories.find((x) => x.category === c)?.value ?? 0;
      row[r.option.id] = v;
      total += v;
    }
    return { row, total };
  })
    .filter((x) => valued.some((r) => (x.row[r.option.id] as number) !== 0))
    .sort((a, b) => b.total - a.total)
    .map((x): Record<string, number | string> => ({ ...x.row, total: x.total }));
  const height = Math.max(120, rows.length * 36 + 40);

  return (
    <section className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-5" aria-label="All selected cards">
      <header>
        <h2 className="text-lg font-semibold">All selected cards</h2>
        <p className="text-sm text-muted">Combined for the periods each card&apos;s statements cover.</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile hero label="Combined net value" value={formatCad(net)} sub={anyExcluded ? "Leaves out unverified parts; see each card" : undefined} />
        <StatTile label="Rewards value" value={formatCad(rewards)} sub={notValued.length ? `${notValued.length} card${notValued.length === 1 ? "" : "s"} not valued (unverified)` : undefined} />
        <StatTile label="Credits used" value={formatCad(credits)} />
        <StatTile label="Annual fee share + FX fees" value={formatCad(fees)} />
      </div>
      {unverified > 0 && (
        <p className="text-sm text-muted">
          {unverified} item{unverified === 1 ? " is" : "s are"} not yet verified across these cards and left out of the totals.
        </p>
      )}

      <ul className="flex flex-col gap-1 text-sm">
        {reports.map((r) => (
          <li key={r.option.id} className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: seriesColor(r.slot) }} />
            <span>{r.option.name}</span>
            <span className="text-muted">
              {r.option.card.program_id === CASH_PROGRAM_ID ? "" : `${formatPoints(r.report.points_total)} ${r.program?.name ?? "points"} · `}
              {r.report.rewards_value === null ? "value not yet verified" : formatCad(r.report.rewards_value)}
            </span>
          </li>
        ))}
      </ul>

      {valued.length > 0 && rows.length > 0 && (
        <div className="flex flex-col gap-3">
          <h4 className="text-sm font-semibold">Rewards value by category and card</h4>
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }} barCategoryGap={8}>
                <CartesianGrid horizontal={false} stroke="var(--chart-grid)" strokeWidth={1} />
                <XAxis
                  type="number"
                  tickFormatter={(v: number) => formatCad(v)}
                  stroke="var(--chart-axis)"
                  tick={{ fill: "var(--chart-ink-muted)", fontSize: 12 }}
                  tickLine={false}
                />
                <YAxis type="category" dataKey="name" width={120} stroke="var(--chart-axis)" tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} />
                <Tooltip
                  cursor={{ fill: "var(--chart-grid)", opacity: 0.5 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
                        <div className="mb-1 text-muted">{String(label)}</div>
                        {valued.map((r) => {
                          const v = payload[0].payload[r.option.id] as number;
                          return (
                            <div key={r.option.id} className="flex items-center gap-2">
                              <span aria-hidden className="inline-block h-0.5 w-3" style={{ background: seriesColor(r.slot) }} />
                              <span className="font-semibold">{formatCad(v)}</span>
                              <span className="text-muted">{r.option.name}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  }}
                />
                {valued.map((r, i) => (
                  <Bar
                    key={r.option.id}
                    dataKey={r.option.id}
                    name={r.option.name}
                    stackId="cards"
                    fill={seriesColor(r.slot)}
                    stroke="var(--surface)"
                    strokeWidth={2}
                    maxBarSize={24}
                    radius={i === valued.length - 1 ? [0, 4, 4, 0] : 0}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Show as table</summary>
            <table className="mt-2 w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1 font-medium">Category</th>
                  {valued.map((r) => (
                    <th key={r.option.id} className="py-1 text-right font-medium">{r.option.name}</th>
                  ))}
                  <th className="py-1 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {rows.map((row) => (
                  <tr key={String(row.name)} className="border-t border-border">
                    <td className="py-1">{String(row.name)}</td>
                    {valued.map((r) => (
                      <td key={r.option.id} className="py-1 text-right">{formatCad(row[r.option.id] as number)}</td>
                    ))}
                    <td className="py-1 text-right">{formatCad(row.total as number)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </section>
  );
}
