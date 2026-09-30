import "server-only";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { validateCard, validateIssuers, validateProgram, type Card, type Issuer, type Program } from "@/engine";

/*
 * Reads card and issuer JSON from disk when the page is rendered (at build
 * time for static pages). This is catalog data only: no transaction data ever
 * reaches the server.
 */

export interface CardOption {
  id: string;
  name: string;
  issuer: string;
  network: Card["network"];
  card_type: Card["card_type"];
  last_verified: string;
  /** True for FAKE test-fixture cards, shown only in development. */
  is_fixture: boolean;
  /** The full validated card data (terms only; public catalog data). */
  card: Card;
}

export interface IssuerOption {
  id: string;
  name: string;
  tier: Issuer["tier"] | null;
}

export interface Catalog {
  issuers: IssuerOption[];
  cards: CardOption[];
  /** Points programs by id (built-in, plus FAKE fixture programs in development). */
  programs: Record<string, Program>;
  /** True when there are no verified cards and fixtures are hidden. */
  empty: boolean;
  fixtures_enabled: boolean;
}

const ROOT = process.cwd();
const FIXTURE_ISSUER: IssuerOption = { id: "fake-bank", name: "FAKE Bank (test fixtures)", tier: null };

function loadCards(dir: string, isFixture: boolean): CardOption[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => statSync(join(dir, d)).isDirectory())
    .flatMap((issuer) =>
      readdirSync(join(dir, issuer))
        .filter((f) => f.endsWith(".json"))
        .flatMap((f) => {
          const r = validateCard(JSON.parse(readFileSync(join(dir, issuer, f), "utf8")));
          // Invalid cards are rejected by tests/data; never show one.
          if (!r.ok) return [];
          const c = r.card;
          return [{
            id: c.id, name: c.name, issuer: c.issuer, network: c.network,
            card_type: c.card_type, last_verified: c.last_verified, is_fixture: isFixture, card: c,
          }];
        }),
    );
}

function loadPrograms(dir: string): Program[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      const r = validateProgram(JSON.parse(readFileSync(join(dir, f), "utf8")));
      return r.ok ? [r.program] : [];
    });
}

export function loadCatalog(): Catalog {
  const fixtures_enabled = process.env.NODE_ENV === "development";
  const issuersResult = validateIssuers(
    JSON.parse(readFileSync(join(ROOT, "src", "data", "issuers.json"), "utf8")),
  );
  const issuers: IssuerOption[] = issuersResult.ok ? issuersResult.issuers : [];
  const real = loadCards(join(ROOT, "src", "data", "cards"), false);
  const fixtures = fixtures_enabled ? loadCards(join(ROOT, "tests", "fixtures", "cards"), true) : [];
  const cards = [...real, ...fixtures];
  const programs = Object.fromEntries(
    [
      ...loadPrograms(join(ROOT, "src", "data", "programs")),
      ...(fixtures_enabled ? loadPrograms(join(ROOT, "tests", "fixtures", "programs")) : []),
    ].map((p) => [p.id, p]),
  );
  const withCards = new Set(cards.map((c) => c.issuer));
  return {
    issuers: [...issuers, ...(fixtures.length ? [FIXTURE_ISSUER] : [])].filter((i) => withCards.has(i.id)),
    cards,
    programs,
    empty: cards.length === 0,
    fixtures_enabled,
  };
}
