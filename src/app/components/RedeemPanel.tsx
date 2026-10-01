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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="eyebrow">Redeem</p>
        <h3 className="text-base font-semibold">Your {isCash ? "cash back" : "points"} are worth</h3>
        <p className="text-sm text-muted">
          Enter the {isCash ? "cash back" : "points"} balance from your latest statement. It stays in this browser tab.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label className="flex w-56 flex-col gap-1.5 text-sm font-medium">
          {isCash ? "Cash back balance ($)" : "Points balance"}
          <input
            inputMode="decimal"
            className="field font-normal tabular-nums"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        {input.trim() !== "" && !valid && <p className="text-sm text-danger">Enter a number, like 12500.</p>}
      </div>

      {report?.kind === "unverified" && (
        <p className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted">
          {report.reason} Values: not yet verified.
        </p>
      )}

      {report?.kind === "cash" && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-background px-5 py-5">
          <span className="eyebrow">Cash back balance</span>
          <span className="text-4xl font-semibold tabular-nums tracking-tight">{formatCad(report.balance)}</span>
          <span className="text-xs leading-relaxed text-muted">
            Your cash back balance is worth {formatCad(report.balance)}. Cash back has one value, so there&apos;s nothing
            to compare.
          </span>
        </div>
      )}

      {report?.kind === "points" && (
        <>
          <div className="flex flex-col gap-3">
            {report.best ? (
              <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-background px-5 py-5">
                <span className="eyebrow">Best verified option</span>
                <span className="text-4xl font-semibold tabular-nums tracking-tight">{formatCad(report.best.value!)}</span>
                <span className="text-sm">
                  <span className="font-medium">{methodLabel(report.best.method)}</span>
                  <span className="text-muted"> · for {formatPoints(report.balance)} points</span>
                </span>
                {report.gap !== null && report.lowest && report.gap > 0.005 && (
                  <span className="text-sm text-muted">
                    Redeeming via {methodLabel(report.best.method).toLowerCase()} instead of{" "}
                    {methodLabel(report.lowest.method).toLowerCase()} is worth{" "}
                    <span className="font-semibold tabular-nums text-gain">{formatCad(report.gap)}</span> more.
                  </span>
                )}
              </div>
            ) : (
              <p className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted">
                No redemption option has a verified fixed value yet.
              </p>
            )}
            {report.higher_estimate && (
              <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-border-strong px-4 py-3 text-sm">
                <span className="tag w-fit">Estimate</span>
                <p className="text-muted">
                  {methodLabel(report.higher_estimate.method)} could be worth about{" "}
                  <span className="tabular-nums">{formatCad(report.higher_estimate.value!)}</span>, but that&apos;s an estimate
                  {report.higher_estimate.basis
                    ? `: ${report.higher_estimate.basis}${/[.!?]$/.test(report.higher_estimate.basis.trim()) ? "" : "."}`
                    : "."}
                </p>
              </div>
            )}
            {report.unverified_count > 0 && (
              <p className="text-sm text-muted">
                {report.unverified_count} option{report.unverified_count === 1 ? "" : "s"} not yet verified.
              </p>
            )}
          </div>

          {data.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-border pt-6">
              <h4 className="section-title">Value by redemption</h4>
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
            </div>
          )}

          <details className="text-sm">
            <summary className="w-fit cursor-pointer rounded-md text-muted hover:text-foreground">Show as table</summary>
            <div className="mt-3 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="bg-surface-2">
                  <tr className="eyebrow">
                    <th className="px-3 py-2 font-semibold">Redemption</th>
                    <th className="px-3 py-2 text-right font-semibold">Worth</th>
                    <th className="px-3 py-2 font-semibold">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {report.options.map((o) => (
                    <tr key={o.method} className="border-t border-border">
                      <td className="px-3 py-2">{methodLabel(o.method)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{o.value === null ? "Not yet verified" : formatCad(o.value)}</td>
                      <td className="px-3 py-2 text-xs text-muted">{o.is_estimate ? `Estimate${o.basis ? `: ${o.basis}` : ""}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
