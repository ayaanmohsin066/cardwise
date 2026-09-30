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
  - Nothing else from a statement is persisted.
- **Refund floor is display-only.** `spend_by_category` is floored at $0 for the summary UI only. Points and value maths use raw signed amounts (`amount_cad`, `net_by_category`), which may be negative. See `docs/decisions.md`.
- **Money:** round with `toCents()` / `roundCents()` (`money.ts`), never `Math.round(x * 100)`.
- **Network:** `tests/rules/` fails if anything in `src/` calls `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` or `EventSource`. `src/app/lib/catalog.ts` is `server-only`; it reads only card and issuer JSON.
- **Dev mode:** FAKE fixture cards appear in the card picker only under `next dev`. Production builds show "No verified cards yet" until real cards exist.

## Commands

- `npm run dev`: dev server
- `npm test`: Vitest
- `npm run lint`: ESLint
- `npm run typecheck`: `tsc --noEmit`
- `npm run build`: production build
