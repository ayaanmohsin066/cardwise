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
`transactions/fake-shared-cap-2026-01.json` has the same totals as B ($600
groceries + $600 dining), spread across January 2026:

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
