"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { redemptionValues, type Program } from "@/engine";
import { formatCad, formatPoints } from "../lib/format";
import { parseTypedAmount } from "../lib/typed-amount";

const methodLabel = (m: string) => m.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

interface Props {
  program: Program | null;
  isCash: boolean;
  color: string;
}

/** "Your points are worth": the user's balance under each redemption method. */
export function RedeemPanel({ program, isCash, color }: Props) {
  const [input, setInput] = useState("");
  const balance = parseTypedAmount(input);
  const valid = balance !== null && balance >= 0;
  const report = valid ? redemptionValues(program, balance) : null;

  const valued = report?.kind === "points" ? report.options.filter((o) => o.value !== null) : [];
  const data = valued.map((o) => ({ name: `${methodLabel(o.method)}${o.is_estimate ? " (estimate)" : ""}`, value: o.value!, estimate: o.is_estimate }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">Your {isCash ? "cash back" : "points"} are worth</h3>
        <p className="text-sm text-muted">
          Enter the {isCash ? "cash back" : "points"} balance from your latest statement. It stays in this browser tab.
        </p>
      </div>
      <label className="flex w-56 flex-col gap-1 text-sm">
        {isCash ? "Cash back balance ($)" : "Points balance"}
        <input
          inputMode="decimal"
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </label>
      {input.trim() !== "" && !valid && <p className="text-sm text-danger">Enter a number, like 12500.</p>}

      {report?.kind === "unverified" && <p className="text-sm text-muted">{report.reason} Values: not yet verified.</p>}

      {report?.kind === "cash" && (
        <p className="text-sm">
          Your cash back balance is worth <strong>{formatCad(report.balance)}</strong>. Cash back has one value, so
          there&apos;s nothing to compare.
        </p>
      )}

      {report?.kind === "points" && (
        <>
          <div className="flex flex-col gap-1 text-sm">
            {report.best ? (
              <p>
                Best verified option: <strong>{methodLabel(report.best.method)}</strong>, worth{" "}
                <strong>{formatCad(report.best.value!)}</strong> for {formatPoints(report.balance)} points.
              </p>
            ) : (
              <p className="text-muted">No redemption option has a verified fixed value yet.</p>
            )}
            {report.gap !== null && report.lowest && report.gap > 0.005 && (
              <p>
                Redeeming via {methodLabel(report.best!.method).toLowerCase()} instead of{" "}
                {methodLabel(report.lowest.method).toLowerCase()} is worth <strong>{formatCad(report.gap)}</strong> more.
              </p>
            )}
            {report.higher_estimate && (
              <p className="text-muted">
                {methodLabel(report.higher_estimate.method)} could be worth about {formatCad(report.higher_estimate.value!)}, but
                that&apos;s an estimate
                {report.higher_estimate.basis
                  ? `: ${report.higher_estimate.basis}${/[.!?]$/.test(report.higher_estimate.basis.trim()) ? "" : "."}`
                  : "."}
              </p>
            )}
            {report.unverified_count > 0 && (
              <p className="text-muted">
                {report.unverified_count} option{report.unverified_count === 1 ? "" : "s"} not yet verified.
              </p>
            )}
          </div>

          {data.length > 0 && (
            <div style={{ height: Math.max(100, data.length * 40 + 40) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} layout="vertical" margin={{ top: 4, right: 80, bottom: 4, left: 8 }} barCategoryGap={8}>
                  <CartesianGrid horizontal={false} stroke="var(--chart-grid)" strokeWidth={1} />
                  <XAxis
                    type="number"
                    tickFormatter={(v: number) => formatCad(v)}
                    stroke="var(--chart-axis)"
                    tick={{ fill: "var(--chart-ink-muted)", fontSize: 12 }}
                    tickLine={false}
                  />
                  <YAxis type="category" dataKey="name" width={170} stroke="var(--chart-axis)" tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: "var(--chart-grid)", opacity: 0.5 }}
                    content={({ active, payload }) => {
                      const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                      if (!active || !p) return null;
                      return (
                        <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
                          <div className="text-sm font-semibold">{formatCad(p.value)}</div>
                          <div className="text-muted">{p.name}</div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="value" maxBarSize={24} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {data.map((d) => (
                      // Estimates: same hue, lighter, and labelled "(estimate)" (never color alone).
                      <Cell key={d.name} fill={color} fillOpacity={d.estimate ? 0.45 : 1} />
                    ))}
                    <LabelList dataKey="value" position="right" formatter={(v: unknown) => formatCad(Number(v))} style={{ fill: "var(--foreground)", fontSize: 12 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Show as table</summary>
            <table className="mt-2 w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1 font-medium">Redemption</th>
                  <th className="py-1 text-right font-medium">Worth</th>
                  <th className="py-1 pl-4 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {report.options.map((o) => (
                  <tr key={o.method} className="border-t border-border">
                    <td className="py-1">{methodLabel(o.method)}</td>
                    <td className="py-1 text-right tabular-nums">{o.value === null ? "Not yet verified" : formatCad(o.value)}</td>
                    <td className="py-1 pl-4 text-xs text-muted">{o.is_estimate ? `Estimate${o.basis ? `: ${o.basis}` : ""}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </div>
  );
}
