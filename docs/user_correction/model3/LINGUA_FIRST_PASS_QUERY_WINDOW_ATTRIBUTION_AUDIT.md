# LINGUA First-Pass Query-Window Exact Attribution Audit

| Field | Value |
|---|---|
| Phase | `LINGUA_STAGE2_QUERY_EVIDENCE_FREEZE_AND_EXACT_ATTRIBUTION` / PHASE_B+C |
| Date | 2026-09-15 |
| Join unit | **EXACT QUERY INVOCATION** (not CASE) |
| Product runtime semantics | **UNCHANGED** |
| Diagnostic-only changes | path_trace query fields; Stage2 `retry_recall_invocations.syllableStart/End`; audit harness |

---

## Method

1. Replayed all **35** E5 CORRECT_PROFILE cases (covers provisional Q1=33) with `MODEL2_DIALOG200_TRACE=1`.
2. Extracted **every** Model2-conditioned first-pass Recall invocation (`p_retrieval.queries[]`) with geometry + transformed `pinyin_key` + hits.
3. Extracted every Stage2 Recall invocation (`retry_recall_invocations[]`) with ASR `windowPinyinKey` + syllable geometry.
4. Target-reachable **only** when the **exact** transformed query:
   - is pinyin-family compatible with target (exact or legal subspan); **and**
   - has target hit **or** audit-only no-Tone lexicon presence for `(surface, targetPinyin)`.
5. No GT fed into product code. Full 257 reclassification **not** required (Q1 confirmed rather than collapsed).

Artifacts: `LINGUA_E5_EXACT_QUERY_ATTRIBUTION_35.json`, `LINGUA_Q1_EXACT_REVALIDATION_33.csv`, `LINGUA_QUERY_GEOMETRY_MAPPING_MATRIX.csv`.

---

## E5 reconciliation (35)

| Class | Meaning | Count |
|---|---|---|
| E5-A | Exact target-reachable first-pass Model2 query exists | **35** |
| E5-B | Model2 transform exists, none target-reachable | 0 |
| E5-C | Reachability only from non-Model2 window | 0 |
| E5-D | Prior Gate-E attribution defect (no exact reachable) | 0 |
| E5-E | Insufficient trace | 0 |
| **TOTAL** | | **35** |

Notes:

- Prior Gate-E **chosenQueries** often pointed at a non-matching sibling window (e.g. `tan|nei` vs target `nei|ke`) — recorded as `priorChosenWindowMisjoin=true` on many E5-A rows.
- Exact-invocation re-audit shows sibling windows **do** carry target-family transformed keys (often as subspan/superset). Prior “35 reachable” was therefore **directionally correct** but **not join-safe**.

```text
E5_RECONCILIATION = PASS
```

---

## Q1 revalidation (provisional 33)

| Metric | Value |
|---|---|
| Q1_PROVISIONAL | 33 |
| Q1_CONFIRMED | **33** |
| Q1_RECLASSIFIED | 0 |

Confirmed Q1 requires: exact Model2 query exists + target-reachable + geometry + Stage2 covers region + Stage2 issues **no** equivalent target-reachable ASR query + first failure = evidence loss. All 33 meet this under exact-invocation rules.

Q2 / Q6 from the prior 257 matrix remain **provisional prior classifications** (not re-run).

```text
Q1_REVALIDATION = PASS
FULL_257_RECONCILIATION_NECESSARY = NO
```

---

## Geometry reuse (confirmed Q1 best-mapping)

| Class | Count |
|---|---|
| EXACT_REUSE | 5 |
| SUBSPAN_REUSE | 27 |
| SYLLABLE_MAP | 0 |
| RESEGMENT_MAP | 1 |
| NOT_SAFE | 0 |

```text
DIRECT_QUERY_REUSE_GEOMETRY_SAFE = PARTIAL
RESEGMENTED_QUERY_MAPPING_REQUIRED = YES (minority; dominant = SUBSPAN)
```

---

## Ownership / ACP readiness

```text
QUERY_EVIDENCE_NATURAL_OWNER = RECALL
OWNERSHIP_CONFIDENCE = HIGH
MODEL2_SECOND_INFERENCE_REQUIRED = NO
MODEL3_CHANGE_REQUIRED = NO
JOBRESULT_CHANGE_REQUIRED = NO
GT_RUNTIME_DEPENDENCY = NO
CONTRACT_GAP_CONFIRMED = YES
QUERY_EVIDENCE_LIFETIME_SSOT = NOT_SPECIFIED
CURRENT_STAGE2_ASR_QUERY_POLICY_AUTHORITY = DERIVED_FROM_RESEGMENTATION_DESIGN
ACP_READY = YES
ACP_REQUIRED = YES
LOCAL_FIX_FEASIBILITY = LOCAL_FIX_FEASIBLE_WITH_GEOMETRY_CONTRACT
```

Natural owner is **RECALL**: semantic pronunciation/query evidence is produced at first-pass Recall invocation time and must be consumable by Stage2 Retry Recall without Model2 internals (relation names / logits / `nChanged`).

### Minimum conceptual contract (design-only; NOT implemented)

```text
RecallQueryEvidence {
  syllableStart
  syllableEnd
  rawStart
  rawEnd
  pinyinKey          // transformed first-pass query key
  source             // e.g. MODEL2_CONDITIONED_FIRST_PASS
}
```

Evaluated field needs:

| Field | Needed? |
|---|---|
| pinyinKey | **YES** |
| querySyllables | optional (derivable from key) |
| raw / syllable geometry | **YES** (SUBSPAN mapping) |
| originSpanId / windowId | useful join ids; not semantics |
| candidate term / relation / changedPositions / Tone / Model2 action id | **NO** for Stage2 consumption |

---

## Diagnostic code changed (product semantics unchanged)

| Area | Change |
|---|---|
| `expand-windows-with-model2.ts` | path_trace `queries[]` adds observed/transformed syllables, geometry, hit pinyin |
| `model3-retry-router.ts` / `model3-types.ts` | observation-only `syllableStart`/`syllableEnd` on retry recall invocations |
| `tests/audit-e5-exact-query-attribution.mjs` | exact attribution harness |

```text
MODEL2_RUNTIME_CHANGED = NO
MODEL3_RUNTIME_CHANGED = NO
STAGE2_QUERY_RUNTIME_CHANGED = NO
PRODUCT_RUNTIME_CODE_CHANGED = NO
DIAGNOSTIC_CODE_CHANGED = YES
TRACE_ALIGNMENT_FIX = PASS
EXACT_QUERY_INVOCATION_IDENTITY = PASS
```

---

## Decision (CASE 1)

Substantial confirmed Q1 (33/33), deterministic geometry mostly EXACT/SUBSPAN, no Model2 rerun, Model3 unchanged:

```text
ONE_NEXT_OWNER = STAGE2_QUERY_EVIDENCE_PRESERVATION_ACP
ONE_NEXT_DELTA = Draft a narrow ACP defining Recall-owned semantic query evidence lifetime + Stage2 Retry consumption + geometry mapping (EXACT/SUBSPAN). Do NOT implement in this round.
```
