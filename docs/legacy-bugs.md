# Legacy bugs to guard against

These are the four bugs found in `legacy/app.py` (see `docs/cardopt-audit.md`).
None of the logic they affect exists in the new app yet. Each one becomes a
Vitest regression test in the phase that builds that logic, so the rebuild
can't repeat it.

| # | bug | legacy location | regression test lands in |
|---|---|---|---|
| 1 | After-cap rate hard-coded to 1× | `solve()`: `Z[i,j]` objective coefficient is `-cpp/100` | **Phase 3** (benefits) |
| 2 | Refunds ignored instead of netted | `build_spending_profile()`: `if amount<=0: continue` | **Phase 2** (ingest/categorize) |
| 3 | Loose keyword matching | `classify_transaction()` and the `*_KEYWORDS` tuples | **Phase 2** (ingest/categorize) |
| 4 | Robustness score counts the base case | `robustness_analysis()`: `run("Base", ...)` goes into the score | **Phase 4** (optimizer analysis) |

## 1. After-cap rate hard-coded to 1× (Phase 3)

**Legacy behaviour:** spend above a category cap (`Z[i,j]`) always earns 1×,
whatever the card's real post-cap rate is.

**Required:** post-cap spend earns the earn rule's `after_cap_rate`, falling
back to the card's `base_rate`. If both are `null`, the result is marked
unverified. It must not assume a rate. When several rules share one cap
(`cap_id`), each rule's spend above the shared cap earns that rule's own
`after_cap_rate`.

**Test:** using `fake-grocery-cash` (groceries + dining 5 pts/$1, sharing the
$500/month `groceries-dining-monthly` cap, then 1 pt/$1, in `cash-cad`), $700
of groceries in one month earns 500 × 5 + 200 × 1 = 2,700 pts = **$27**. Add a
variant with `after_cap_rate: 2` that must give 500 × 5 + 200 × 2 = 2,900 pts =
**$29**. Legacy code would give $27 for both. Use `fake-shared-cap` for the
shared-cap case; its numbers are in `tests/fixtures/README.md`.

## 2. Refunds ignored (Phase 2)

**Legacy behaviour:** rows with `amount ≤ 0` are skipped. A $100 purchase
followed by a $100 refund counts as $100 of spend.

**Required:** refunds and credits are netted against their category. A category
total never goes below $0. Card payments and transfers are excluded, not netted.

**Test:** a +$100 grocery purchase and a −$100 grocery refund give groceries =
**$0**. A +$100 purchase and a −$30 refund give **$70**. A credit-card payment
row changes no category.

## 3. Loose keyword matching (Phase 2)

**Legacy behaviour:** keywords are matched as substrings. `"united"` matches any
merchant containing that word, `"bar"` matches any category code containing
BAR, and so on.

**Required:** `src/data/merchant_rules.json` rules match on word boundaries,
after normalizing case and punctuation.

**Test:** a rule for "united" does not match "UNITED WAY DONATION" when the rule
is scoped to airlines. A "bar" keyword does not match "BARBER SHOP". A "shell"
rule matches "SHELL C12345" but not "SHELLFISH MARKET".

## 4. Robustness score counts the base case (Phase 4)

**Legacy behaviour:** the Base scenario is one of the 21 scenarios in the score.
It always matches itself, so the score can never go below about 5%.

**Required:** the score is the share of *perturbed* scenarios whose wallet
matches the base wallet. The base case is not counted.

**Test:** with a spend profile where every perturbed scenario changes the
wallet, the score is **0%**, not 1/21.
