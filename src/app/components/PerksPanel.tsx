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

function NudgeItem({ n }: { n: Nudge }) {
  const list = (p: { date: string; description: string; amount: number }[]) =>
    p.slice(0, 3).map((x) => `${x.description} (${formatCad(x.amount)}, ${x.date})`).join("; ") + (p.length > 3 ? `; and ${p.length - 3} more` : "");
  switch (n.kind) {
    case "protection":
      return (
        <li>
          You bought at {list(n.purchases)}. This card lists <strong>{PERK_LABELS[n.perk.type].toLowerCase()}</strong>:{" "}
          <Quote text={n.perk.summary} />
          {stop(n.perk.summary)} Conditions: <Quote text={n.perk.conditions} />
          {stop(n.perk.conditions)} Keep your receipt and check the{" "}
          <Source url={n.perk.source_url} /> before relying on it.
        </li>
      );
    case "travel_charge":
      return (
        <li>
          Coverage applies only if the trip is charged to this card ({PERK_LABELS[n.perk.type].toLowerCase()}). Travel on
          these statements: {list(n.purchases)}. Conditions: <Quote text={n.perk.conditions} />
          {stop(n.perk.conditions)} See the <Source url={n.perk.source_url} />.
        </li>
      );
    case "enrollment":
      return (
        <li>
          <strong>{PERK_LABELS[n.perk.type]}</strong> requires enrollment: <Quote text={n.perk.summary} />
          {stop(n.perk.summary)} See the{" "}
          <Source url={n.perk.source_url} /> for how to enrol.
        </li>
      );
    case "credit":
      return (
        <li>
          <strong>{formatCad(n.remaining)}</strong> of <Quote text={n.description} /> ({formatCad(n.limit)}) looks unused
          until {n.period_end} ({n.days_left} day{n.days_left === 1 ? "" : "s"} left), based on the statements uploaded here.
          It applies at {n.merchant_keywords.map((k) => k.toUpperCase()).join(" or ")}.
        </li>
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
      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">Benefits you may not be using</h3>
        <p className="text-xs text-muted">
          For information only, not advice. The card&apos;s own terms decide what&apos;s covered; CardOpt only repeats what
          they say.
        </p>
        {nudges.length === 0 ? (
          <p className="text-sm text-muted">Nothing on these statements to flag.</p>
        ) : (
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            {nudges.map((n, i) => (
              <NudgeItem key={i} n={n} />
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">All listed benefits</h3>
        {listing.status === "unverified" ? (
          <p className="text-sm text-muted">This card&apos;s benefits are not yet verified.</p>
        ) : listing.perks.length === 0 ? (
          <p className="text-sm text-muted">This card lists no benefits.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1 font-medium">Benefit</th>
                  <th className="py-1 font-medium">What the terms say</th>
                  <th className="py-1 font-medium">Conditions</th>
                  <th className="py-1 font-medium">Enrollment</th>
                  <th className="py-1 font-medium">Must be charged to this card</th>
                  <th className="py-1 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {listing.perks.map(({ perk }, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="py-1 pr-3">{PERK_LABELS[perk.type]}</td>
                    <td className="py-1 pr-3">{perk.summary}</td>
                    <td className="py-1 pr-3">{perk.conditions ?? <span className="text-muted">Details not verified</span>}</td>
                    <td className="py-1 pr-3">
                      {perk.requires_enrollment === null ? <span className="text-muted">Not verified</span> : perk.requires_enrollment ? "Required" : "Not required"}
                    </td>
                    <td className="py-1 pr-3">
                      {perk.requires_charge_to_card === null ? <span className="text-muted">Details not verified</span> : perk.requires_charge_to_card ? "Yes" : "No"}
                    </td>
                    <td className="py-1">
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
