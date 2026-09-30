# CardOpt audit (legacy Python/Streamlit app)

This covers the original CardOpt by @srinihal007, which now lives in `legacy/`.
Everything is in one file, `legacy/app.py` (1,577 lines), backed by
`streamlit`, `numpy`, `pandas`, `scipy` (`milp`) and `requests`. Line numbers
below refer to `legacy/app.py`.

> **Scope note for the redesign:** every card, category and data source in the
> legacy app is **US-only** (US cards, `us_supermarkets`, Plaid `country_codes:["US"]`,
> US merchant keywords, USD). None of the card data carries over to the
> Canada/CAD rebuild. What carries over is the **model structure** and the
> **analysis ideas**.

---

## 1. Data model

### Categories: `CATS` (L181)

Eight fixed spending categories (key → label):

| key | label |
|---|---|
| `dining` | Dining |
| `us_supermarkets` | U.S. supermarkets |
| `airfare_direct` | Flights booked directly |
| `hotels_direct` | Hotels booked directly |
| `portal_flights` | Flights via issuer portal |
| `portal_hotels` | Hotels via issuer portal |
| `drugstores` | Drugstores |
| `other` | Everything else |

### Cards: `DB` (L187–217)

A hard-coded dict of 6 US cards: Chase Sapphire Reserve, American Express Gold,
Capital One Venture X, Citi Double Cash, Chase Freedom Unlimited, Wells Fargo
Active Cash. Each entry has:

| field | meaning |
|---|---|
| `fee` | annual fee (USD) |
| `cpp` | default cents-per-point |
| `rates` | multiplier per `CATS` key (all 8 keys always present) |
| `caps` | `{category: annual_spend_cap}`; only Amex Gold has any (`dining: 50000`, `us_supermarkets: 25000`) |
| `ann` | anniversary bonus in points (only Venture X: `10000`) |
| `auto_credit` | `None` or `{name, cap, eligible: [categories], note}`; a credit applied automatically to spend in eligible categories (Sapphire Reserve $300 on all 4 travel categories; Venture X $300 on the 2 portal categories) |
| `benefits` | list of `(name, face_value, note)` tuples for optional credits (only Amex Gold has any: 4 credits) |
| `source` | a single issuer URL |

Related constants:
- `VERIFIED = "2026-09-20"` (L180): **one** verification date shared by every card. There is no per-card date.
- `CASHLIKE` (L219): `{Citi Double Cash, Chase Freedom Unlimited, Wells Fargo Active Cash}`. These cards are exempt from point-value stress tests and from the "Keep rewards simple" cpp override.
- `DEFAULT` (L220): the default annual spend per category for manual entry ($25,000 total).

---

## 2. The optimizer: `solve()` (L494–627)

```
solve(spend, cpp, bens, maxcards, horizon, allowed_cards=None, required_cards=None,
      complexity_cost=0.0, switching_cost=0.0, existing_wallet=None, fee_overrides=None)
```

This is a mixed-integer linear program solved with `scipy.optimize.milp`, which
minimizes, so every value is negated. It uses n = 6 cards and m = 8 categories,
which gives N = 3nm + n = 150 variables.

### Decision variables

| var | index fn | domain | meaning |
|---|---|---|---|
| `X[i,j]` | `X(i,j)` | ≥ 0, continuous | spend in category j on card i that earns at the card's category rate |
| `Z[i,j]` | `Z(i,j)` | ≥ 0; ub = 0 unless j ∈ `caps[i]` | spend above the cap, earning a **hard-coded 1×** (not the card's own base rate) |
| `D[i,j]` | `D(i,j)` | ≥ 0; ub = 0 unless j ∈ `auto_credit.eligible` | spend absorbed by the automatic credit; earns no points |
| `Y[i]` | `Y(i)` | binary; ub = 0 if card not in `allowed_cards` | card i is carried |

### Objective (maximize, written as minimizing the negation)

```
max Σ_ij [ X_ij · rate_ij · cpp_i/100  +  Z_ij · 1 · cpp_i/100  +  D_ij · 1.0 ]
  − Σ_i Y_i · ( fee_i − bens_i − ann_i + choice_cost_i + 1e-5 )
```

- `fee_i` is `fee_overrides.get(card, DB[card]["fee"])`.
- `bens_i` is the user-entered dollar value of that card's optional `benefits`.
- `ann_i` is `DB[card]["ann"] · cpp_i / 100`, but only when `horizon == "Ongoing annual economics"`. Otherwise it is 0 ("First-year recurring economics").
- `choice_cost_i = complexity_cost + (−switching_cost if card ∈ existing_wallet else +switching_cost)`.
  - The code comment (L533–540) explains the linearization. Charging complexity on **every** selected card differs from charging it on "cards after the first" by a constant, and so does ±switching compared with a symmetric-difference count. Either way the optimal choice is unchanged.
- `1e-5` is a tie-breaker that favours fewer cards.
- The `D` coefficient of 1.0 values each credited dollar at face value.

### Constraints

1. **Spend conservation** (per category j): `Σ_i (X_ij + Z_ij + D_ij) = spend_j`
2. **Activation, big-M** (per card i): `Σ_j (X_ij + Z_ij + D_ij) ≤ M · Y_i`, where `M = max(Σ spend, 1)`
3. **Reward caps** (per card, per capped category): `X_ij ≤ cap_ij · Y_i`. The caps are annual spend caps.
4. **Credit cap** (per card with `auto_credit`): `Σ_{j ∈ eligible} D_ij ≤ credit.cap · Y_i`
5. **Wallet size**: `Σ_i Y_i ≤ maxcards`
6. **Required cards**: `Y_i = 1` for each card in `required_cards`

`solve()` returns `None` when the MILP is infeasible.

### Post-processing and return value

The code rebuilds the allocation from the solution:
`[category label, card, amount, rate, cpp, value, tier]`, where tier is one of
`"Reward earning"`, `"Post-cap"` or `"Covered by credit"`. It then computes:

- `gross`: reward value (X and Z)
- `credits`: dollars covered by `D`
- `benefits = manual_benefits + credits`
- `net = gross + benefits + anniversary − fees` (the "economic net value")
- `complexity_penalty = complexity_cost · max(0, |selected| − 1)`
- `changes`: the symmetric difference with `existing_wallet` if one is given, otherwise `|selected|`
- `switching_penalty = switching_cost · changes`
- `decision_utility = net − complexity_penalty − switching_penalty`
- `details`: a per-card row `{Card, Spend, Rewards, Benefits, Anniversary, Fee, Net}`

---

## 3. Spending input and CSV import/categorization

There are three sources, chosen with the "Spending data" radio (`source_mode`):
**Manual**, **CSV**, and **Plaid (Beta)**. All three end in a list of editable
per-category annual totals (`st.number_input` for each `CATS` key) that the user
can correct before optimizing.

### 3.1 `csv_to_normalized_frame(df, purchase_sign="positive")` (L420)

- Columns are discovered by the inner `find_col(*names)`. It first tries an exact match on the lowercased, stripped header. If that fails, it takes the **first header that contains any candidate as a substring**.

  | output | candidates (in order) |
  |---|---|
  | `amount` (required, otherwise `ValueError`) | `amount`, `transaction amount`, `debit` |
  | `date` | `date`, `transaction date`, `posted date`, `posting date` |
  | `merchant` | `merchant_name`, `merchant`, `description`, `name`, `memo` |
  | `primary` | `personal_finance_category.primary`, `primary category`, `primary` |
  | `detailed` | `personal_finance_category.detailed`, `detailed category`, `detailed`, `category` |
  | `plaid_confidence` | `confidence_level`, `confidence` |
  | `mcc` | `merchant_category_code`, `mcc` |

- `amount` goes through `pd.to_numeric(errors="coerce").fillna(0)` and is negated when `purchase_sign == "negative"` (the UI radio "Negative amounts").
- `date` goes through `pd.to_datetime(errors="coerce")`.
- Caveat: the substring fallback can pick the wrong column. For example, a CSV with only `Primary Category` and no detailed column would map `detailed` to `Primary Category` through the `category` candidate. There is also no handling of separate Debit/Credit columns, so a "debit" column is only used when no "amount" column exists.

### 3.2 `plaid_transactions_to_frame(transactions)` (L403)

This maps Plaid `/transactions/sync` objects to the same columns:
`merchant_name||name`, `personal_finance_category.{primary,detailed,confidence_level}`,
`merchant_category_code`, plus `payment_channel` and `transaction_id`. The last two are unused downstream.

### 3.3 `classify_transaction(primary, detailed, merchant, mcc, plaid_confidence)` (L352)

Returns `(category_key | None, confidence "High"|"Medium"|"Low"|"Excluded", reason)`.
The first matching rule wins:

1. **Excluded**: if `primary` starts with any of `EXCLUDED_PFC_PREFIXES` (`TRANSFER_`, `INCOME`, `LOAN_PAYMENTS`, `BANK_FEES`), return `None`.
2. **Issuer portal**: if the merchant contains any of `PORTAL_KEYWORDS` (`chase travel`, `capital one travel`, `amex travel`, `american express travel`, `citi travel`):
   - flight signal (`FLIGHT`/`AIR` in detailed, or `AIRLINE_KEYWORDS`) → `portal_flights`, High
   - hotel signal (`HOTEL`/`LODG`, or `HOTEL_KEYWORDS`) → `portal_hotels`, High
   - otherwise → `portal_hotels`, Medium
3. **MCC**: `MCC_MAP` covers only 6 codes. 5812/5814 → dining, 5411 → us_supermarkets, 5912 → drugstores, 4511 → airfare_direct, 7011 → hotels_direct. Result is High. The MCC string is cleaned with `.replace(".0","")`.
4. **Heuristic cascade**, where "detailed" is the Plaid detailed PFC and keyword lists are matched as substrings of the lowercased merchant:
   - `GROC`/`SUPERMARKET` in detailed, or `GROCERY_KEYWORDS` → `us_supermarkets`
   - `RESTAURANT`/`FAST_FOOD`/`COFFEE`/`BAR` in detailed → `dining`
   - `primary == FOOD_AND_DRINK`, or `DINING_KEYWORDS` → `dining`
   - `PHARM` in detailed, or `DRUGSTORE_KEYWORDS` → `drugstores`
   - `FLIGHT`/`AIRLINE` in detailed, or `AIRLINE_KEYWORDS` → `airfare_direct`
   - `HOTEL`/`LODG` in detailed, or `HOTEL_KEYWORDS` → `hotels_direct`
   - else `other`
5. **Confidence for step 4**: when a Plaid `confidence_level` is present, it is mapped (VERY_HIGH/HIGH → High, MEDIUM → Medium, LOW/UNKNOWN → Low). Without one, the result is Medium unless the category is `other`, which is Low. This Plaid confidence describes Plaid's own category and is applied even when the CardOpt category came from a keyword match.

Caveats worth fixing in the rebuild:
- Keyword substrings are loose. `"united"` matches any merchant containing "united" (not only United Airlines), `"bar"` matches any detailed code containing BAR, and `"acme"` and `"giant food"` are similar.
- A merchant with Plaid primary `FOOD_AND_DRINK` but an unrecognized detailed code becomes dining, even for groceries that Plaid didn't tag as GROC.
- Rule order is hard-coded in Python. Rules are not data.

### 3.4 `build_spending_profile(df, annualize=False)` (L452)

- It skips rows with `amount ≤ 0`, so refunds and credits are **ignored, not netted**. It also skips rows that classify as `None`.
- It returns `(spend: {cat: total}, mapped: DataFrame, stats)`, where `stats = {rows, mapped, low, days, factor}`.
- `days` is the span from min to max date across **all** rows, including excluded ones.
- Annualization: when `annualize` is set and `30 ≤ days < 330`, every category is multiplied by `365/days`. Otherwise it uses `factor = 1`.
- The UI shows the count of mapped purchases, the history window, the number of low-confidence rows, and an expander with each row's category, confidence and reason.

### 3.5 Plaid (server-side)

The Plaid helpers are `safe_secret`, `plaid_is_configured`, `plaid_base_url`,
`plaid_post`, `create_plaid_hosted_link` (Hosted Link, `days_requested: 365`,
US only), `get_public_tokens_from_link`, `exchange_public_token` and
`sync_plaid_transactions` (up to 20 pages of 500). Access tokens, cursors and
transactions are kept in `st.session_state`. All of this runs on the Streamlit
server.

> The CSV path also runs server-side, because Streamlit uploads the file to the
> server. **Both paths conflict with the new rule that statements are processed
> only in the browser.** The rebuild drops Plaid and parses CSVs client-side.

---

## 4. Preference transforms applied before `solve()` (L1275–1306)

- **Annual fees**: "No annual-fee cards only" filters `allowed_cards` to cards with `fee == 0`.
- **Travel portals**: "I prefer booking direct" moves `portal_flights` into `airfare_direct` and `portal_hotels` into `hotels_direct`, then zeroes the portal categories.
- **Reward style**: "Keep rewards simple" sets `cpp = 1.0` for every non-`CASHLIKE` card. This silently overrides the user's cpp inputs.
- **Sidebar**: `maxcards` slider (1–6, default 3); `benchmark` flat cash-back % (default 2.0); `horizon` ("Ongoing annual economics" / "First-year recurring economics").
- **Benefits tab**: one slider per optional benefit, from $0 to face value, **default $0**.
- **Reward assumptions tab**: cpp per card, from 0.50 to 3.00¢.
- **Economics tab (Advanced only)**: `complexity_cost` and `switching_cost` ($0–500), and `macro_spend_shock` (−20% to +20%).

---

## 5. Analysis features

Every feature below re-runs `solve()` with modified inputs. All of them pass
the same complexity, switching and existing-wallet parameters through.

| feature | function | method |
|---|---|---|
| **Recommendation** | `solve` | Shows the selected cards, an allocation table, net value, net-value rate (`net/total`), and the advantage over the flat `total · benchmark` baseline. |
| **Current-wallet compare** ("CardOpt Compare") | `solve(..., allowed_cards=current, required_cards=current, maxcards=len(current))` | Compares economic net and decision utility against your current cards. |
| **Marginal value** | `marginal_card_value` (L647) | For each selected card, re-solves without it. Marginal value = `base.decision_utility − without.decision_utility`. |
| **Opportunity cost** ("Why not another card?") | `forced_alternative_analysis` (L663) | For each omitted allowed card, re-solves with `required_cards=[card]`. Opportunity cost = `base − forced`, sorted ascending. Used in both Simple and Advanced. |
| **Diminishing returns / wallet frontier** | `portfolio_frontier` (L629) | Solves for `maxcards = 1..len(DB)` and reports net, decision utility, marginal utility over k−1, and the wallet. |
| **Fee decision boundaries** | `fee_decision_boundaries` (L709) | *Selected card:* if still selected at fee + $2,000, reports "Fee headroom". Otherwise it bisects 10 times between the current fee and +$2,000 to find the "Approx. max annual fee". *Omitted card with fee > 0:* if it is selected at a $0 fee, it bisects 10 times on [0, fee] to find the "Approx. entry fee". No-fee omitted cards are skipped. |
| **Robustness** | `robustness_analysis` (L679) | Deterministic scenarios: Base; points ±25% (`CASHLIKE` excluded, floored at 0.5¢); benefits −30%/+20% (capped at face value); each of the 8 categories ±20%. That is 21 scenarios. Score = % of scenarios whose wallet equals the base wallet. **Note:** the Base scenario is always identical to itself, so the score cannot go below 1/21 ≈ 5%, which inflates it slightly. |
| **Macroeconomic lens** | inline, via `solve` | Multiplies every category by `1 + macro_spend_shock/100` and reports the value change and whether the wallet changes. |
| **Economic bridge** | inline | A table and horizontal bar chart: reward value, benefits/credits, anniversary, −fees, net, and optionally −complexity, −switching and decision utility. |
| **Assumption audit** | inline | Shows cpp, user-valued benefits and fee for each selected card. |
| **Exports** | `st.download_button` ×2 | A plain-text decision summary and an allocation CSV. |

**Simple vs Advanced mode:** Simple shows the recommendation, a per-card list,
a "where to use each card" table and "Why not another card?". Advanced adds
everything in the table above.

**Content pages:** these are static text with no computation. They are Home
(mode picker), How It Works, Cards (renders `DB`), Research, Learn (four tabs,
including a rule-based "Build Your Wallet" quiz), Math & Model, and About.

---

## 6. Other observations

- `legacy/README.md` mentions regression tests and a daily GitHub Action "source monitor". **Neither exists in this repo.** There is no test file and no `.github/` directory.
- There is no per-card `last_verified`, and one `source` URL covers every term on a card.
- Welcome bonuses, APR, approval odds, taxes and FX fees are explicitly out of scope (README "Scope and limitations").
- `money()` formats as `$x,xxx` with no currency code.
- Around 180 lines of `app.py` are inline CSS (L15–177).

## 7. What to carry into the rebuild

- **Keep:** the MILP structure (X/Z/D/Y, big-M activation, caps, credit pools, wallet-size and required-card constraints); the decision-economics layer (marginal value, opportunity cost, frontier, fee boundaries, robustness); benefits defaulting to $0; cpp shown as a user assumption.
- **Change:**
  - Canadian categories and cards, in CAD.
  - Per-card `source_url` and `last_verified`, with `null` for unknown terms.
  - Post-cap spend earns the card's base rate instead of a hard-coded 1×.
  - Caps become per-period, since Canadian caps are often monthly or quarterly.
  - Categorization rules move into `merchant_rules.json`, matched on word boundaries.
  - Refunds are netted.
  - The robustness score excludes the base case.
  - Every part of statement parsing runs in the browser.
- **Drop:** Plaid and any server-side handling of transactions.
