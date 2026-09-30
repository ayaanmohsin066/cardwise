# CardOpt

CardOpt helps people in Canada pick the credit cards that fit how they actually
spend. You upload a card statement (CSV) and CardOpt sorts each purchase into a
spending category. It then works out which combination of Canadian cards gives
you the most value after annual fees, and which card to use for each category.
It also explains the trade-offs: what each card adds, what you give up by
choosing a different card, and how sensitive the answer is to your assumptions.

All amounts are in Canadian dollars.

> **Status:** redesign in progress. Statement import and categorization work; card recommendations come in later phases.

## Built on CardOpt by @srinihal007

This project is a redesign of [CardOpt](https://github.com/srinihal007/cardopt) by
**@srinihal007**, a Python/Streamlit credit card portfolio optimizer. It is used
with his permission. The original code is kept in [`legacy/`](legacy/), and
[`docs/cardopt-audit.md`](docs/cardopt-audit.md) documents how its model works.

## Privacy

- **Your statements never leave your browser.** CSV files are read and processed on your device. There is no server endpoint that receives transaction data, and the app makes no network requests with it.
- **No analytics or tracking** runs on your transactions, merchants or spending totals.
- **Nothing from your statement is saved,** except the category corrections you make. Those are stored in your own browser's local storage as merchant name → category (no amounts or dates). You can clear them from the card's panel at any time. Everything else is gone when you close the tab.

## Card data

Card terms come from each issuer's official page. Every card file records its
`source_url` and a `last_verified` date. If a term hasn't been verified yet, the
app shows it as **"not yet verified"** and never guesses. Terms change, so check
the issuer's page before you apply.

CardOpt is an educational tool, not financial advice.

## Development

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # Vitest
npm run lint
npm run typecheck
```

The project rules are in [`CLAUDE.md`](CLAUDE.md).
