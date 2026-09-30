# Lingua FW Repair V4 — Post-Trace Freeze and Model2 D Binding Fix

**Date:** 2026-08-18  
**Stage:** POST_MATERIALIZABLE_TARGET_V1_GOVERNANCE + SECONDARY_IMPLEMENTATION_FIX  
**Baseline:** MATERIALIZABLE_TARGET_V1 reanalysis + FineSpan eligibility gap audit (same day)

---

## TRACK A — Formal freeze

Frozen as the only authoritative dialog/postprocess target contract:

- `docs/user_correction/MATERIALIZABLE_TARGET_V1_FREEZE_V1.md`

Post-trace freeze of Model2 / Stage D / FineSpan architecture / Assembly / Domain Vote / Budget / KenLM:

- `docs/user_correction/FW_REPAIR_V4_POST_TRACE_FREEZE_V1.md`

Legacy funnel `AfterBudget 142 → Assembly 26` / `ASSEMBLY_DROP=126` is **HISTORICAL_ONLY**, not go/no-go, not root-cause authority:

- `docs/user_correction/legacy_trace_retirement_manifest.json`

dialog_200 remains **200/200 NO_PROFILE**. No training. ONE checkpoint unchanged.

---

## TRACK B — Confirmed implementation fix

### Root cause

Model2 D was an **implementation drift**, not a FineSpan design defect.

`FUZZY_LEN_DELTA_MAX=1` lets a 1-syllable FineSpan query return 2-character domain hits. `materializeDomainHits` then stamped the **current iterator FineSpan** (ranges + `windowPinyinKey`) onto every hit. `merge` by `termId` kept the first span.

Known pattern: `大杯` bound to 「帮」/`bang`; `预订` bound to 「大」; `少冰`/`小杯` bound to 「红」.

See `docs/user_correction/model2_d_candidate_binding_root_cause.md`.

### What changed

| File | Change |
|------|--------|
| `candidate-materialize.ts` | D hit materializes only if hit pinyin syllable count equals origin FineSpan syllable count |
| `expand-active-candidates.ts` | pass `retrievalId`; D `hits[]` get `candidateId` / `binding_status` |
| `dialog200-path-trace.ts` | compactCandidate observation fields |
| `v4-types.ts` | optional `originSpanId` / `retrievalId` |

Not changed: PathFineSpan, exact eligibility, Assembly, KenLM, budget, Domain Vote, Model2 weights, fuzzy `len_delta_max`.

If a 2-char term still cannot apply to a 1-char PathFineSpan → **EXPECTED CONTRACT REJECTION**.

### Regression

Unit tests: `candidate-materialize.test.ts` + `dialog200-path-trace.test.ts` — **10/10 PASS**.

Acceptance is **binding correctness only**, not final-dialog correctness. No training / hard-mine / special-case.

### Business equivalence

Offline on existing Stage-J traces: 2972 range-inconsistent D WindowCandidates would no longer materialize. **None** of those surfaces appear in Assembly `replacements`. Final text **PREDICTED_UNCHANGED**. No live 200-dialog rerun this round.

Matching-length D hits keep the same surface / score / origin ranges / `windowPinyinKey`.

---

## FineSpan secondary (after binding fix, simulated)

| | Before | After |
|--|--:|--:|
| Eligibility gap units | 10 | 10 |
| NO_FINESPAN_COVERAGE | 9 | 9 |
| CANDIDATE_BOUND_TO_WRONG_SPAN | 1 | 1 (d090 **BASE** `上线`, out of D-fix scope) |

Model2 D wrong-span WindowCandidates reclassify to `REJECTED_RANGE_INCONSISTENT_NOT_MATERIALIZED`. D `hits[]` still exist as lexical surfaces, so the 10-unit lexical→path gap remains as 1-char PathFineSpan vs 2-char term **expected rejection**.

FineSpan **architecture stays frozen**. Design change: **NO**.

---

## Allowed vs forbidden this round

Allowed: D origin-span binding + observation-only trace fields.

Forbidden and held: training, Assembly, FineSpan design, budget, KenLM, Domain Vote, lexicon import, new normalizer, recall algorithm.

---

## Verdict (freeze / fix)

```
Post-Trace Freeze: PASS
MATERIALIZABLE_TARGET_V1: FROZEN
Model2: FROZEN
Assembly: FROZEN
FineSpan Architecture: FROZEN
Candidate Budget: FROZEN
KenLM: FROZEN

Model2 D Wrong-Span Binding: FIXED
Business Behavior Changed: NO
Trace Observation Fields: COMPLETE
```

Full numeric responsibility / attrition verdict is in the companion audit report.
