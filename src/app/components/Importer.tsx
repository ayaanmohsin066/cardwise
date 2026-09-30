"use client";

import { useState } from "react";
import type { Catalog } from "../lib/catalog";
import { CardPicker, MAX_CARDS } from "./CardPicker";
import { CardStatement } from "./CardStatement";

export function Importer({ catalog }: { catalog: Catalog }) {
  const [selected, setSelected] = useState<string[]>([]);
  const cardsById = new Map(catalog.cards.map((c) => [c.id, c]));
  const issuerName = (id: string) => catalog.issuers.find((i) => i.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-8">
      <CardPicker
        catalog={catalog}
        selected={selected}
        onAdd={(id) => setSelected((s) => (s.includes(id) || s.length >= MAX_CARDS ? s : [...s, id]))}
        onRemove={(id) => setSelected((s) => s.filter((x) => x !== id))}
      />
      {selected.map((id) => {
        const card = cardsById.get(id);
        return card ? <CardStatement key={id} card={card} issuerName={issuerName(card.issuer)} /> : null;
      })}
      <p className="text-xs text-muted">
        Privacy: statements are processed only in this browser. Category corrections you make are
        saved in this browser&apos;s local storage (merchant name and category only) and are never
        sent anywhere.
      </p>
    </div>
  );
}
