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
- A cap is `null` (unverified), `"none"` (verified uncapped) or `{amount, period}`.
- Rates are percent when `card_type` is `"cashback"`, and points per CAD 1 when it is `"points"`.
- Earn rules only use categories from `CATEGORIES` (`src/engine/categories.ts`). A category may appear in at most one earn rule per card.
- A card's `issuer` must be an id in `src/data/issuers.json`, and it is also the card's directory name. `program_id` must match a file in `src/data/programs/`.
- A redemption with `is_estimate: true` must explain the basis for the estimate in `notes`.
- Test fixtures live in `tests/fixtures/` and are clearly fake: the issuer is `fake-bank`, URLs are on `example.com`, and names start with "FAKE". Never put real card data there, and never put fixture data in `src/data`.
- `docs/legacy-bugs.md` lists the regression tests each future phase has to add.

## Commands

- `npm run dev`: dev server
- `npm test`: Vitest
- `npm run lint`: ESLint
- `npm run typecheck`: `tsc --noEmit`
- `npm run build`: production build
