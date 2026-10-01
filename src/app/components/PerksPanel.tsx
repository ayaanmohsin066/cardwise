"use client";

import { useState } from "react";
import { listPerks, perkNudges, type BenefitsReport, type Card, type CategorizedTransaction, type Nudge, type Perk } from "@/engine";
import { formatCad } from "../lib/format";
import { MERCHANT_RULES } from "../lib/rules";

const PERK_LABELS: Record<Perk["type"], string> = {
  travel_medical: "Travel medical insurance",
  trip_cancellation: "Trip cancellation / interruption",
  rental_car: "Rental car coverage",
  purchase_protection: "Purchase protection",
  extended_warranty: "Extended warranty",
  lounge: "Airport lounge access",
  mobile_device: "Mobile device insurance",
  other: "Other benefit",
};

const NOT_VERIFIED = "details not verified";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Perk text is quoted from the card data, never paraphrased into new claims. */
function Quote({ text }: { text: string | null }) {
  return text === null ? <span className="text-muted">{NOT_VERIFIED}</span> : <q>{text}</q>;
}

/** A full stop after a quote, unless the quoted text already ends a sentence. */
const stop = (text: string | null) => (text !== null && /[.!?]$/.test(text.trim()) ? "" : ".");

function Source({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" className="underline">
      card terms
    </a>
  );
}

const NUDGE_LABELS: Record<Nudge["kind"], string> = {
  protection: "Purchase reminder",
  travel_charge: "Travel reminder",
  enrollment: "Enrollment",
  credit: "Unused credit",
};

/** A reminder card: neutral and informational, never styled as a warning. */
function NudgeCard({ kind, children }: { kind: Nudge["kind"]; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 rounded-lg border border-border bg-background px-4 py-3.5">
      <svg aria-hidden viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="10" cy="10" r="7.25" />
        <path d="M10 9.25v4.25M10 6.5v.01" strokeLinecap="round" />
      </svg>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="eyebrow">{NUDGE_LABELS[kind]}</span>
        <p className="leading-relaxed">{children}</p>
      </div>
    </li>
  );
}

function NudgeItem({ n }: { n: Nudge }) {
  const list = (p: { date: string; description: string; amount: number }[]) =>
    p.slice(0, 3).map((x) => `${x.description} (${formatCad(x.amount)}, ${x.date})`).join("; ") + (p.length > 3 ? `; and ${p.length - 3} more` : "");
  switch (n.kind) {
    case "protection":
      return (
        <NudgeCard kind={n.kind}>
          You bought at {list(n.purchases)}. This card lists <strong>{PERK_LABELS[n.perk.type].toLowerCase()}</strong>:{" "}
          <Quote text={n.perk.summary} />
          {stop(n.perk.summary)} Conditions: <Quote text={n.perk.conditions} />
          {stop(n.perk.conditions)} Keep your receipt and check the{" "}
          <Source url={n.perk.source_url} /> before relying on it.
        </NudgeCard>
      );
    case "travel_charge":
      return (
        <NudgeCard kind={n.kind}>
          Coverage applies only if the trip is charged to this card ({PERK_LABELS[n.perk.type].toLowerCase()}). Travel on
          these statements: {list(n.purchases)}. Conditions: <Quote text={n.perk.conditions} />
          {stop(n.perk.conditions)} See the <Source url={n.perk.source_url} />.
        </NudgeCard>
      );
    case "enrollment":
      return (
        <NudgeCard kind={n.kind}>
          <strong>{PERK_LABELS[n.perk.type]}</strong> requires enrollment: <Quote text={n.perk.summary} />
          {stop(n.perk.summary)} See the{" "}
          <Source url={n.perk.source_url} /> for how to enrol.
        </NudgeCard>
      );
    case "credit":
      return (
        <NudgeCard kind={n.kind}>
          <strong>{formatCad(n.remaining)}</strong> of <Quote text={n.description} /> ({formatCad(n.limit)}) looks unused
          until {n.period_end} ({n.days_left} day{n.days_left === 1 ? "" : "s"} left), based on the statements uploaded here.
          It applies at {n.merchant_keywords.map((k) => k.toUpperCase()).join(" or ")}.
        </NudgeCard>
      );
  }
}

interface Props {
  card: Card;
  items: CategorizedTransaction[];
  report: BenefitsReport;
}

/** "Benefits you may not be using": perks as listed, plus transaction-triggered reminders. */
export function PerksPanel({ card, items, report }: Props) {
  const [asOf] = useState(today);
  const listing = listPerks(card);
  const nudges = perkNudges(card, items, MERCHANT_RULES, report, asOf);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
        <p className="eyebrow">Reminders</p>
        <h3 className="text-base font-semibold">Benefits you may not be using</h3>
        <p className="max-w-2xl text-xs leading-relaxed text-muted">
          For information only, not advice. The card&apos;s own terms decide what&apos;s covered; CardOpt only repeats what
          they say.
        </p>
        </div>
        {nudges.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong px-4 py-5 text-center text-sm text-muted">
            Nothing on these statements to flag.
          </p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {nudges.map((n, i) => (
              <NudgeItem key={i} n={n} />
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <h3 className="section-title">All listed benefits</h3>
        {listing.status === "unverified" ? (
          <p className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted">
            This card&apos;s benefits are not yet verified.
          </p>
        ) : listing.perks.length === 0 ? (
          <p className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted">This card lists no benefits.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-surface-2">
                <tr className="eyebrow">
                  <th className="px-3 py-2 font-semibold">Benefit</th>
                  <th className="px-3 py-2 font-semibold">What the terms say</th>
                  <th className="px-3 py-2 font-semibold">Conditions</th>
                  <th className="px-3 py-2 font-semibold">Enrollment</th>
                  <th className="px-3 py-2 font-semibold">Must be charged to this card</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                </tr>
              </thead>
              <tbody>
                {listing.perks.map(({ perk }, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="px-3 py-2.5 font-medium">{PERK_LABELS[perk.type]}</td>
                    <td className="px-3 py-2.5">{perk.summary}</td>
                    <td className="px-3 py-2.5">{perk.conditions ?? <span className="text-muted">Details not verified</span>}</td>
                    <td className="px-3 py-2.5">
                      {perk.requires_enrollment === null ? <span className="text-muted">Not verified</span> : perk.requires_enrollment ? "Required" : "Not required"}
                    </td>
                    <td className="px-3 py-2.5">
                      {perk.requires_charge_to_card === null ? <span className="text-muted">Details not verified</span> : perk.requires_charge_to_card ? "Yes" : "No"}
                    </td>
                    <td className="px-3 py-2.5">
                      <Source url={perk.source_url} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
