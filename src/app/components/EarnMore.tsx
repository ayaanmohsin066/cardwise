"use client";

import { useEffect, useRef, useState } from "react";
import type { CardChange, CardSetEntry } from "@/engine";
import type { Catalog } from "../lib/catalog";
import { CATEGORY_LABELS, formatCad } from "../lib/format";
import { describeCreditRule, describePolicy } from "../lib/policy-text";
import type { RecommendRequest, RecommendResults, Stage, WorkerMessage } from "../lib/run-recommendations";
import type { CardReport } from "./Importer";

interface Props {
  catalog: Catalog;
  /** Owned cards with imported statements. */
  reports: CardReport[];
  /** Changes identity whenever any input changes (Importer's memoized reports). */
  version: object;
}

const STAGE_LABELS: Record<Stage, string> = {
  loading: "Loading the optimizer",
  your_cards: "Checking your own cards",
  comparing: "Comparing other cards",
  sensitivity: "Checking point values",
};

const signed = (x: number) => `${x >= 0 ? "+" : "−"}${formatCad(Math.abs(x))}`;

/** A signed dollar figure: green for a gain, red for a loss, plain when it rounds to $0.00. */
function Signed({ value, suffix = "" }: { value: number; suffix?: string }) {
  const tone = value > 0.005 ? "text-gain" : value < -0.005 ? "text-loss" : "";
  return (
    <span className={`tabular-nums ${tone}`}>
      {signed(value)}
      {suffix}
    </span>
  );
}

const TH = "px-3 py-2 font-semibold";
const TD = "px-3 py-2.5";

export function EarnMore({ catalog, reports, version }: Props) {
  const [running, setRunning] = useState<{ stage: Stage; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<(RecommendResults & { version: object }) | null>(null);
  const [showAll, setShowAll] = useState(false);
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const name = (id: string) => catalog.cards.find((c) => c.id === id)?.name ?? id;

  // Stop any running computation when the section goes away.
  useEffect(() => () => worker.current?.terminate(), []);

  if (catalog.empty) {
    return (
      <section className="panel px-5 py-4">
        <h2 className="text-base font-semibold">Earn more</h2>
        <p className="mt-1 text-sm text-muted">Recommendations need verified cards.</p>
      </section>
    );
  }
  if (reports.length === 0) return null;

  function cancel() {
    worker.current?.terminate();
    worker.current = null;
    setRunning(null);
  }

  function run() {
    // A new request cancels the old one: terminating is the only way to stop a synchronous solve.
    cancel();
    setError(null);
    const id = ++requestId.current;
    const snapshot = version;
    const w = new Worker(new URL("../workers/recommend.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    w.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.id !== requestId.current) return;
      if (m.type === "progress") setRunning({ stage: m.stage, done: m.done, total: m.total });
      else {
        if (m.type === "result") setResults({ ...m.results, version: snapshot });
        else setError(m.message);
        setRunning(null);
        w.terminate();
        if (worker.current === w) worker.current = null;
      }
    };
    w.onerror = (e) => {
      if (id !== requestId.current) return;
      setError(e.message || "The optimizer stopped unexpectedly.");
      setRunning(null);
    };
    const request: RecommendRequest = {
      id,
      owned: reports.map((r) => ({ card: r.option.card, program: r.program, redemption_method: r.report.redemption?.method ?? null })),
      items: reports.map((r) => [r.option.id, r.items]),
      catalogue: catalog.cards.map(
        (c): CardSetEntry => ({ card: c.card, program: c.card.program_id ? catalog.programs[c.card.program_id] ?? null : null }),
      ),
    };
    setRunning({ stage: "loading", done: 0, total: 1 });
    w.postMessage(request);
  }

  const stale = results !== null && results.version !== version;
  const changeLabel = (c: CardChange) =>
    c.action === "add" ? `Add ${name(c.add)}` : `Replace ${name(c.remove!)} with ${name(c.add)}`;
  const changes = results?.change.changes ?? [];
  const shown = showAll ? changes : changes.slice(0, 5);
  const proj = results?.better.projection ?? results?.change.projection;
  const excluded = results
    ? [...results.better.excluded, ...results.change.excluded].filter((x, i, a) => a.findIndex((y) => y.card_id === x.card_id) === i)
    : [];
  const best = changes[0];
  const pct = running && running.total > 0 ? Math.round((running.done / running.total) * 100) : 0;

  return (
    <section className="panel" aria-label="Earn more">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex flex-col gap-0.5">
          <p className="eyebrow">Recommendations</p>
          <h2 className="text-base font-semibold">Earn more</h2>
          <p className="text-sm text-muted">
            Which card to use for what, and whether a different card would pay off, based on your own spending.
          </p>
        </div>
        <div className="flex gap-2">
          {running && (
            <button type="button" className="btn" onClick={cancel}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={run}
          >
            {running ? "Start over" : results ? "Run again" : "Find ways to earn more"}
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-6 p-5 empty:hidden">
      {running && (
        <div className="flex flex-col gap-1" role="status" aria-live="polite">
          <div className="flex justify-between text-xs text-muted">
            <span>{STAGE_LABELS[running.stage]}…</span>
            {running.total > 1 && <span className="tabular-nums">{running.done} of {running.total}</span>}
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label={STAGE_LABELS[running.stage]}
            className="h-1.5 w-full overflow-hidden rounded-full bg-meter-track"
          >
            <div className="h-full rounded-full bg-meter-fill transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {error && <p className="text-sm text-danger">Couldn&apos;t run the recommendations: {error}</p>}
      {stale && !running && <p className="text-sm text-muted">Your statements or settings changed since this ran. Run again to update.</p>}

      {results && proj && (
        <div className={`flex flex-col gap-6 ${running ? "opacity-60" : ""}`}>
          <p className="rounded-lg border border-border bg-background px-4 py-3 text-xs leading-relaxed text-muted">
            <span className="tag mr-2">Projection</span>
            All yearly figures are a projection: your {proj.months} month{proj.months === 1 ? "" : "s"} of statements × 12/
            {proj.months}. Welcome bonuses are counted once, not multiplied.
            {proj.short_data && " With fewer than 3 months, seasonal spending may skew this."}
          </p>

          {best && best.ongoing.total_gain_annual > 0.005 && (
            <div className="rounded-lg border border-border bg-background text-sm">
              <div className="flex flex-col gap-1.5 px-5 py-5">
                <span className="eyebrow">Compared with how you used your cards on these statements</span>
                <span className="text-4xl font-semibold tracking-tight sm:text-5xl">
                  <Signed value={best.ongoing.total_gain_annual} />
                  <span className="text-base font-medium text-muted"> /year</span>
                </span>
              </div>
              {/* The two parts and their total, as a sum: the last row repeats the headline. */}
              <dl className="grid grid-cols-[1fr_auto] items-baseline border-t border-border px-5 py-3">
                <dt className="py-1.5">
                  <span aria-hidden className="inline-block w-5 text-muted" />
                  Using your current cards as suggested
                </dt>
                <dd className="py-1.5 pl-6 text-right">
                  <Signed value={results.change.routing_gain_annual} suffix="/year" />
                </dd>
                <dt className="py-1.5">
                  <span aria-hidden className="inline-block w-5 text-muted">+</span>
                  {changeLabel(best)} (ongoing)
                </dt>
                <dd className="py-1.5 pl-6 text-right">
                  <Signed value={best.ongoing.gain_annual} suffix="/year" />
                </dd>
                <dt className="mt-1.5 border-t-2 border-border-strong py-2 font-semibold">
                  <span aria-hidden className="inline-block w-5">=</span>
                  Total
                </dt>
                <dd className="mt-1.5 border-t-2 border-border-strong py-2 pl-6 text-right font-semibold">
                  <Signed value={best.ongoing.total_gain_annual} suffix="/year" />
                </dd>
              </dl>
            </div>
          )}

          {excluded.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-border-strong border-l-4 border-l-foreground bg-surface-2 px-4 py-3.5 text-sm">
              <p className="eyebrow text-foreground">Not yet verified</p>
              <p className="font-semibold">Left out because their terms aren&apos;t verified yet:</p>
              <ul className="flex flex-col gap-1">
                {excluded.map((x) => (
                  <li key={x.card_id} className="border-t border-border pt-1">
                    <span className="font-medium">{x.name}</span>: {x.reasons.join("; ")}.
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-border pt-6">
            <div className="flex flex-col gap-0.5">
              <p className="eyebrow">Routing</p>
              <h3 className="text-base font-semibold">Use your cards better</h3>
            </div>
            {results.better.status === "ok" && results.better.current && results.better.suggested ? (
              <>
                <p className="text-sm">
                  {results.better.gain_annual > 0.005 ? (
                    <>
                      Following this could earn about{" "}
                      <strong>
                        <Signed value={results.better.gain_annual} suffix="/year" />
                      </strong>{" "}
                      more than
                      the way you used your cards on these statements.
                    </>
                  ) : (
                    "You're already using your cards about as well as possible for this spending."
                  )}
                </p>
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background text-sm empty:hidden">
                  {results.better.credit_rules.map((c) => (
                    <li key={`${c.card_id}-${c.description}`} className="px-4 py-2.5">{describeCreditRule(c, name)}</li>
                  ))}
                  {results.better.policy
                    .filter((p) => p.has_spend)
                    .flatMap((p) => describePolicy(p, name))
                    .map((s) => (
                      <li key={s} className="px-4 py-2.5">{s}</li>
                    ))}
                </ul>
                <details className="text-sm">
                  <summary className="w-fit cursor-pointer rounded-md text-muted hover:text-foreground">Categories with no spending in these statements</summary>
                  <ul className="mt-2 flex flex-col gap-1.5 text-muted">
                    {results.better.policy
                      .filter((p) => !p.has_spend)
                      .flatMap((p) => describePolicy(p, name))
                      .map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                  </ul>
                </details>
                {(results.better.moves.some((m) => Math.abs(m.gain_annual) > 0.005) || Math.abs(results.better.credit_gain_annual) > 0.005) && (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead className="bg-surface-2">
                        <tr className="eyebrow">
                          <th className={TH}>Category</th>
                          <th className={TH}>On these statements</th>
                          <th className={TH}>Suggested</th>
                          <th className={`${TH} text-right`}>Per year</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.better.moves
                          .filter((m) => Math.abs(m.gain_annual) > 0.005)
                          .map((m) => (
                            <tr key={m.category} className="border-t border-border">
                              <td className={`${TD} font-medium`}>{CATEGORY_LABELS[m.category]}</td>
                              <td className={TD}>{m.current.map((x) => `${name(x.card_id)} ${formatCad(x.spend)}`).join(", ")}</td>
                              <td className={TD}>{m.suggested.map((x) => `${name(x.card_id)} ${formatCad(x.spend)}`).join(", ")}</td>
                              <td className={`${TD} text-right`}><Signed value={m.gain_annual} /></td>
                            </tr>
                          ))}
                        {Math.abs(results.better.credit_gain_annual) > 0.005 && (
                          <tr className="border-t border-border">
                            <td className={TD} colSpan={3}>Purchase credits captured</td>
                            <td className={`${TD} text-right`}><Signed value={results.better.credit_gain_annual} /></td>
                          </tr>
                        )}
                        {Math.abs(results.better.other_gain_annual) > 0.005 && (
                          <tr className="border-t border-border">
                            <td className={TD} colSpan={3}>Foreign transaction fees and rounding</td>
                            <td className={`${TD} text-right`}><Signed value={results.better.other_gain_annual} /></td>
                          </tr>
                        )}
                        <tr className="border-t-2 border-border-strong bg-surface-2 font-semibold">
                          <td className={TD} colSpan={3}>= Total</td>
                          <td className={`${TD} text-right`}><Signed value={results.better.gain_annual} /></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <p className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted">
                {results.better.status === "no_usable_cards"
                  ? "None of your cards has verified terms for this spending yet."
                  : "Not enough data to suggest changes."}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-6">
            <div className="flex flex-col gap-0.5">
              <p className="eyebrow">Card changes</p>
              <h3 className="text-base font-semibold">Change a card</h3>
            </div>
            <p className="max-w-3xl text-xs leading-relaxed text-muted">
              Compared with your current cards used as suggested above ({formatCad(results.change.baseline_annual)}/year),
              after annual fees. First year uses first-year fees and a welcome bonus if hitting it pays off.
            </p>
            {changes.length === 0 ? (
              <p className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted">No other verified cards to compare yet.</p>
            ) : (
              <div className="flex flex-col items-start gap-3">
                <div className="w-full overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-surface-2">
                    <tr className="eyebrow">
                      <th className={TH}>Change</th>
                      <th className={`${TH} text-right`}>First year</th>
                      <th className={`${TH} text-right`}>Ongoing, per year</th>
                      <th className={TH}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((c) => (
                      <tr key={`${c.remove}>${c.add}`} className="border-t border-border">
                        <td className={`${TD} font-medium`}>{changeLabel(c)}</td>
                        <td className={`${TD} text-right`}><Signed value={c.first_year.gain_annual} /></td>
                        <td className={`${TD} text-right`}><Signed value={c.ongoing.gain_annual} /></td>
                        <td className={`${TD} text-xs text-muted`}>
                          {c.first_year.bonus_value > 0
                            ? `Includes ${formatCad(c.first_year.bonus_value)} welcome bonus${c.first_year.bonus_projected ? " (spend requirement projected from your pace)" : ""}`
                            : c.first_year.bonus_pursued
                              ? "Welcome bonus not reached with this spending"
                              : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                {changes.length > 5 && (
                  <button type="button" className="btn btn-sm" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Show fewer" : `Show all ${changes.length}`}
                  </button>
                )}
              </div>
            )}
            {results.sens && (
              <p className="rounded-lg border border-border bg-background px-4 py-3 text-xs leading-relaxed text-muted">
                <span className="tag mr-2">Sensitivity</span>
                {results.sens.scenarios === 0
                  ? "Point values: none of these cards' programs has a range of verified values, so there's nothing to vary."
                  : `Point values: the order of the top ${results.sens.base_ranking.length} held in ${results.sens.held} of ${results.sens.scenarios} scenarios where each points program was valued at its lowest and highest verified value.`}
              </p>
            )}
          </div>
        </div>
      )}
      </div>
    </section>
  );
}
