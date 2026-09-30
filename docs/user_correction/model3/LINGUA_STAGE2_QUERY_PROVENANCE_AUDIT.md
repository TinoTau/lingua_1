# LINGUA Stage2 Query Provenance / Evidence Lifecycle Audit

| Field | Value |
|---|---|
| Phase | `LINGUA_STAGE2_QUERY_PROVENANCE_EVIDENCE_LIFECYCLE_AUDIT` |
| Date | 2026-09-15 |
| Mode | READ_ONLY / TRACE_FIRST / SSOT_LOCKED |
| Freeze | `LINGUA_RUNTIME_FREEZE_POST_STAGE2_TONE_RELAX_V1` |
| Pilot baseline | `LINGUA_PILOT200_POST_STAGE2_TONE_RELAX_REMEASURE` |
| Product code | **NO CHANGE** |

---

## EVIDENCE_ALIGNMENT_CORRECTION (2026-09-15)

**Lifecycle architecture facts below remain PROVEN / FROZEN.**

**Failure counts (Q1=33, E5 transform target-reachable=35) were PROVISIONAL** pending exact query-invocation attribution.

**Phase C update (2026-09-15):** exact-invocation re-audit confirms:

- E5-A = 35 / 35
- Q1_CONFIRMED = 33 / 33 provisional
- See `LINGUA_FIRST_PASS_QUERY_WINDOW_ATTRIBUTION_AUDIT.md`

Cause of provisional status: Gate-E case-level `PINYIN_YES_TONE_NO` / reason text was joined to a different window’s `chosenQueries` (e.g. `tan|nei` vs claimed `nei|ke`). Exact sibling invocations still carried target-family keys.

```text
ARCHITECTURE_FACTS_FROZEN = YES
Q1_COUNT_FROZEN = YES (Q1_CONFIRMED=33)
ACP_READY = YES
ACP_REQUIRED = YES (draft only; not implemented this round)
```

---

## Central answer

Production Stage2 fails to issue target-reachable pinyin for the E5 population because:

1. First-pass Model2 **does** produce a target-reachable transformed pinyin query (Gate-E: PINYIN_YES_TONE_NO for all 35 E5).
2. That query is **MODEL2_INTERNAL / call-local** — used only inside `executeProfileLexiconQueries` → `recallSpanTopKV2`.
3. At `materializeProfileHits`, candidate.`windowPinyinKey` is forced back to **observed ASR**; transformed syllables / query key / hit pinyin are **not stored**.
4. Stage2 rebuilds queries from **`globalSyllables` ASR slices** inside RetryRegion windows (`enumerateStage2SuccessPathQueryLocals`). It **cannot see** Model2 transformed query (`CURRENT_STAGE2_CAN_SEE_MODEL2_TRANSFORMED_QUERY = NO`).
5. Focused acceptance 35/35 used **target-reachable / Model2-conditioned pinyin as a test input**, not production Stage2 keys — so it does not contradict production ASR-space Stage2.

This is **not** a Lexicon engine miss (`TRUE_LEXICON_ENGINE_MISS_COUNT = 0` for Q5).

---

## Hypothesis outcomes (section 3)

| Outcome | Verdict |
|---|---|
| A. First-pass transformed pinyin is valid reusable Recall evidence | **YES for Q1/E5** (semantic pinyinKey + geometry), if owned as Recall evidence — not as Model2 feature leak |
| B. Pure Model2-internal transient | **YES today** (implementation); should not force Stage2 to depend on relation internals |
| C. Different Recall-owned representation already exists | **NO** after materialize |
| D. Reconstruct from other frozen upstream | **ASR globalSyllables only** — insufficient for E5 |
| E. Retry geometry makes direct reuse invalid | **PARTIAL** — resegmentation requires mapping; not automatically invalid |
| F. Different failure classes need different ownership | **YES** — see Q1/Q2/Q6 mix |

---

## Stage2 construction (code)

```text
PathFineSpan → Model3 RETRY → deriveRetryRegions
→ enumerateStage2SuccessPathQueryLocals (SHARED_LEXICAL_WINDOW_OWNER)
→ syllables = globalSyllables.slice(...)
→ windowPinyinKey = syllables.join('|')
→ recallSpanTopKV2(recallMode=model3_retry_pinyin_domain_recovery, domainIds=retainedDomains)
```

| Field | Value |
|---|---|
| CURRENT_STAGE2_QUERY_PINYIN_SOURCE | ASR `globalSyllables` slice |
| CURRENT_STAGE2_QUERY_GEOMETRY_SOURCE | Legal lexical windows clipped to RetryRegion |
| CURRENT_STAGE2_CAN_SEE_MODEL2_TRANSFORMED_QUERY | **NO** |
| CURRENT_STAGE2_CAN_SEE_FIRST_PASS_RECALL_QUERY | **NO** |

Example `p2_u001_007`: TARGET `内科` / `nei\|ke` · ASR `会一线谈雷克` · Stage2 queries `tan\|lei\|ke` family · first-pass Gate-E pinyin-reachable `nei\|ke` with Tone mismatch · focused no-Tone hit YES · production Stage2 target hit NO.

---

## Information-loss boundaries

| Boundary | Value |
|---|---|
| FIRST_TRANSFORMED_PINYIN_LOSS_BOUNDARY | `candidate-materialize.ts::materializeProfileHits` |
| FIRST_QUERY_KEY_LOSS_BOUNDARY | same |
| FIRST_CHANGED_POSITION_LOSS_BOUNDARY | never persisted (`nChanged` call-local only; no `changedPositions` field) |
| FIRST_WINDOW_GEOMETRY_LOSS_BOUNDARY | origin geometry **retained** on candidate; Stage2 **rebuilds** ASR windows rather than reusing Model2 query geometry |

---

## 257 failure reconciliation (PROVISIONAL — do not freeze)

> **WARNING:** Q1=33 and E5 reachability=35 are **PROVISIONAL** pending exact query-window attribution (`LINGUA_STAGE2_QUERY_EVIDENCE_FREEZE_UPDATE.md`).

| Class | Count | NO | CORRECT | WRONG |
|---|---:|---:|---:|---:|
| Q1_MODEL2_QUERY_EVIDENCE_LOST | **33 (PROVISIONAL)** | 0 | **33** | 0 |
| Q2_TRANSFORMED_QUERY_STILL_UNREACHABLE | **154** | 0 | 53 | **101** |
| Q3_STAGE2_GEOMETRY_MAPPING | 0 | 0 | 0 | 0 |
| Q4_TARGET_REGION_NOT_REPRESENTABLE | 0 | 0 | 0 | 0 |
| Q5_LEGAL_QUERY_BUT_RECALL_MISS | 0 | 0 | 0 | 0 |
| Q6_NO_REUSABLE_FIRST_PASS_QUERY | **70** | 0 | 40 | 30 |
| Q7_EVALUATOR_OR_TRACE_DEFECT | 0 | 0 | 0 | 0 |
| Q8_OTHER_PROVEN | 0 | 0 | 0 | 0 |
| **TOTAL** | **257** | 0 | 126 | 131 |

`QUERY_FAILURE_RECONCILIATION = PASS`.

Notes:

- **Q1 (33)** = entire E5 fail set in Q257 (35 E5 − 2 final-correct). Dominant **CORRECT_PROFILE** architecture signal for Stage2 recovery.
- **Q2 (154)** includes large **WRONG_PROFILE** control mass (101) + CORRECT compound/partial transforms (53). Do **not** use WRONG Q2 to justify expansion.
- **Q6 (70)** = no target-reachable first-pass query to reuse.
- **Q5 = 0** → do not reopen Lexicon engine.

---

## E5 forensic (35/35)

| Metric | Value |
|---|---|
| E5_FIRST_PASS_MODEL2_TRANSFORM_EXISTS | **35** |
| E5_FIRST_PASS_TRANSFORM_TARGET_REACHABLE | **35** |
| E5_STAGE2_ASR_SPACE_QUERY_COUNT | **35** |
| E5_STAGE2_TRANSFORMED_QUERY_COUNT | **0** |
| E5_STAGE2_TARGET_REACHABLE_QUERY_COUNT | **0** |
| E5 in Q257 / Q1 | **33 / 33** |
| E5 final correct | **2** (`p2_u002_019`, `p2_u005_001`) |

Tone was the first-pass blocker; Stage2 Tone-relax is active but **query pinyin never becomes `nei\|ke`-class**.

---

## Geometry compatibility

| Verdict | Value |
|---|---|
| DIRECT_QUERY_REUSE_GEOMETRY_SAFE | **PARTIAL** |
| RESEGMENTED_QUERY_MAPPING_REQUIRED | **YES** |
| PARTIAL_QUERY_EVIDENCE_REQUIRED | **YES** |

First-pass transform is bound to origin window; Stage2 emits new ASR windows. A future fix needs geometry-keyed query evidence (exact / contained / syllable map), not raw string dump into all Stage2 locals.

---

## SSOT authority

| Item | Classification |
|---|---|
| QUERY_EVIDENCE_LIFETIME_SSOT | **NOT_SPECIFIED** → CONTRACT_GAP |
| QUERY_EVIDENCE_RETRY_CONSUMER_SSOT | **NO** |
| CURRENT_STAGE2_ASR_QUERY_POLICY_AUTHORITY | **DERIVED_FROM_RESEGMENTATION_DESIGN** |
| MODEL2_ON_MODEL3_RETRY | **EXPLICIT ACTIVE SSOT** |

Current ASR Stage2 is **expected under no Model2-on-Retry**, not silent drift. Whether Recall may preserve semantic query evidence for Stage2 is a **gap**, not a frozen ban.

---

## Ownership / local-fix feasibility (audit only)

| Item | Verdict |
|---|---|
| QUERY_EVIDENCE_NATURAL_OWNER | **RECALL** (semantic pinyinKey + geometry) |
| MODEL2_INTERNAL_LEAK_REQUIRED | **NO** |
| MODEL2_SECOND_INFERENCE_REQUIRED | **NO** |
| MODEL3_CAN_REMAIN_UNCHANGED | **YES** |
| MODEL3_CONTRACT_CHANGE_REQUIRED | **NO** |
| JOBRESULT_CHANGE_REQUIRED | **NO** |
| FUTURE_TONE_BIAS_CONTRACT_COMPATIBLE | **YES** |
| LOCAL_FIX_FEASIBILITY | **ACP_REQUIRED** (+ geometry contract) |

Feasible shape (not implementing): one Recall-owned query-evidence artifact produced at first-pass Model2-conditioned recall, consumed only by Stage2 Recall when Model3 emits RETRY — without Model2 rerun, Model3 input change, Domain Vote, budget, SameDomain, Assembly, or KenLM changes.

Performance: preservation would **not** require extra Model2 inference; Stage2 window count / DB query count depend on ACP design (prefer reuse over new windows).

---

## Architecture classification

**E_MIXED_WITH_COUNTS**

| Slice | Class |
|---|---|
| Q1 (33) E5 | **B_CONTRACT_GAP** (query evidence lifetime/reuse unspecified) under **C** Stage2 ASR design |
| Q2 (154) | **C_EXPECTED_CURRENT_DESIGN_LIMITATION** (unreachable / wrong-profile / compound) |
| Q6 (70) | **C_EXPECTED_CURRENT_DESIGN_LIMITATION** |
| Q5 | 0 — not Lexicon |

---

## Controls (anti-overfit)

Compound residuals (换乘/翻成, 牛肉串/刘若川 class) remain **Q2/Q6** — preserving Model2 pinyin cannot magically repair non-profile compound ASR errors. WRONG_PROFILE Q2=101 is expected control.

---

## Final verdicts

```text
BASELINE_IDENTITY = PASS
PRODUCT_CODE_CHANGED = NO
AUDITED_QUERY_FAILURE_COUNT = 257 / 257
QUERY_FAILURE_RECONCILIATION = PASS
E5_CASE_COUNT = 35
E5_FIRST_PASS_MODEL2_TRANSFORM_EXISTS = 35
E5_FIRST_PASS_TRANSFORM_TARGET_REACHABLE = 35
E5_STAGE2_ASR_SPACE_QUERY_COUNT = 35
E5_STAGE2_TRANSFORMED_QUERY_COUNT = 0
E5_STAGE2_TARGET_REACHABLE_QUERY_COUNT = 0
Q1_MODEL2_QUERY_EVIDENCE_LOST = 33
Q2_TRANSFORMED_QUERY_STILL_UNREACHABLE = 154
Q3_STAGE2_GEOMETRY_MAPPING = 0
Q4_TARGET_REGION_NOT_REPRESENTABLE = 0
Q5_LEGAL_QUERY_BUT_RECALL_MISS = 0
Q6_NO_REUSABLE_FIRST_PASS_QUERY = 70
Q7_EVALUATOR_OR_TRACE_DEFECT = 0
Q8_OTHER_PROVEN = 0
FIRST_TRANSFORMED_PINYIN_LOSS_BOUNDARY = candidate-materialize.ts::materializeProfileHits
FIRST_QUERY_KEY_LOSS_BOUNDARY = candidate-materialize.ts::materializeProfileHits
FIRST_CHANGED_POSITION_LOSS_BOUNDARY = relation-lexicon-adapter.ts (nChanged call-local; no field persisted)
FIRST_WINDOW_GEOMETRY_LOSS_BOUNDARY = NOT_LOST_ON_CANDIDATE; Stage2 rebuilds ASR windows
CURRENT_STAGE2_QUERY_PINYIN_SOURCE = ASR globalSyllables slice
CURRENT_STAGE2_QUERY_GEOMETRY_SOURCE = SHARED_LEXICAL_WINDOW_OWNER clipped to RetryRegion
CURRENT_STAGE2_CAN_SEE_MODEL2_TRANSFORMED_QUERY = NO
CURRENT_STAGE2_CAN_SEE_FIRST_PASS_RECALL_QUERY = NO
QUERY_EVIDENCE_LIFETIME_SSOT = NOT_SPECIFIED
QUERY_EVIDENCE_RETRY_CONSUMER_SSOT = NO
CURRENT_STAGE2_ASR_QUERY_POLICY_AUTHORITY = DERIVED_FROM_RESEGMENTATION_DESIGN
QUERY_EVIDENCE_NATURAL_OWNER = RECALL
DIRECT_QUERY_REUSE_GEOMETRY_SAFE = PARTIAL
RESEGMENTED_QUERY_MAPPING_REQUIRED = YES
PARTIAL_QUERY_EVIDENCE_REQUIRED = YES
MODEL2_INTERNAL_LEAK_REQUIRED = NO
MODEL2_SECOND_INFERENCE_REQUIRED = NO
MODEL3_CAN_REMAIN_UNCHANGED = YES
MODEL3_CONTRACT_CHANGE_REQUIRED = NO
JOBRESULT_CHANGE_REQUIRED = NO
FUTURE_TONE_BIAS_CONTRACT_COMPATIBLE = YES
TRUE_LEXICON_ENGINE_MISS_COUNT = 0
TRACE_SUFFICIENT = NO
ARCHITECTURE_CLASSIFICATION = E_MIXED_WITH_COUNTS
LOCAL_FIX_FEASIBILITY = ACP_REQUIRED
MODEL2_CHANGE_REQUIRED = NO
MODEL3_CHANGE_REQUIRED = NO
TONE_CHANGE_REQUIRED = NO
LEXICON_CHANGE_REQUIRED = NO
DOMAIN_CHANGE_REQUIRED = NO
RETRY_BUDGET_CHANGE_REQUIRED = NO
SAMEDOMAIN_CHANGE_REQUIRED = NO
ASSEMBLY_CHANGE_REQUIRED = NO
KENLM_CHANGE_REQUIRED = NO
ARCHITECTURE_DECISION_REQUIRED = YES
ONE_NEXT_OWNER = STAGE2_QUERY_EVIDENCE_PRESERVATION_ACP
ONE_NEXT_DELTA = Draft one ACP for Recall-owned first-pass query evidence (pinyinKey+geometry) preservation and Stage2 reuse on Model3 RETRY only — no Model2 second inference, no Model3 input change, with explicit resegment mapping rules
AUDIT_STATUS = PASS
```

STOP.
