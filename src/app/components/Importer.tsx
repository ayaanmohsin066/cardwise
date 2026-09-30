"use client";

import { useMemo, useState } from "react";
import {
  categorizeAll,
  classifyStatementCredits,
  computeBenefits,
  type BenefitsReport,
  type CategorizedTransaction,
  type Overrides,
  type Program,
  type Transaction,
} from "@/engine";
import type { Catalog, CardOption } from "../lib/catalog";
import { loadOverrides, saveOverrides } from "../lib/overrides-storage";
import { MERCHANT_RULES } from "../lib/rules";
import { BenefitsPanel, type BenefitsSettings } from "./BenefitsPanel";
import { CardPicker, MAX_CARDS } from "./CardPicker";
import { CardStatement } from "./CardStatement";
import { CombinedSummary } from "./CombinedSummary";
import { EarnMore } from "./EarnMore";

/** Per-card state. Held only in memory; overrides are also saved to localStorage. */
interface CardState {
  /** Fixed chart color slot (1-3), so a card keeps its color when others are removed. */
  slot: number;
  transactions: Transaction[] | null;
  overrides: Overrides;
  saveFailed: boolean;
  settings: BenefitsSettings;
}

export interface CardReport {
  option: CardOption;
  program: Program | null;
  slot: number;
  items: CategorizedTransaction[];
  report: BenefitsReport;
  /** Refund id -> statement line of the matched purchase, or null if unmatched. */
  refundMatches: ReadonlyMap<string, number | null>;
}

export function Importer({ catalog }: { catalog: Catalog }) {
  const [order, setOrder] = useState<string[]>([]);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const cardsById = useMemo(() => new Map(catalog.cards.map((c) => [c.id, c])), [catalog.cards]);
  const issuerName = (id: string) => catalog.issuers.find((i) => i.id === id)?.name ?? id;
  const programFor = (o: CardOption) => (o.card.program_id ? catalog.programs[o.card.program_id] ?? null : null);

  function addCard(id: string) {
    if (order.includes(id) || order.length >= MAX_CARDS) return;
    const used = new Set(Object.values(cards).map((c) => c.slot));
    const slot = [1, 2, 3].find((s) => !used.has(s)) ?? 1;
    // Runs in a click handler, so reading localStorage here is safe.
    setCards((c) => ({
      ...c,
      [id]: {
        slot,
        transactions: null,
        overrides: loadOverrides(id),
        saveFailed: false,
        settings: { redemption_method: null, open_date: "" },
      },
    }));
    setOrder((o) => [...o, id]);
  }

  function removeCard(id: string) {
    setOrder((o) => o.filter((x) => x !== id));
    setCards((c) => {
      const next = { ...c };
      delete next[id];
      return next;
    });
  }

  const update = (id: string, patch: Partial<CardState>) =>
    setCards((c) => (c[id] ? { ...c, [id]: { ...c[id], ...patch } } : c));
  const setOverrides = (id: string, overrides: Overrides) =>
    update(id, { overrides, saveFailed: !saveOverrides(id, overrides) });

  // Everything is derived in the browser from state; nothing is sent anywhere.
  const reports = useMemo(() => {
    const out: Record<string, CardReport> = {};
    for (const [id, st] of Object.entries(cards)) {
      const option = cardsById.get(id);
      if (!option || !st.transactions) continue;
      // Issuer statement-credit lines become kind "credit" before categorizing (no double count).
      const items = categorizeAll(classifyStatementCredits(option.card, st.transactions), MERCHANT_RULES, st.overrides);
      const program = option.card.program_id ? catalog.programs[option.card.program_id] ?? null : null;
      const report = computeBenefits({
        card: option.card,
        program,
        items,
        redemption_method: st.settings.redemption_method,
        open_date: st.settings.open_date || null,
      });
      const lineOf = new Map(items.map((i) => [i.transaction.id, i.transaction.statement_line]));
      const refundMatches = new Map(
        report.transactions
          .filter((t) => t.refund_confidence !== null)
          .map((t) => [t.transaction.id, t.matched_purchase_id ? lineOf.get(t.matched_purchase_id) ?? null : null] as const),
      );
      out[id] = { option, program, slot: st.slot, items, report, refundMatches };
    }
    return out;
  }, [cards, cardsById, catalog.programs]);

  const combined = order.filter((id) => reports[id]).map((id) => reports[id]);

  return (
    <div className="flex flex-col gap-8">
      <CardPicker catalog={catalog} selected={order} onAdd={addCard} onRemove={removeCard} />
      {order.map((id) => {
        const option = cardsById.get(id);
        const st = cards[id];
        if (!option || !st) return null;
        const r = reports[id];
        return (
          <div key={id} className="flex flex-col gap-4">
            <CardStatement
              card={option}
              issuerName={issuerName(option.issuer)}
              hasTransactions={st.transactions !== null}
              onTransactions={(t) => update(id, { transactions: t })}
              categorized={r?.items ?? []}
              overrides={st.overrides}
              onOverrides={(o) => setOverrides(id, o)}
              saveFailed={st.saveFailed}
              refundMatches={r?.refundMatches}
            />
            {r && (
              <BenefitsPanel
                data={r}
                program={programFor(option)}
                settings={st.settings}
                onSettings={(settings) => update(id, { settings })}
                overrides={st.overrides}
                onOverrides={(o) => setOverrides(id, o)}
              />
            )}
          </div>
        );
      })}
      {combined.length > 1 && <CombinedSummary reports={combined} />}
      {(catalog.empty || combined.length > 0) && <EarnMore catalog={catalog} reports={combined} version={reports} />}
      <p className="text-xs text-muted">
        Privacy: statements are processed only in this browser. Category corrections you make are
        saved in this browser&apos;s local storage (merchant name and category only) and are never
        sent anywhere.
      </p>
    </div>
  );
}
