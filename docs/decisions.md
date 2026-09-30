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
