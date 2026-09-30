# MATERIALIZABLE_TARGET_V1

**Audit:** ASSEMBLY_CANDIDATE_TO_SENTENCE_MATERIALIZATION_CONFORMANCE_AUDIT  
**Date:** 2026-08-18

---

## Purpose

Prevent equating「候选 surface 存在」with「完整 expected correction 可组装」。

---

## Definitions

### Target Correction Ngrams

```
T_cn = { ng | ng ∈ cjkNgrams(expected, 2..4), ng ∉ norm(raw_asr) }
```

If `T_cn` is empty (raw already contains all expected ngrams structurally), fall back to full-string equality for final layer checks.

### LEXICAL_RECOVERABLE

∃ candidate `c` in post-union set such that:

- `norm(c.surface)` matches some `t ∈ T_cn` (substring match, len≥2)
- `c` has parseable span (candidateId or FineSpan binding)

**Does NOT require** full-sentence recoverability.

### PATH_RECOVERABLE

All required correction targets have eligible candidates where:

- `isCandidateEligibleForSpanAssembly(c, finespan)` equivalent: raw+syllable **exact** match to owning PathFineSpan
- Eligible correction spans form at least one **non-overlapping** set covering `T_cn` (or maximal subset under overlap)

### SENTENCE_RECOVERABLE

PATH_RECOVERABLE **AND** frozen bucket contract permits the picks:

- `base_term` always allowed
- `domain_term` allowed if domain ∈ `retainedDomains` for some generated bucket
- cross-domain domain_term **not** required to appear (frozen exclusion)

Under these picks, Interval DFS **could** emit a sentence containing all covered correction ngrams (theoretical; read-only graph check).

### ACTUALLY_ASSEMBLED

∃ assembly or KenLM input sentence `s` such that some `t ∈ T_cn` appears in `norm(s)` and `t ∉ norm(raw_asr)`.

---

## Funnel Layer Alignment (Strict Comparable)

| Layer | Strict metric |
|-------|---------------|
| Budget Target Visible | correction ngram in union candidate **surface** (not raw-already-present) |
| Lexical Recoverable | LEXICAL_RECOVERABLE |
| Path Recoverable | PATH_RECOVERABLE |
| Sentence Recoverable | SENTENCE_RECOVERABLE |
| Actually Assembled | ACTUALLY_ASSEMBLED |
| KenLM Input | ACTUALLY_ASSEMBLED on kenlm_input.combinations |
| Final | norm(final) === norm(expected) |

---

## Original Funnel Defect (TRACE_ATTRIBUTION_CONTRACT_MISMATCH)

| Layer | Original definition | Problem |
|-------|---------------------|---------|
| After Budget | `hasTarget(candidate surfaces)` — any expected ngram len≥2 in surface | Counts ngrams **already in raw ASR** (e.g. 你好, 今天) → inflates 142 |
| Assembly | Same `hasTarget` on **full assembled sentence strings** | Full sentence rarely ⊂ expected; partial repairs (e.g. 蓝莓) **missed** → deflates 26 |

**142→26 is NOT a valid direct Assembly attrition funnel.**

---

## dialog_200 Stage-J Strict Funnel (200 utterances)

| Stage | Count |
|-------|------:|
| Budget Target Visible (strict) | 46 |
| Lexical Recoverable | 97 |
| Path Recoverable | 59 |
| Sentence Recoverable | 58 |
| Actually Assembled | 63 |
| KenLM Input | 63 |
| Final | 25 |

**True Assembly cliff (Sentence Recoverable → Actually Assembled):** 58 → 63 (Assembly **over**-delivers partial corrections vs strict sentence-recoverable estimate; heuristic conservative).

**Primary measurable gap:** Lexical (97) → Path (59) = **eligibility / span alignment attrition** before DFS.
