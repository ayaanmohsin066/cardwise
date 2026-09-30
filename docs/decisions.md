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
