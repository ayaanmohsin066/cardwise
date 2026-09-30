@AGENTS.md

# CardOpt

A Canadian credit card optimizer, built with Next.js (App Router), TypeScript,
Tailwind and Recharts, and tested with Vitest. It is a redesign of the original
Python/Streamlit CardOpt by @srinihal007, which is kept in `legacy/` for
credit and reference. `docs/cardopt-audit.md` describes what the legacy model
does.

## Layout

- `src/engine/` holds pure TypeScript logic: optimization, parsing, categorization and validation.
- `src/data/cards/<issuer>/<card-id>.json` holds one file per card, validated by `validateCard`.
- `src/data/programs/*.json` holds points programs.
- `src/data/merchant_rules.json` holds the rules that map merchants to categories.
- `src/app/` holds the UI.
- `tests/` holds the Vitest suites (`npm test`). `tests/rules/` enforces the rules below.
- `legacy/` is the original app. Don't edit it.

## Hard rules

1. **Canada only, CAD only.** Every card has `"country": "CA"` and `"currency": "CAD"`. Don't add US cards, USD amounts or FX conversion into the model.
2. **Statements are processed only in the browser.**
   - No API route (`route.ts`, `pages/api`), server action (`"use server"`), middleware/proxy or any other server code may receive transaction data.
   - Parsing and categorization run client-side, in `src/engine`, called from client components.
   - Nothing sends transaction data anywhere: no fetch/beacon, no logging to a remote service, no storage outside the user's own browser.
3. **No analytics on transaction data.** Don't add analytics, telemetry or error-reporting SDKs that could capture transactions, merchants, amounts or derived spend totals.
4. **`src/engine` never imports React or Next.** ESLint enforces this (`no-restricted-imports`), and so does `tests/rules/project-rules.test.ts`.
5. **Never invent card terms.** Rates, caps, fees, bonuses, perks and point valuations only come from the issuer's official page.
   - If a value isn't verified, it's `null`, and the UI shows **"not yet verified"**. Never guess, never fill in from memory, never "approximate".
   - A missing key is a validation error. Unknown has to be an explicit `null`.
6. **Every card JSON has `source_url` (https) and `last_verified` (YYYY-MM-DD).** `last_verified` changes only when someone has actually checked the terms against `source_url`.
7. **Every engine function has Vitest tests.** A new or changed export in `src/engine` needs tests in `tests/engine/` in the same change.

## Data schema conventions

- The Zod schemas in `src/engine/*-schema.ts` are the single source of truth. Types come from `z.infer`, so don't hand-write parallel types or validators.
- Every key is required. `null` means "not yet verified".
- A list that is `null` is unverified. A list that is `[]` has been verified to have none.
- Caps are defined once per card in `caps: [{id, amount, period}]`, and earn rules point to them with `cap_id`. That lets several rules share one cap.
  - `cap_id` is `null` (unverified), `"none"` (verified uncapped) or the id of an entry in `caps`.
  - Every `cap_id` must exist in `caps`, and every cap must be used by at least one rule.
  - Each rule keeps its own `after_cap_rate`.
- **Every rate is points per $1**, and so is every welcome-bonus amount. Cashback cards use the built-in program `cash-cad` (1 point = 1 cent), so 2% back is `rate: 2`, and a $100 cash bonus is 10000.
  - `card_type` is for display only. It never changes how a rate is read.
  - Cashback cards must use `cash-cad`, and points cards must not.
- **Only `valuePerDollar()` (`src/engine/value.ts`) converts points to dollars.** No other code may read `cents_per_point` or do its own points-to-dollars maths. `tests/rules/` enforces this.
  - All points-to-dollars conversion goes through `valuePerDollar()`; reviewers should reject any other conversion.
- Shared caps are applied in posting order (by date, then statement order). The LP value is an upper bound and is never shown to the user. See `docs/decisions.md`.
- Earn rules only use categories from `CATEGORIES` (`src/engine/categories.ts`). A category may appear in at most one earn rule per card.
- A card's `issuer` must be an id in `src/data/issuers.json`, and it is also the card's directory name. `program_id` must match a file in `src/data/programs/`.
- A redemption with `is_estimate: true` must explain the basis for the estimate in `notes`.
- Test fixtures live in `tests/fixtures/` and are clearly fake: the issuer is `fake-bank`, URLs are on `example.com`, and names start with "FAKE". Never put real card data there, and never put fixture data in `src/data`.
- `docs/legacy-bugs.md` lists the regression tests each future phase has to add.
- `docs/decisions.md` records settled design decisions. Follow them rather than reopening them.

## Statement import (Phase 2)

- **Flow:** `parseCsv` → `normalizeRows` (or `ingestCsv`) → `categorizeAll` → `summarizeStatement`, all in `src/engine`. It runs only in client components. The file is read with `File.text()` and never uploaded.
- **`Transaction`** (`transaction-schema.ts`):
  - `amount_cad` is positive for charges and negative for credits. A refund is a negative purchase: it keeps its merchant's category and reduces that category's spend, and later its points.
  - Payments, fees and interest have no category. Fees and interest are kept for the benefits report.
  - `statement_line` is the tie-break for posting order.
- **Bank presets** (`src/engine/presets/`): a preset with `verified: false` must have `mapping: null` and `format: null`. Never guess a bank's column names. A preset becomes verified only from a real sample export.
- **Categorization:**
  - Rules come from `src/data/merchant_rules.json` and are matched case-insensitively on word boundaries (`containsPhrase`), after stripping accents and punctuation.
  - The longest keyword wins. Use specific keywords ("united airlines", not "united"), and merchant names only.
  - Unmatched lines go to "other" with low confidence.
- **Overrides:** user corrections are keyed by `overrideKey()` (normalized description, with tokens containing digits dropped) and applied before rules.
  - They're stored per card in localStorage (`src/app/lib/overrides-storage.ts`) and hold only merchant key → category.
  - The only other thing persisted is the rounding mode per card (one word).
  - Nothing else from a statement is persisted.
- **Refund floor is display-only.** `spend_by_category` is floored at $0 for the summary UI only. Points and value maths use raw signed amounts (`amount_cad`, `net_by_category`), which may be negative. See `docs/decisions.md`.
- **Money:** round with `toCents()` / `roundCents()` (`money.ts`), never `Math.round(x * 100)`.
- **Network:** `tests/rules/` fails if anything in `src/` references `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` or `EventSource`, with **one exception**.
  - `src/app/lib/solver-asset.ts` may fetch exactly `/solver/highs.wasm` from our own origin, through `solverWasmUrl()`, which refuses any other URL.
  - `next.config.ts` sends `Content-Security-Policy: connect-src 'self'`.
  - Don't add other exceptions.
  - `src/app/lib/catalog.ts` is `server-only`; it reads only card and issuer JSON.
- **Dev mode:** FAKE fixture cards appear in the card picker only under `next dev`. Production builds show "No verified cards yet" until real cards exist.

## Benefits and statement check (Phase 3)

- **Points:** `earnPoints()` / `pointsEvaluator()` in `points.ts` share **one** implementation (`run`) of the points rules. Never write a second one.
  - Caps apply in posting order (date, then `statement_line`), per calendar period.
  - Refunds are raw signed amounts.
  - `null` terms produce unverified amounts, never 0.
- **Refunds** are matched to an earlier purchase (same `overrideKey` merchant, most recent with enough left) and reverse what that purchase earned. Unmatched refunds are low confidence and use the period order.
- **Statement credits:** `classifyStatementCredits()` must run before `categorizeAll` (the `Importer` does this). Lines matching a purchase credit's `statement_keywords` become kind `"credit"`: no category, no points, counted only as credit used.
- **Rounding:** `reconcile()` checks per-transaction and per-statement rounding for an exact match. The matched mode is saved per card (`src/app/lib/rounding-storage.ts`) and passed back as `rounding_mode`.
- **`computeBenefits()`** (`benefits.ts`) produces points and $ per category and per transaction, cap usage, credits, the FX estimate, fees, net value and the list of unverified items. Anything unverified is left out of totals and listed in `unverified` / `net_value_excludes`.
- **Dollars:** everything goes through `valuePerDollar()`. The value of N points is `valuePerDollar(N, program, method)`. `pointsFromDollars()` is its inverse, for reading cash-back statement totals.
- **`reconcile()`** only *suggests* category changes. The UI saves an accepted one as an override. The search is bounded by `max_evaluations`.
- **UI:** `Importer` holds all per-card state and derives reports with `useMemo`, not effects. Charts follow the dataviz rules:
  - one axis;
  - the validated colours `--series-1..3`, with each card keeping a fixed colour slot;
  - a legend, direct labels, a tooltip and a "Show as table" alternative.
- The rules in `docs/decisions.md` ("Benefits engine rules") are the spec.

## Earn more (Phase 4)

- **The engine never loads the solver.** `solveRouting(cardSet, cells, mode, solver)` takes an injected `LpSolver`.
  - The browser builds one with `src/app/lib/solver.ts`, from our own origin, handing HiGHS the compiled module through `instantiateWasm`.
  - Tests use `tests/helpers/solver.ts`.
  - `scripts/copy-solver-wasm.mjs` (run by `predev` and `prebuild`) copies the binary to `public/solver/`, which is gitignored.
- **The LP decides routing only.** Its objective (`upper_bound`) is never displayed. Values shown come from `routeTransactions` + `scoreAssignment` (replaying real transactions through `computeBenefits`).
- **Annual figures are projections.** They're labelled as such, with a warning under 3 months. Welcome bonuses are never annualized, and credits never exceed their yearly limit.
- **Sensitivity counts perturbed scenarios only** (`rankingStability`). The base case is never a scenario.
- **Credits:** the routing policy captures purchase credits first (`CreditRule`).
- **Gain breakdown:** routing gain + card-change gain = total gain versus actual use.
- **Web Worker:** "Earn more" runs in the worker (`src/app/workers/recommend.worker.ts` → `runRecommendations`). Keep heavy work off the main thread, and keep the worker's imports to the pure computation and the guarded solver loader (tested).
- **Synthetic cards:** `tests/helpers/synthetic.ts` generates FAKE catalogue cards for scale tests. Never use them outside tests.
- The rules in `docs/decisions.md` ("Earn more") are the spec.

## Redemption, perks and card entry (Phase 5)

- **Balances:** value them with `pointsValue()` (`value.ts`) only.
  - "Best" means verified and not an estimate.
  - Estimates are always labelled, with their `notes` basis.
- **Perk text is quoted verbatim** from the card JSON. Never state coverage amounts, limits or conditions that aren't there; `null` means "details not verified", with the perk's `source_url`.
- **Perk charge rule:** perks carry `requires_charge_to_card` (true/false, or `null` = unverified). The travel "charge it to this card" reminder fires only on `true`. Never infer it from `conditions` text.
- **Nudges** (`perks.ts`) are informational, not advice. Electronics and appliance merchants for nudges live in `merchant_rules.json → nudge_merchants`, as merchant names only.
- **Adding a card or program:** run `npm run new-card -- <issuer> <card-id>` (or `new-program -- <id>`), fill it in from the official page, then `npm test && npm run card-status`. The status scripts exit 1 on stale (> 180 days) or invalid data.

## Commands

- `npm run dev`: dev server
- `npm test`: Vitest
- `npm run lint`: ESLint
- `npm run typecheck`: `tsc --noEmit`
- `npm run build`: production build
- `npm run new-card -- <issuer> <card-id>` / `npm run new-program -- <program-id>`: create a skeleton
- `npm run card-status` / `npm run program-status`: null counts and staleness; exits 1 on stale or invalid data
