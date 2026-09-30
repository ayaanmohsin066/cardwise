"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CategoryBenefit } from "@/engine";
import { CATEGORY_LABELS, formatCad, formatPoints } from "../lib/format";

interface Props {
  rows: CategoryBenefit[];
  /** Dollar values are available (program and point value verified). */
  hasValue: boolean;
  color: string;
  /** Offer the points view. Off for cash-back cards, where points are just cents. */
  showPoints?: boolean;
}

type Mode = "value" | "points";

/**
 * Points or dollars by category: one series, one color, horizontal bars.
 * Two measures are never on one axis; a toggle switches between them.
 */
export function CategoryChart({ rows, hasValue, color, showPoints = true }: Props) {
  const [mode, setMode] = useState<Mode>(hasValue ? "value" : "points");
  const active: Mode = hasValue ? mode : "points";
  const fmt = active === "value" ? formatCad : formatPoints;
  const data = rows
    .map((r) => ({ name: CATEGORY_LABELS[r.category], amount: active === "value" ? (r.value ?? 0) : r.points, row: r }))
    .sort((a, b) => b.amount - a.amount);
  const height = Math.max(120, data.length * 36 + 40);

  if (data.length === 0) return <p className="text-sm text-muted">No spending to chart.</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">
          {active === "value" ? "Rewards value by category" : "Points by category"}
        </h4>
        {hasValue && showPoints && (
          <div role="radiogroup" aria-label="Show" className="flex rounded-md border border-border text-xs">
            {(["value", "points"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active === m}
                className={`px-3 py-1 ${active === m ? "bg-foreground text-background" : "text-muted"}`}
                onClick={() => setMode(m)}
              >
                {m === "value" ? "Dollars" : "Points"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 8 }} barCategoryGap={8}>
            <CartesianGrid horizontal={false} stroke="var(--chart-grid)" strokeWidth={1} />
            <XAxis
              type="number"
              tickFormatter={(v: number) => fmt(v)}
              stroke="var(--chart-axis)"
              tick={{ fill: "var(--chart-ink-muted)", fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={120}
              stroke="var(--chart-axis)"
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "var(--chart-grid)", opacity: 0.5 }}
              content={({ active: on, payload }) => {
                const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!on || !p) return null;
                return (
                  <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
                    <div className="text-sm font-semibold">{fmt(p.amount)}</div>
                    <div className="text-muted">{p.name}</div>
                    <div className="mt-1 text-muted">Net spend {formatCad(p.row.net_spend)}</div>
                    {p.row.unverified_count > 0 && (
                      <div className="text-muted">
                        {p.row.unverified_count} line{p.row.unverified_count === 1 ? "" : "s"} not verified
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <Bar dataKey="amount" fill={color} maxBarSize={24} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList
                dataKey="amount"
                position="right"
                formatter={(v: unknown) => fmt(Number(v))}
                style={{ fill: "var(--foreground)", fontSize: 12 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Show as table</summary>
        <table className="mt-2 w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1 font-medium">Category</th>
              <th className="py-1 text-right font-medium">Net spend</th>
              <th className="py-1 text-right font-medium">Points</th>
              <th className="py-1 text-right font-medium">Value</th>
              <th className="py-1 text-right font-medium">Not verified</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r) => (
              <tr key={r.category} className="border-t border-border">
                <td className="py-1">{CATEGORY_LABELS[r.category]}</td>
                <td className="py-1 text-right">{formatCad(r.net_spend)}</td>
                <td className="py-1 text-right">{formatPoints(r.points)}</td>
                <td className="py-1 text-right">{r.value === null ? "Not yet verified" : formatCad(r.value)}</td>
                <td className="py-1 text-right">{r.unverified_count ? `${r.unverified_count} (${formatCad(r.unverified_amount)})` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
