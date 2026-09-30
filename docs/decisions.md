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
