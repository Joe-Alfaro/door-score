# Door Score — rationale (one page)

## Who is the ideal door?

The business earns when one household buys **many services over many years**. The historical best
customers are recent movers, busy dual-income households, and people who hire out rather than DIY.
Translated into things public data can actually see, the ideal door is:

> An **owner-occupied single-family home** whose household **recently arrived** or is entering a
> **high-maintenance phase**, with the **means and habit of paying others** to care for the home.

Four traits, each with a public-data detector:

| ICP trait | How we detect it from public data | Source |
|---|---|---|
| Recently moved | Deed date within 12 / 36 / 60 months, and a real (arm's-length) sale price rather than a $1 transfer | NJ MOD-IV via statewide parcel service |
| Means to hire out | Assessed value quartile *within the territory*, so it is relative to neighbors, not to the state | NJ MOD-IV |
| Hires out (behavior) | Provider truck on site, professionally maintained landscaping, contractor yard sign | Street View + Claude vision |
| Busy dual-income household | Tract share of two-parent families where both parents work; 2-story + 2-car-garage as a household-size proxy | Census ACS (aggregate); MOD-IV building code |
| Needs services soon | Home age bands, lot size (lawn demand), visible wear or active renovation | MOD-IV; Street View |
| Homeowner relationship | Owner-occupied vs absentee, derived from whether the tax bill mails to the property | MOD-IV (mailing address discarded after use) |

## The score

Points per signal, summed and rescaled to 0–100 over the signals *available for that door*, so a home
without usable imagery is never penalized relative to one that has it.

| Signal | Max | Why this weight |
|---|---|---|
| New mover | 25 | Strongest single predictor in the business thesis; movers set up every service at once |
| Hires-out capacity (value quartile) | 15 | Necessary but not sufficient; capped so wealth alone cannot top the list |
| Owner-occupied | 10 | A renter can't buy a roof; absentee doors score 0 here and get an explicit tag |
| Maintenance demand (home age) | 10 | 40+ year homes have systems at end of life |
| Provider truck on site | 8 | Direct evidence the household already pays for home services |
| Lawn demand (lot size) | 8 | Recurring, entry-level service |
| Household-size proxy | 8 | Larger homes correlate with families and dual earners |
| Professional landscaping / yard sign | 6 | Behavioral "hires out" signal |
| Visible service need / renovation | 6 | Near-term demand |
| Dual-income area (tract) | 6 | Aggregate prior; modest weight because it is not door-specific |

Vision signals only count when the model's confidence ≥ 0.6; the eval harness reports precision,
recall and hallucination rate at that threshold.

## What we deliberately do not use

Owner names (redacted by law, and we don't route around it), tax-exemption categories such as
disabled-veteran status, anything inferring race, religion, age or family status of specific residents,
and listing sites whose terms forbid programmatic access.

## How we would validate against real outcomes

1. **Hold-out by door.** Score every door, then compare against the outcome set (contact → engaged →
   second service) with AUC and a lift chart: top-decile doors should convert at ≥2× the territory rate.
2. **Per-signal ablation.** Drop one signal at a time and re-measure lift; remove signals that don't
   move it. Fit a logistic model on the same features to see whether learned weights disagree with ours.
3. **Calibrate the new-mover window.** Outcomes tell us whether the cliff is 12, 24 or 36 months.
4. **Route-level test.** A/B field reps on score-ordered vs. street-ordered routes; measure engaged
   households per rep-hour.
5. **Drift.** Re-run quarterly; deed dates and imagery dates age, and the ledger shows what it cost.
