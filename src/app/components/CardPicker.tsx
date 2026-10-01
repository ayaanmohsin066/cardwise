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

function CardGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.25" y="4.5" width="15.5" height="11" rx="2" />
      <path d="M2.25 8.5h15.5M5.5 12.5h3" />
    </svg>
  );
}

function Select({ label, children, ...props }: { label: string } & React.ComponentProps<"select">) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      <select className="field font-normal" {...props}>
        {children}
      </select>
    </label>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold">Your cards</h2>
        <p className="text-sm text-muted">Pick up to {MAX_CARDS} cards, then import a statement for each.</p>
      </div>
      {children}
    </div>
  );
}

export function CardPicker({ catalog, selected, onAdd, onRemove }: Props) {
  const [issuer, setIssuer] = useState("");
  const [cardId, setCardId] = useState("");
  const full = selected.length >= MAX_CARDS;
  const issuerCards = catalog.cards.filter((c) => c.issuer === issuer && !selected.includes(c.id));
  const byId = new Map(catalog.cards.map((c) => [c.id, c]));
  const issuerName = (id: string) => catalog.issuers.find((i) => i.id === id)?.name ?? id;

  if (catalog.empty) {
    return (
      <section id="cards" className="panel scroll-mt-32">
        <Header />
        <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 text-muted">
            <CardGlyph />
          </span>
          <p className="text-sm font-medium">No verified cards yet</p>
          <p className="max-w-sm text-sm text-muted">
            Cards are added once their terms have been checked against the issuer&apos;s own website.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="cards" className="panel scroll-mt-32">
      <Header>
        <div className="flex items-center gap-2" aria-label={`${selected.length} of ${MAX_CARDS} cards added`} role="img">
          <span className="text-sm tabular-nums text-muted">
            <span className="font-semibold text-foreground">{selected.length}</span> of {MAX_CARDS}
          </span>
          <span className="flex gap-1">
            {Array.from({ length: MAX_CARDS }, (_, i) => (
              <span key={i} className={`h-1.5 w-5 rounded-full ${i < selected.length ? "bg-accent" : "bg-border"}`} />
            ))}
          </span>
        </div>
      </Header>

      <div className="flex flex-col gap-5 p-5">
        {catalog.fixtures_enabled && (
          <p className="rounded-md border border-review-border bg-review px-3 py-2 text-xs">
            Development mode: FAKE test-fixture cards are listed. They never appear in production builds.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Select
            label="Issuer"
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
          </Select>
          <Select label="Card" value={cardId} disabled={full || !issuer} onChange={(e) => setCardId(e.target.value)}>
            <option value="">{issuer ? "Choose a card" : "Choose an issuer first"}</option>
            {issuerCards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={full || !cardId}
            onClick={() => {
              onAdd(cardId);
              setCardId("");
            }}
          >
            Add card
          </button>
        </div>
        {full && <p className="-mt-2 text-sm text-muted">You&apos;ve added the maximum of {MAX_CARDS} cards.</p>}

        {selected.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong px-4 py-6 text-center text-sm text-muted">
            No cards added yet. Choose an issuer and a card to begin.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {selected.map((id) => {
              const card = byId.get(id);
              const name = card?.name ?? id;
              return (
                <li key={id} className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface text-muted ring-1 ring-border">
                    <CardGlyph />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{name}</span>
                    {card && (
                      <>
                        <span className="truncate text-xs text-muted">{issuerName(card.issuer)}</span>
                        <span className="truncate text-xs tabular-nums text-muted">Terms checked {card.last_verified}</span>
                      </>
                    )}
                  </span>
                  <button
                    type="button"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-danger"
                    aria-label={`Remove ${name}`}
                    onClick={() => onRemove(id)}
                  >
                    <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="m4 4 8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
