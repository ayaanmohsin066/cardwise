"use client";

import { useState } from "react";
import { CASH_PROGRAM_ID, valuePerDollar, welcomeBonusProgress, type Overrides, type Program } from "@/engine";
import { formatCad, formatPoints, seriesColor } from "../lib/format";
import { CategoryChart } from "./CategoryChart";
import type { CardReport } from "./Importer";
import { Meter } from "./Meter";
import { ReconcileBox } from "./ReconcileBox";
import { PerksPanel } from "./PerksPanel";
import { RedeemPanel } from "./RedeemPanel";
import { StatTile } from "./StatTile";
import { Tabs } from "./Tabs";

export interface BenefitsSettings {
  /** null = the program's default (first non-estimate) method. */
  redemption_method: string | null;
  /** Card open date, YYYY-MM-DD, or "" when not given. */
  open_date: string;
}

interface Props {
  data: CardReport;
  program: Program | null;
  settings: BenefitsSettings;
  onSettings: (s: BenefitsSettings) => void;
  overrides: Overrides;
  onOverrides: (o: Overrides) => void;
}

const NOT_VERIFIED = "Not yet verified";

/** Today in the browser's local time, YYYY-MM-DD. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function BenefitsPanel({ data, program, settings, onSettings, overrides, onOverrides }: Props) {
  const { option, report, items, slot } = data;
  const card = option.card;
  const isCash = card.program_id === CASH_PROGRAM_ID;
  const hasValue = report.rewards_value !== null;
  const [asOf] = useState(today);
  const bonuses = settings.open_date ? welcomeBonusProgress(card, items, settings.open_date, asOf) : [];
  const unverifiedCount = report.unverified.reduce((s, u) => s + u.count, 0);
  const unmatchedRefunds = report.transactions.filter((t) => t.refund_confidence === "low").length;
  const method = report.redemption?.method ?? null;
  /** Points as dollars, only through valuePerDollar; null when unverified. */
  const dollars = (points: number) => (program && method ? valuePerDollar(points, program, method) : null);
  // Green and red are used only for money gained or lost.
  const netTone = report.net_value > 0 ? "text-gain" : report.net_value < 0 ? "text-loss" : "";
  const bonusLabel = (points: number | null) => {
    if (points === null) return NOT_VERIFIED;
    if (!isCash) return `${formatPoints(points)} points`;
    const d = dollars(points);
    return d === null ? NOT_VERIFIED : formatCad(d);
  };

  return (
    <section className="panel" aria-label={`Benefits for ${option.name}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex flex-col gap-0.5">
          <p className="eyebrow">Benefits report</p>
          <h2 className="text-base font-semibold">{option.name}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="tag tabular-nums">
            {report.period.start} to {report.period.end}
          </span>
          <span className="tag tabular-nums">
            About {report.fees.months_covered} month{report.fees.months_covered === 1 ? "" : "s"}
          </span>
          <span className="tag tabular-nums">Terms checked {option.last_verified}</span>
        </div>
      </header>
      <div className="p-5">
      <Tabs
        label={`${option.name} details`}
        tabs={[
          {
            id: "benefits",
            label: "Benefits",
            content: (
              <>

              <div className="grid gap-3 sm:grid-cols-2 sm:items-end lg:max-w-3xl">
                {program && program.redemptions.length > 1 && (
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    Value points as
                    <select
                      className="field font-normal"
                      value={report.redemption?.method ?? ""}
                      onChange={(e) => onSettings({ ...settings, redemption_method: e.target.value })}
                    >
                      {program.redemptions.map((r) => (
                        <option key={r.method} value={r.method}>
                          {r.method.replace(/_/g, " ")}
                          {r.is_estimate ? " (estimate)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  <span>
                    Card open date <span className="font-normal text-muted">(optional: first-year fee and welcome bonus)</span>
                  </span>
                  <input
                    type="date"
                    className="field font-normal"
                    value={settings.open_date}
                    onChange={(e) => onSettings({ ...settings, open_date: e.target.value })}
                  />
                </label>
              </div>

              {unverifiedCount > 0 && (
                <div
                  className="flex gap-3 rounded-lg border border-border-strong border-l-4 border-l-foreground bg-surface-2 px-4 py-3.5 text-sm"
                  role="status"
                >
                  <svg aria-hidden viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M10 3.25 17.5 16.5h-15L10 3.25Z" strokeLinejoin="round" />
                    <path d="M10 8.5v3.5M10 14.25v.01" strokeLinecap="round" />
                  </svg>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <p className="eyebrow text-foreground">Not yet verified</p>
                    <p className="text-base font-semibold">
                      {unverifiedCount} item{unverifiedCount === 1 ? " is" : "s are"} not yet verified and left out of the totals.
                    </p>
                    <ul className="flex flex-col gap-1">
                      {report.unverified.map((u) => (
                        <li key={`${u.kind}-${u.label}`} className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-border pt-1">
                          <span>{u.label}</span>
                          {u.amount !== null && (
                            <span className="tabular-nums text-muted">
                              {u.count} line{u.count === 1 ? "" : "s"}, {formatCad(u.amount)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {report.fees.interest > 0 && (
                <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border border-l-4 border-l-loss px-4 py-3" role="note">
                  <div>
                    <p className="text-sm font-semibold">
                      Interest charged: <span className="tabular-nums text-loss">{formatCad(report.fees.interest)}</span>
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted">
                      Not part of the rewards value below. Paying the full balance by the due date usually avoids
                      interest, which often costs more than a card earns.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-background px-5 py-5">
                <span className="eyebrow">Net value for this period</span>
                <span className={`text-4xl font-semibold tabular-nums tracking-tight sm:text-5xl ${netTone}`}>
                  {formatCad(report.net_value)}
                </span>
                <span className="text-xs leading-relaxed text-muted">
                  {report.net_value_excludes.length
                    ? `Leaves out: ${report.net_value_excludes.join(", ")}`
                    : "Rewards + credits − annual fee share − FX fees"}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile
                  label={isCash ? "Cash back" : "Rewards value"}
                  value={report.rewards_value === null ? NOT_VERIFIED : formatCad(report.rewards_value)}
                  sub={
                    isCash
                      ? undefined
                      : `${formatPoints(report.points_total)} points${report.value_is_estimate ? " · estimated value" : ""}`
                  }
                />
                <StatTile label="Credits used" value={formatCad(report.credits_total)} />
                <StatTile
                  label="Annual fee share"
                  value={report.fees.annual_fee_prorated === null ? NOT_VERIFIED : formatCad(report.fees.annual_fee_prorated)}
                  sub={
                    report.fees.annual_fee_full === null
                      ? undefined
                      : `${formatCad(report.fees.annual_fee_full)} ${report.fees.basis === "first_year_fee" ? "first-year" : "annual"} fee × ${report.fees.months_covered}/12`
                  }
                />
                <StatTile
                  label="Foreign transaction fees"
                  value={report.fx.amount === null ? NOT_VERIFIED : formatCad(report.fx.amount)}
                  sub={
                    report.fx.method === "embedded_estimate"
                      ? `Estimate: built into ${formatCad(report.fx.foreign_spend)} of foreign purchases`
                      : report.fx.method === "posted"
                        ? "Charged as separate lines on the statement"
                        : report.fx.method === "none"
                          ? "No foreign purchases found"
                          : undefined
                  }
                />
                {report.fees.posted_fee_lines !== 0 && (
                  <StatTile
                    label="Fee lines on statements"
                    value={formatCad(report.fees.posted_fee_lines)}
                    sub="Shown for reference; the annual fee share above is used instead"
                  />
                )}
              </div>
              {unmatchedRefunds > 0 && (
                <p className="text-xs leading-relaxed text-muted">
                  {unmatchedRefunds} refund{unmatchedRefunds === 1 ? "" : "s"} couldn&apos;t be matched to an earlier purchase
                  (likely from an earlier statement), so the points taken back are an estimate.
                </p>
              )}
              {report.fx.low_confidence_count > 0 && (
                <p className="text-xs leading-relaxed text-muted">
                  {report.fx.low_confidence_count} foreign purchase{report.fx.low_confidence_count === 1 ? " was" : "s were"} guessed
                  from the description. Map a currency column when importing for an exact count.
                </p>
              )}
              </div>

              <CategoryChart rows={report.categories} hasValue={hasValue} color={seriesColor(slot)} showPoints={!isCash} />

              {report.caps.length > 0 && (
                <div className="flex flex-col gap-3 border-t border-border pt-6">
                  <h4 className="section-title">Spending caps</h4>
                  {report.caps.map((c) => (
                    <Meter
                      key={`${c.cap_id}-${c.period_key}`}
                      label={`${c.categories.map((x) => x.replace(/_/g, " ")).join(" + ")} · ${c.period_key}`}
                      used={c.used}
                      limit={c.limit}
                      format={formatCad}
                      note={c.reached_on ? `Cap reached on ${c.reached_on}` : "Cap not reached"}
                    />
                  ))}
                </div>
              )}

              {report.credits.length > 0 && (
                <div className="flex flex-col gap-3 border-t border-border pt-6">
                  <h4 className="section-title">Purchase credits</h4>
                  {report.credits.map((c) =>
                    c.verified && c.limit !== null && c.used !== null ? (
                      <Meter
                        key={`${c.description}-${c.period_key}`}
                        label={`${c.description} · ${c.period_key}`}
                        used={c.used}
                        limit={c.limit}
                        format={formatCad}
                        note={`${c.method === "posted" ? "Credit posted on the statement" : "Estimated from matching purchases; no credit line posted yet"} · ${formatCad(c.remaining ?? 0)} left this period (uploaded statements only)`}
                      />
                    ) : (
                      <p key={c.description} className="rounded-lg border border-border bg-background px-4 py-3 text-sm">
                        {c.description}: <span className="text-muted">{NOT_VERIFIED}</span>
                      </p>
                    ),
                  )}
                </div>
              )}

              {bonuses.length > 0 && (
                <div className="flex flex-col gap-3 border-t border-border pt-6">
                  <h4 className="section-title">
                    Welcome bonus progress <span className="font-normal text-muted">(estimate)</span>
                  </h4>
                  <p className="-mt-2 text-xs text-muted">
                    Based only on the statements uploaded here. Your issuer&apos;s own count is what decides the bonus.
                  </p>
                  {bonuses.map((b) =>
                    b.status === "unverified" || b.min_spend === null ? (
                      <p key={b.bonus_index} className="rounded-lg border border-border bg-background px-4 py-3 text-sm">
                        Welcome bonus terms: <span className="text-muted">{NOT_VERIFIED}</span>
                      </p>
                    ) : (
                      <Meter
                        key={b.bonus_index}
                        label={`${bonusLabel(b.points_or_cash)} bonus`}
                        used={Math.max(0, b.spend_so_far)}
                        limit={b.min_spend}
                        format={formatCad}
                        note={
                          b.status === "met"
                            ? "Minimum spend looks met (estimate, from the uploaded statements)"
                            : b.status === "expired"
                              ? `Window ended ${b.window_end}`
                              : `About ${formatCad(b.remaining_spend ?? 0)} to go (estimate) · ${b.days_left} days left (window ends ${b.window_end})`
                        }
                      />
                    ),
                  )}
                </div>
              )}

              <ReconcileBox
                card={card}
                program={program}
                redemptionMethod={report.redemption?.method ?? null}
                isCash={isCash}
                items={items}
                overrides={overrides}
                onOverrides={onOverrides}
              />
              </>
            ),
          },
          { id: "redeem", label: "Redeem", content: <RedeemPanel program={program} isCash={isCash} color={seriesColor(slot)} /> },
          { id: "perks", label: "Perks", content: <PerksPanel card={card} items={items} report={report} /> },
        ]}
      />
      </div>
    </section>
  );
}
