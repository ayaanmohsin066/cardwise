// Deterministic SYNTHETIC test data: 100 FAKE cards and a few months of FAKE
// spend, for benchmarking and pruning tests. None of it is real card data.
import { CATEGORIES, validateCard, type Card, type CardSetEntry, type CategorizedTransaction, type Category } from "@/engine";
import { fixtureCard, item, program } from "./cards";

export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

/** One synthetic FAKE card; validated like real card data. */
function syntheticCard(i: number, r: () => number): Card {
  const cashback = r() < 0.6;
  const fee = pick(r, [0, 0, 0, 39, 79, 99, 120, 139, 150]);
  const base = cashback ? pick(r, [0.5, 1, 1, 1.5, 2]) : pick(r, [1, 1, 1.25, 1.5]);
  const used = new Set<Category>();
  const rules = Array.from({ length: Math.floor(r() * 3) }, (_, k) => {
    const cats = [pick(r, CATEGORIES), pick(r, CATEGORIES)].filter((c, j, a) => a.indexOf(c) === j && !used.has(c));
    cats.forEach((c) => used.add(c));
    return { k, cats, rate: pick(r, [2, 3, 4, 5]), capped: r() < 0.5 };
  }).filter((x) => x.cats.length > 0);
  const caps = rules.filter((x) => x.capped).map((x) => ({ id: `cap-${x.k}`, amount: pick(r, [300, 500, 1000, 2500]), period: pick(r, ["month", "quarter", "year"] as const) }));
  const raw = {
    id: `synthetic-${String(i).padStart(3, "0")}`,
    name: `FAKE Synthetic Card ${i}`,
    issuer: "fake-bank",
    country: "CA",
    currency: "CAD",
    network: pick(r, ["visa", "mastercard", "amex"] as const),
    card_type: cashback ? "cashback" : "points",
    program_id: cashback ? "cash-cad" : "fake-points-program",
    annual_fee: fee,
    first_year_fee: r() < 0.3 ? 0 : fee,
    fx_fee_pct: pick(r, [2.5, 2.5, 0]),
    base_rate: base,
    caps,
    earn_rules: rules.map((x) => ({ categories: x.cats, rate: x.rate, cap_id: x.capped ? `cap-${x.k}` : "none", after_cap_rate: x.capped ? base : null })),
    welcome_bonus: r() < 0.3
      ? [{ points_or_cash: cashback ? pick(r, [5000, 10000, 20000]) : pick(r, [10000, 30000, 60000]), min_spend: pick(r, [500, 1000, 3000]), window_months: 3 }]
      : [],
    purchase_credits: r() < 0.15
      ? [{ description: `FAKE: $${pick(r, [50, 100, 150])} travel credit`, merchant_keywords: ["fake air"], statement_keywords: ["fake credit"], amount: pick(r, [50, 100, 150]), period: "year" }]
      : [],
    perks: [],
    source_url: `https://example.com/fake-bank/synthetic-${i}`,
    last_verified: "2026-01-01",
  };
  const v = validateCard(raw);
  if (!v.ok) throw new Error(`synthetic card ${i}: ${v.errors.join(", ")}`);
  return v.card;
}

export function syntheticCatalogue(n = 100, seed = 1): CardSetEntry[] {
  const r = rng(seed);
  const cash = program("cash-cad");
  const pts = program("fake-points-program");
  return Array.from({ length: n }, (_, i) => {
    const card = syntheticCard(i, r);
    return { card, program: card.program_id === "cash-cad" ? cash : pts };
  });
}

const MERCHANTS: Record<Category, string> = {
  groceries: "LOBLAWS", dining: "TIM HORTONS", gas: "SHELL", transit: "PRESTO", travel: "AIR CANADA",
  streaming: "NETFLIX", drugstore: "SHOPPERS DRUG MART", recurring_bills: "ROGERS", entertainment: "CINEPLEX",
  home_improvement: "HOME DEPOT", online_shopping: "AMAZON", other: "CORNER STORE",
};

/** Three owned fixture cards and ~3 months of FAKE spend split across them. */
export function syntheticOwned(seed = 7, perMonth = 40): { owned: CardSetEntry[]; itemsByCard: Map<string, CategorizedTransaction[]> } {
  const r = rng(seed);
  const cash = program("cash-cad");
  const owned = ["fake-flat-cash", "fake-grocery-cash", "fake-shared-cap"].map((id) => ({ card: fixtureCard(id), program: cash }));
  const itemsByCard = new Map<string, CategorizedTransaction[]>(owned.map((o) => [o.card.id, []]));
  for (const month of ["2026-01", "2026-02", "2026-03"]) {
    for (let k = 0; k < perMonth; k++) {
      const category = pick(r, CATEGORIES);
      const day = String(1 + Math.floor(r() * 28)).padStart(2, "0");
      const amount = Math.round((5 + r() * 200) * 100) / 100;
      const card = pick(r, owned).card.id;
      itemsByCard.get(card)!.push(item(`${month}-${day}`, category, amount, { description: `${MERCHANTS[category]} ${k}` }));
    }
  }
  return { owned, itemsByCard };
}
