"use client";

import { useState } from "react";
import type { Catalog } from "../lib/catalog";

export const MAX_CARDS = 3;

interface Props {
  catalog: Catalog;
  selected: string[];
  onAdd: (cardId: string) => void;
  onRemove: (cardId: string) => void;
}

const field =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground disabled:opacity-50";

export function CardPicker({ catalog, selected, onAdd, onRemove }: Props) {
  const [issuer, setIssuer] = useState("");
  const [cardId, setCardId] = useState("");
  const full = selected.length >= MAX_CARDS;
  const issuerCards = catalog.cards.filter((c) => c.issuer === issuer && !selected.includes(c.id));
  const byId = new Map(catalog.cards.map((c) => [c.id, c]));

  if (catalog.empty) {
    return (
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold">Your cards</h2>
        <p className="mt-2 text-sm text-muted">
          No verified cards yet. Cards are added once their terms have been checked against the
          issuer&apos;s own website.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <div>
        <h2 className="text-lg font-semibold">Your cards</h2>
        <p className="text-sm text-muted">Pick up to {MAX_CARDS} cards, then import a statement for each.</p>
        {catalog.fixtures_enabled && (
          <p className="mt-2 rounded-md border border-review-border bg-review px-3 py-2 text-xs">
            Development mode: FAKE test-fixture cards are listed. They never appear in production builds.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-sm">
          Issuer
          <select
            className={field}
            value={issuer}
            disabled={full}
            onChange={(e) => {
              setIssuer(e.target.value);
              setCardId("");
            }}
          >
            <option value="">Choose an issuer</option>
            {catalog.issuers.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Card
          <select
            className={field}
            value={cardId}
            disabled={full || !issuer}
            onChange={(e) => setCardId(e.target.value)}
          >
            <option value="">{issuer ? "Choose a card" : "Choose an issuer first"}</option>
            {issuerCards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
          disabled={full || !cardId}
          onClick={() => {
            onAdd(cardId);
            setCardId("");
          }}
        >
          Add card
        </button>
      </div>
      {full && <p className="text-sm text-muted">You&apos;ve added the maximum of {MAX_CARDS} cards.</p>}

      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {selected.map((id) => (
            <li
              key={id}
              className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm"
            >
              {byId.get(id)?.name ?? id}
              <button
                type="button"
                className="text-muted hover:text-danger"
                aria-label={`Remove ${byId.get(id)?.name ?? id}`}
                onClick={() => onRemove(id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
