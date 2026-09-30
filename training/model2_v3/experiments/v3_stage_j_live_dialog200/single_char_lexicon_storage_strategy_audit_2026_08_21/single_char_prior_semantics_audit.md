# Prior / metadata semantics audit

## IME weight must not survive as Repair prior

Current length-1 `prior_score` = IME TSV `weight` (≈0.08–0.30 role weights).

**IME Weight Suitable As Repair Prior: NO**

## Collector need for prior

`recall-span-topk-v2.ts` eligibility rejects `priorScore <= 0`. Ordering uses `ORDER BY prior_score DESC` in SQL.

So prior is:

- **Required for eligibility** as `> 0` (operational gate)
- **Used for ranking** when multiple tone-exact rows exist (length-1 unique-only usually collapses to 0/1 eligible surface)

Prior is **not optional** as a column (NOT NULL), but a constant positive Repair prior could satisfy eligibility until a real Repair prior contract exists.

## Option A vs B for prior ownership

| | Option A | Option B |
|--|----------|----------|
| Easy to avoid IME weight bleed | YES (new import) | YES (swap import mapping) |
| Risk of confusing with multi-char priors | Lower isolation | Same column as multi-char (0.9 defaults) — document Repair length-1 prior policy |
| Winner | SAME capability; B simpler |

Neither option designs the final score this round.

## base_lexicon can store new prior

**YES** — `prior_score REAL NOT NULL`.
