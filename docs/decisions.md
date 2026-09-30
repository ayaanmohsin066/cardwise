# Decisions

Design decisions that affect how the engine computes values. Each entry records
what was decided and why, so later phases don't reopen it.

## Shared caps: posting order (decided Phase 1.1)

**Benefits/audit (Phase 3)** applies caps in **posting order**: by transaction
date, then by statement order for purchases on the same date. This matches how
issuers apply caps, so our numbers reconcile with the user's statements.

**Recommendations (Phase 4)** work in two steps:

1. The LP decides **card routing only**, meaning which card to use for which
   category.
2. The chosen routing is then **re-scored by replaying the user's real
   transactions** through the Phase 3 posting-order calculator. **That replayed
   value is what the UI shows.**

The LP objective is an **upper bound**. It allocates capped spend to the
highest-rate rule first, which real posting order may not do. It is used to
rank routings, never shown as the user's value.

Worked numbers for both cases are in `tests/fixtures/README.md` (`fake-shared-cap`).

## Refunds: display floor vs. points (decided Phase 2)

Flooring an over-refunded category at $0 applies **only to the spending summary
display** (`StatementSummary.spend_by_category`). The UI floors because a
negative "spending" figure would confuse people, and it flags the category in
`over_refunded` instead.

**The points engine (Phase 3) uses raw signed amounts** (`Transaction.amount_cad`,
or `StatementSummary.net_by_category` for totals):

- A refund reduces points **in the period it posts**. That includes refunds of
  purchases from a previous statement.
- A category's net points for a period **may be negative**. Never floor them.
- Nothing downstream of the display may use `spend_by_category` for maths;
  it is display-only.

This matches how issuers claw back points on refunds, and it keeps multi-period
totals correct. A refund in March for a February purchase nets to zero across
both months.

Example: with `fake-grocery-cash` (groceries 5 pts/$1 in `cash-cad`), a $20
grocery purchase and a −$50 grocery refund in the same period:

- the display shows groceries **$0.00**, flagged as over-refunded;
- the points engine records a net of −$30, which is **−150 pts** for that
  period, assuming no cap interaction.

## Benefits engine rules (Phase 3, reviewed 2026-09-30)

All reviewed. They are implemented in `src/engine/points.ts`, `benefits.ts`,
`credits.ts` and `reconcile.ts`, with tests.

1. **Refunds are matched to a purchase first** (revised in review).
   - A refund is matched to an earlier purchase on the same card: same merchant
     (normalized with `overrideKey`), with at least the refund amount still
     refundable, most recent first.
   - A matched refund reverses **that purchase's** after-cap part, then its
     bonus part, at the rates that purchase earned. It releases cap room in the
     purchase's own period. The points are still reduced on the refund's line,
     in the period the refund posts.
   - Partial refunds draw down the same purchase until it is used up.
   - An **unmatched** refund (`refund_confidence: "low"`) uses the period order:
     the rule's after-cap spend first, then bonus spend (freeing cap room),
     then negative at the bonus rate.
2. **An unverified `after_cap_rate` never falls back to `base_rate`.** Spend
   above the cap is reported as unverified and left out of totals. The cap
   portion still counts. *(Accepted.)*
3. **Cap and credit periods are calendar periods** (month, quarter or year of
   the transaction date). *(Accepted.)* **Future schema field:** periods that
   follow the statement cycle or the card anniversary need a new card field
   (e.g. `period_basis: "calendar" | "statement_cycle" | "anniversary"`),
   verified from issuer terms, plus the cycle or open date as input. Until
   then, calendar periods are used and no other basis is guessed.
4. **Statement credits** (revised in review).
   - Purchase credits gained a verified field, `statement_keywords`: the text of
     the issuer's own credit line.
   - `classifyStatementCredits()` turns matching credit-side lines into kind
     **"credit"**. These are excluded from category spend and points and counted
     only as credit used (`method: "posted"`). With no posted line, credit used
     is estimated from eligible spend at `merchant_keywords` merchants
     (`method: "estimated"`). The two are never added together.
   - `merchant_keywords` are not used to find credit lines, because a genuine
     merchant refund would match them too.
   - `statement_keywords: null` means credit lines can't be recognised; that is
     listed as unverified.
5. **FX:** if any separately posted FX-fee line exists, those lines are the FX
   cost and nothing is estimated. Otherwise the embedded fee is
   `amount × fee / (1 + fee)`, labelled as an estimate. `fx_fee_pct: null` means
   unverified; it is never treated as 0. *(Accepted.)*
6. **Annual fee** *(accepted)*:
   - It's prorated by `months_covered` = the statement day span ÷ 30.44,
     rounded, minimum 1.
   - The first-year fee applies when the statements start within 12 months of
     the optional open date.
   - The full amount is shown separately.
   - Posted fee lines are shown for reference only and are not subtracted, so
     there's no double count.
   - **Interest charged is shown prominently in the benefits panel, separate
     from, and never part of, net rewards value.**
7. **Net value** is rewards + credits − prorated annual fee − FX cost, using
   verified parts only. `net_value_excludes` names every part left out.
   *(Accepted.)*
8. **Redemption method:** by default, the program's first non-estimate method.
   Choosing an estimate method marks the value as an estimate.
   `pointsFromDollars()` (the inverse, built on `valuePerDollar()`) only reads a
   cash-back statement total into points for reconcile. *(Accepted.)*
9. **Reconcile** (revised in review).
   - Totals are computed exact, **per-transaction rounded** and
     **per-statement rounded** (`roundPoints`: whole points, halves away from
     zero).
   - If the statement equals either rounded total exactly, it's a match. The
     mode is returned and saved per card in localStorage
     (`cardopt:rounding:<card>`). Next time the saved mode is tried first and
     used for the suggestion search.
   - Only if neither mode matches does the old tolerance apply: 0.5 points per
     spend line, at least 1.
   - Suggestions: only low-confidence purchase and refund lines, moved only to
     categories with a different verified rate. It keeps the better of a greedy
     pass and an exhaustive search over subsets of up to 5 of the top 15, capped
     at 20,000 evaluations. Accepting one saves an override.
10. **Welcome bonus progress** counts net purchases from the open date up to,
    but not including, `open_date + window_months`, from uploaded statements
    only. **The UI labels it an estimate.** *(Accepted.)*
11. **Combined totals** add dollars across cards. Points from different programs
    are never summed.

## Earn more: routing and recommendations (Phase 4, reviewed 2026-09-30)

All reviewed. Implemented in `src/engine/lp.ts`, `optimize.ts`, `policy.ts`,
`recommend.ts` and `bruteforce.ts`, with tests. Rules 1, 3, 5, 6, 7 and 8 were
accepted as written; 2 and 4 were accepted with the changes noted.

1. **Solver.** HiGHS (npm `highs`, WebAssembly) behind an `LpSolver`
   interface. The engine never loads it.
   - The browser loads the binary once from `/solver/highs.wasm` on our own
     origin (`src/app/lib/solver-asset.ts`, the only network exception). It
     compiles the binary and hands it over through `instantiateWasm`, so HiGHS
     doesn't fetch anything itself.
   - `Content-Security-Policy: connect-src 'self'` blocks every other origin.
2. **LP model.**
   - Demand is net spend per category × calendar month × domestic/foreign
     (raw signed; a net-negative cell has no demand to route).
   - Each card offers its bonus tier, its after-cap tier or an uncapped rate.
     Bonus tiers sharing a cap are limited per cap period.
   - The objective is the value through `valuePerDollar()`, minus the FX cost
     `f/(1+f)` per foreign dollar, minus prorated fees.
   - It decides routing only. Its objective is never shown.
3. **FX in routing.** Foreign spend is its own demand, so the fee changes the
   answer. It is estimated on the statement amount; the small difference from
   a different card's conversion is ignored.
4. **Purchase credits are not in the LP**, because they're merchant-level, not
   category-level. *(Accepted with a fix.)*
   - The routing policy captures them first. Purchases matching a card's
     `merchant_keywords` go to that card until the credit's limit for its
     period is used (`CreditRule`), then normal routing.
   - The policy sentence names the merchant and the credit.
   - Tested: a card whose category the LP routes elsewhere still captures its
     credit.
   - Credits are annualized only up to their yearly limit (`annualCredits`).
   - "Use your cards better" shows captured credits as their own line, so the
     category table adds up to the total.
5. **First year.**
   - Only cards the user would newly open (`is_new`) use `first_year_fee` and
     welcome bonuses. Owned cards use `annual_fee`.
   - Each new card pursues all its bonus entries or none. Every combination is
     solved (at most 8) and replayed, and the best replayed value wins.
   - The bonus window starts at the start of the data. If the data is shorter
     than the window, the requirement becomes a pace
     (`min_spend × months / window`), labelled projected.
   - A bonus counts once and is never annualized.
   - *(Accepted.)* **Not modelled yet: welcome bonuses paid in monthly
     instalments** (e.g. X points each month you spend Y). They need a future
     schema field (e.g. an instalment list on `welcome_bonus`). Until then such
     a bonus can't be represented, and it must not be approximated with the
     current fields.
6. **Policy from the LP.** For each category, the options the LP actually used
   are ordered by value: "Card A until its cap is reached, then Card B".
   - If every used option is capped, the best uncapped option is added as the
     fallback.
   - Foreign steps appear only where the category has foreign spend that
     routes differently.
   - Categories with no spend get the best available order, marked as such.
7. **Replay** (the shown value).
   - Real transactions are routed in posting order. A purchase that crosses a
     cap stays on that card, as it would in reality.
   - Refunds follow their purchase (same merchant, most recent with enough
     left). A pursued bonus card takes purchases inside its window until its
     requirement is met.
   - Each card's share is scored with `computeBenefits`.
   - Fees, interest and payment lines are left out of every replay, current
     and suggested alike. Statement-credit lines stay with their card.
8. **Annualizing.** Period value × 12 / months, with the full annual fee
   subtracted (not a cent-rounded prorated fee × 12), and credits capped at
   their yearly limit. It's labelled a projection, with a warning under 3
   months.
9. **Baselines.** "Use your cards better" compares against what the user
   actually did. "Change a card" gains compare against **the user's current
   cards used as suggested**, so routing gains aren't credited to a new card.
   *(Accepted with an addition.)* The UI also shows routing gain + card-change
   gain = total gain versus actual use (`routing_gain_annual`,
   `total_gain_annual`). Both come from the same spend pool, so they add up
   exactly (tested).
10. **Unverified terms.** A card missing any term needed for this spend and
    mode is excluded, with every reason listed. The rest are still routed. An
    excluded owned card's spend is left out of "Use your cards better".
11. **Sensitivity.** Each points program in the top 3 changes is valued at its
    lowest and highest verified value (across its redemption methods). That
    gives 2 scenarios per program with a range, and the base case is never
    counted (`rankingStability`; legacy bug 4). A program with one value adds
    no scenario.
12. **Brute force.** `bruteForceBest` enumerates grid splits (bonus tier
    first) for small cases. A property test on 40 seeded random cases checks
    the LP is never beaten.

### Phase 4.1: worker and scale

13. **Web Worker.** "Earn more" runs in `src/app/workers/recommend.worker.ts`,
    calling the pure `runRecommendations()` (`src/app/lib/run-recommendations.ts`).
    - The worker loads the solver through the same single-URL guard
      (`solver.ts` → `solver-asset.ts`).
    - Its script response carries `connect-src 'self'`, so the policy applies
      inside the worker too.
    - Progress is posted per stage. A new request, or Cancel, terminates the old
      worker; that's the only way to stop a synchronous solve.
    - Privacy tests cover the worker: it's scanned by the network rule, there is
      exactly one same-origin module worker, no other channels exist, and its
      imports are limited.
    - In the browser, a full run showed no main-thread task over 50 ms.
14. **Scale.** "Change a card" with 100 synthetic cards and 3 owned cards (300
    candidate sets, ongoing and first year) takes about 0.6 s with 120
    transactions and 0.8 s with 300, in Node (`tests/engine/benchmark.test.ts`).
    - That's well under the ~5 s threshold, so **pruning is off by default**.
    - `pruneCatalogue` exists for a larger catalogue. It keeps any card that
      beats the current best rate in a category with spend, has a welcome bonus
      or credit, or has a lower annual fee than the priciest current card.
    - Tested on three synthetic seeds: pruning never drops the best ongoing or
      first-year result.
