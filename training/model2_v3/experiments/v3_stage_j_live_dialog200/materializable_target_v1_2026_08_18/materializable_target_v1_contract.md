# MATERIALIZABLE_TARGET_V1 Contract

**Version:** MATERIALIZABLE_TARGET_V1  
**Date:** 2026-08-18  
**Scope:** diagnostics / trace analysis only  
**Supersedes for attribution:** LEGACY_TARGET_ATTRIBUTION (`hasTarget` reused across funnel layers)

Legacy 142→26 funnel is **RETIRED / INVALID FOR ROOT-CAUSE ATTRIBUTION**.

---

## Correction units

Derived solely from character alignment of `norm(raw ASR)` vs `norm(expectedText)`.

`norm` = strip punctuation/whitespace, lowercase. **No** traditional/simplified folding, no per-dialog rules, no domain-conditioned targets.

Operations: `UNCHANGED` | `SUBSTITUTE` | `INSERT` | `DELETE`

Consecutive same-class non-match ops collapse to one unit. UNCHANGED ngrams **never** count as recall success.

Each unit: `stable_id`, `source_text`, `expected_text`, `source_range`, `expected_range`, `operation`.

---

## Levels (do not reuse one predicate)

| Level | Meaning |
|-------|---------|
| LEXICAL_RECOVERABLE | SUBSTITUTE/INSERT unit has a candidate whose surface is the correction (not an unchanged raw ngram) |
| PATH_RECOVERABLE | lexical candidate binds to a PathFineSpan covering the source range **and** passes frozen eligibility (exact syllable/raw alignment) **and** no unsolvable overlap among required units |
| SENTENCE_RECOVERABLE | path recoverable **and** frozen SameDomain/base mixing would admit the pick |
| ACTUALLY_ASSEMBLED | some Assembly sentence materializes the unit’s expected surface |
| KENLM_AVAILABLE | same check on KenLM input combinations |
| FINAL_CORRECT | existing dialog_200 `norm(final)===norm(expected)` — unchanged |

Dialog-level flags are **all required units**. Partial correction is counted separately (`correction_units_*`, `actually_assembled_partial`).

---

## First divergence V2

`ASSEMBLY_DROP` is retired as a bucket.

Taxonomy includes: `ASR_SOURCE_UNRECOVERABLE`, `LEXICON_TARGET_ABSENT`, `LEXICAL_RECALL_MISS`, `FINESPAN_NO_COVERAGE`, `FINESPAN_RANGE_MISMATCH`, `FINESPAN_PARENT_FRAGMENT_MISMATCH`, `CANDIDATE_SPAN_BINDING_MISMATCH`, `ELIGIBILITY_REJECT`, `DOMAIN_BUCKET_EXCLUSION`, `OVERLAP_PATH_CONFLICT`, `TRUE_ASSEMBLY_MATERIALIZATION_FAILURE`, `ASSEMBLY_SENTENCE_BUDGET_PRUNE`, `KENLM_RANK_ERROR`, `POSTPROCESS_ERROR`, `FINAL_PARTIAL_CORRECTION`, `OTHER`.

Earliest unrecoverable required unit wins.

---

## Implementation

- `electron_node/electron-node/tests/lib/materializable-target-v1.mjs`
- Wired into `dialog200-path-trace-analyze.mjs` (`flattenFunnel`, `firstDivergence`, `attributeFailure`)
- Unit tests: `materializable-target-v1.test.mjs`
