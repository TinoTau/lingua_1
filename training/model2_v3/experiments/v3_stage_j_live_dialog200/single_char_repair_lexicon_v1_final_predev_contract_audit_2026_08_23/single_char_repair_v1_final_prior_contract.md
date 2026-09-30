# Single-Char Repair Lexicon V1 — Final Prior Contract (FROZEN)

## Constant

**`SINGLE_CHAR_REPAIR_V1_PRIOR = 0.9`**

Applied to every V1 row at import via TSV `weight` column → `base_lexicon.prior_score`.

## IME weight

**FORBIDDEN** — IME role weights 0.08–0.30 must not be reused.

## End-to-end trace (code-verified)

| Step | File | Function/Field | Consumer | Condition |
|------|------|----------------|----------|-----------|
| Build SSOT | `single_char_repair_lexicon_v1.tsv` | `weight` | loader | constant 0.9 |
| Loader | `full-rebuild-from-csv.mjs` | `loadSingleCharRows` | maps to `prior_score` | `>0` else 0.12 default — V1 must supply weight |
| SQLite | `base_lexicon` | `prior_score` | runtime | stored |
| Runtime map | `lexicon-runtime-v2.ts` | `priorScore` | HotwordEntry | |
| Collector eligibility | `recall-span-topk-v2.ts` | `scoreHotword` / length1 filter | | `priorScore > 0` |
| SQL order | `lexicon-runtime-v2.ts` | `ORDER BY prior_score DESC` | tie order | all equal at 0.9 |
| Candidate score | `candidate-score.ts` | `computeCandidateScore` | ranking | **additive** `priorScore + phonetic + ...` (not probability) |
| Bind gate | `recall-topk-for-windows.ts` | `bindLexiconHitsToWindow` | | `priorScore >= minPrior` |
| minPrior | `fw-config.ts` | `minPrior` | default **0.5** | no length-1 bypass |

## Why 0.9 is safe

1. `0.9 > 0` — collector eligibility ✓
2. `0.9 >= 0.5` — bind minPrior ✓
3. Aligns with multi-char Full Rebuild default **0.9** (`full-rebuild-from-csv.mjs` multi-char path)
4. No code treats prior as probability on this path
5. No gate requiring `> 0.9` or `= 1.0` on bind/collector
6. Uniform constant removes false ranking among length-1 rows (membership already selective)

## Explicitly forbidden

- SUBTL/Weibo → prior formulas
- Per-character tuned priors
- Changing minPrior in the same change-set (separate decision if needed)

## CONTRACT_GAP resolved

Prior contract **FROZEN** for development validation.
