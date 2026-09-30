# Test fixtures: FAKE data

Everything in this folder is invented for tests. None of it describes a real
card, issuer or program. The issuer `fake-bank` is deliberately **not** in
`src/data/issuers.json`, and every URL is on `example.com`.

All rates are **points per $1**. The cashback fixtures use the built-in
`cash-cad` program in `src/data/programs/` (1 point = 1¢), so 2% back is written
as rate 2.

The numbers are round so that expected results can be worked out by hand:

| card | type | program | fee | base | earn rules (pts/$1) | caps |
|---|---|---|---|---|---|---|
| `fake-flat-cash` | cashback | `cash-cad` | $0 | 2 | none | none |
| `fake-grocery-cash` | cashback | `cash-cad` | $100 | 1 | groceries + dining 5, then 1 | `groceries-dining-monthly`: $500/month |
| `fake-points` | points | `fake-points-program` | $120 (first year $0) | 1 | travel 3 (`cap_id: "none"`, uncapped); gas + transit 2 (`cap_id: null`, **not yet verified**) | none |
| `fake-shared-cap` | cashback | `cash-cad` | $0 | 1 | groceries 4, then 1; dining 2, then 1; **both share one cap** | `combined-monthly`: $1,000/month |

`fake-points` lists two FAKE perks: lounge access (requires enrollment; conditions and `requires_charge_to_card` not verified) and trip cancellation (`requires_charge_to_card: true`). `fake-grocery-cash`'s extended warranty also has `requires_charge_to_card: true`. `fake-points` also has one purchase credit: $100/year at merchants matching "fake air" or "fake hotels". The issuer posts it as a line containing "fake travel credit" (`statement_keywords`).

`fake-points-program` redeems at 1.0¢ per point (`statement_credit`, fixed) or
2.0¢ (`travel_transfer`, estimate).

Welcome bonuses are also in program points. `fake-grocery-cash` gives 10,000
`cash-cad` points ($100) after $1,000 of spend in 3 months.

## Worked numbers

### `valuePerDollar`

| rate | program / method | $ per $1 |
|---|---|---|
| 2 | `cash-cad` / `cash` | 0.02 |
| 3 | `fake-points-program` / `statement_credit` | 0.03 |
| 3 | `fake-points-program` / `travel_transfer` | 0.06 |

### `fake-shared-cap` in one month

The groceries rule (4 pts/$1) and the dining rule (2 pts/$1) draw on the same
$1,000/month cap. Spend above the cap earns each rule's `after_cap_rate` (1).

**A. Under the cap: $300 groceries + $500 dining = $800.**
All spend earns the bonus rates:
300 × 4 + 500 × 2 = 1,200 + 1,000 = **2,200 pts = $22.00**

**B. Over the cap: $600 groceries + $600 dining = $1,200, which is $200 over.**
Only $1,000 earns bonus rates. The result depends on which purchases use up the
cap first. These two rows are **illustrative extremes, not expected results**:

| order (example only) | bonus spend | after-cap spend | points | value |
|---|---|---|---|---|
| all groceries first | 600 × 4 + 400 × 2 = 3,200 | 200 dining × 1 = 200 | 3,400 | $34.00 |
| all dining first | 600 × 2 + 400 × 4 = 2,800 | 200 groceries × 1 = 200 | 3,000 | $30.00 |

The Phase 3 calculator applies caps in **posting order**: by date, then by
statement order (see `docs/decisions.md`). Its result for B depends on the
transaction dates and always lands between these two. $34.00 is also the
figure the Phase 4 LP upper bound would give.

If each rule had its **own** $1,000 cap instead, B would be 600 × 4 + 600 × 2 =
3,600 pts = $36.00.

**C. Dated sequence (the expected Phase 3 result).**
`transactions/fake-shared-cap-2026-01.json` holds real `Transaction` records
(see `src/engine/transaction-schema.ts`) in statement order. The LOBLAWS lines
categorize as groceries and the TIM HORTONS lines as dining through
`src/data/merchant_rules.json`, giving the same totals as B ($600 groceries +
$600 dining), spread across January 2026:

| line | date | category | amount | cap used before | at bonus rate | after cap | points | cap used after |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-01-03 | dining | $200 | $0 | 200 × 2 | — | 400 | $200 |
| 2 | 2026-01-05 | groceries | $400 | $200 | 400 × 4 | — | 1,600 | $600 |
| 3 | 2026-01-12 | dining | $300 | $600 | 300 × 2 | — | 600 | $900 |
| 4 | 2026-01-12 | groceries | $150 | $900 | 100 × 4 | 50 × 1 | 450 | $1,000 |
| 5 | 2026-01-20 | dining | $100 | $1,000 | — | 100 × 1 | 100 | $1,000 |
| 6 | 2026-01-25 | groceries | $50 | $1,000 | — | 50 × 1 | 50 | $1,000 |
| | | | **$1,200** | | | | **3,200** | |

Expected result: **3,200 pts = $32.00**.

Lines 3 and 4 have the same date, so statement order decides that dining comes
first. If that tie-break were reversed (groceries before dining on 2026-01-12),
the result would be 400 + 1,600 + 600 (150 × 4) + 550 (250 × 2 + 50 × 1) + 100
+ 50 = 3,300 pts = $33.00. A Phase 3 test should assert $32.00, which proves
the tie-break uses statement order.

## Statements (`statements/`)

FAKE CSV exports for the ingest and categorize tests. The column layouts are
invented for testing and are **not** real bank formats. Real bank presets wait
for real sample exports. `tests/helpers/statements.ts` has the mapping for each
file.

| file | layout | covers |
|---|---|---|
| `amount-currency.csv` | one signed amount column (purchases positive), currency column, YYYY-MM-DD | purchases, partial and full refunds, payment, annual fee, interest, a USD purchase (high-confidence FX), `UNITED FARMERS CO-OP` vs `UNITED AIRLINES`, `SHELL` vs `SHELLFISH`, `UBER EATS` vs `UBER`, a quoted comma |
| `debit-credit.csv` | debit and credit columns, MM/DD/YYYY, no FX column | refund as a credit, payment, cash-back redemption (not a refund), foreign transaction fee, a EUR purchase (low-confidence FX from the description), a bad date row and a bad amount row |
| `fake-shared-cap-2026-01.csv` | same layout as `amount-currency.csv` | the shared-cap sequence from example C as a CSV. Ingests to exactly `transactions/fake-shared-cap-2026-01.json`; upload it on `fake-shared-cap` in dev to see 3,200 points = $32.00 |
| `phase3-walkthrough.csv` | same layout as `amount-currency.csv`; for `fake-points` | a statement-credit line (FAKE TRAVEL CREDIT), interest, a matched refund (AIR CANADA) and an unmatched one (EXPEDIA). Points: exact 471.14, per line 470, per statement 471, so "471" matches only with per-statement rounding. Pinned in `tests/engine/walkthrough.test.ts` |
| `phase5-perks.csv` | same layout as `amount-currency.csv` | an electronics purchase (BEST BUY), a flight, a FAKE AIR purchase (credit) and groceries, for the Perks and Redeem tabs |
| `fr-headerless.csv` | no header, `;` delimiter, DD/MM/YYYY, decimal comma, purchases negative | French and accented text (`ÉPICERIE`, `INTÉRÊTS`, `FRAIS ANNUELS`, `PAIEMENT MERCI`), a refund written as a positive number, space-separated thousands |

