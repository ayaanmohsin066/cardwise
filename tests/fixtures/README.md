# Test fixtures: FAKE data

Everything in this folder is invented for tests. None of it describes a real
card, issuer or program. The issuer `fake-bank` is deliberately **not** in
`src/data/issuers.json`, and every URL is on `example.com`.

The numbers are round so that expected results can be worked out by hand:

| card | type | fee | base | bonus rule |
|---|---|---|---|---|
| `fake-flat-cash` | cashback | $0 | 2% | none |
| `fake-grocery-cash` | cashback | $100 | 1% | groceries + dining 5% up to $500/month, then 1% |
| `fake-points` | points (`fake-points-program`) | $120 (first year $0) | 1 pt/$ | travel 3 pts/$ uncapped; gas + transit 2 pts/$ with cap **not yet verified** (null) |

`fake-points-program` redeems at 1.0¢ per point (fixed) or 2.0¢ (estimate).
