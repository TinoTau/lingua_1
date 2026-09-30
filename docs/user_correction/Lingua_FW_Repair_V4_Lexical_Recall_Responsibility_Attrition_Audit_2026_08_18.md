# Lingua FW Repair V4 — Lexical Recall Responsibility + Attrition Audit

**Date:** 2026-08-18  
**Stage:** LEXICAL_RECALL_RESPONSIBILITY_ATTRITION_AUDIT  
**Scope:** all MATERIALIZABLE_TARGET_V1 correction units (601), not a sample  
**dialog_200:** 200/200 **NO_PROFILE**  
**Artifacts:** `training/model2_v3/experiments/v3_stage_j_live_dialog200/post_trace_governance_2026_08_18/`

Do **not** read `552/601` or `96.6% LEXICAL_RECALL_MISS` as lexicon quality.

---

## 1. Responsibility (all 601 units)

| Class | N |
|-------|--:|
| Total correction units | 601 |
| LEXICAL_RECALL_RESPONSIBILITY | 405 |
| NORMALIZATION_RESPONSIBILITY (script t→s) | 145 |
| FUNCTION_WORD_OR_SINGLE_CHAR | 30 |
| INSERT_DELETE | 16 |
| PUNCTUATION | 0 |
| ASR_SOURCE_UNRECOVERABLE | 5 |
| OWNERSHIP_GAP | 145 (script path; see §6) |

Punctuation is 0 at unit level because MATERIALIZABLE_TARGET_V1 `norm()` already strips it before alignment.

OpenCC `t2cn` examples owned by **normalization**, not recall: `點→点`, `熱→热`, `鐵→铁`. `貝→杯` is **not** script (`貝→贝`); it stays lexical/homophone.

---

## 2. True recall metric

```
TRUE_RECALL_RESPONSIBILITY_N = 405
True recall failures = 379
True recall failure rate = 379 / 405 = 93.6%
```

P / D personalization: **NOT_APPLICABLE** (no profile; no synthetic domain from `expectedText`). Base recall + generic lexicon own NO_PROFILE recovery. Model2 is not a general corrector.

---

## 3. Attrition (true recall units only)

| Stage | N |
|-------|--:|
| R1 exists in lexicon | 38 |
| R1 missing | 367 |
| R2 indexed (of existing) | 38 |
| R3 query generatable | 191 |
| R4 raw Base hit | 38 |
| R5 P | NOT_APPLICABLE |
| R6 D | NOT_APPLICABLE |
| R8 candidate materialized (union) | 4 |
| R10 post-budget present | 4 |

Budget prune among true-recall failures: **0**. Keep budget frozen.

Of the **38** identities that exist, **34** fail because a matching-length FineSpan query cannot be formed (typical: 2-char term vs 1-char PathFineSpan). **4** materialize.

---

## 4. Recall root cause (379 true-recall failures)

| Class | N |
|-------|--:|
| LEXICON_COVERAGE_GAP | 345 |
| LEXICON_INDEX_GAP | 0 |
| QUERY_GENERATION_GAP | 34 |
| NORMALIZATION_MISMATCH | 0 |
| PINYIN_MISMATCH | 0 |
| TONE_MISMATCH | 0 |
| FUZZY_DISTANCE_REJECT | 0 |
| LENGTH_GATE_REJECT | 0 |
| BASE_RECALL_MISS | 0 |
| P_RECALL_MISS | 0 |
| D_RECALL_MISS | 0 |
| CANDIDATE_MATERIALIZATION_BUG | 0 |
| CANDIDATE_BINDING_BUG | 0 (D binding fixed in runtime; not counted as recall-algorithm rate) |
| BUDGET_PRUNE | 0 |
| OTHER | 0 |

---

## 5. Existence by length / class (true recall N=405)

| Length | N | In lexicon | Missing |
|--------|--:|--:|--:|
| 1-char | 229 | 0 | 229 |
| 2-char | 98 | 38 | 60 |
| 3-char | 29 | 0 | 29 |
| 4+ | 49 | 0 | 49 |

| Term class | N | Exists |
|------------|--:|--:|
| single_char | 229 | 0 |
| base_generic | 27 | 27 |
| domain_term | 11 | 11 |
| idiom (often alignment chunks) | 49 | 0 |
| other | 89 | 0 |

Authoritative sqlite `node_runtime/lexicon/v3/lexicon.sqlite`: **0** enabled length-1 rows in `term`, `base_lexicon`, and `domain_lexicon`. Frozen single-char design (≈2000–3000, base-only exact, no fuzzy) is **not populated**. That is a coverage/index split fact, **not** a license to import this round.

---

## 6. Normalization ownership

| Path | Status |
|------|--------|
| IME alignment OpenCC t→cn | ACTIVE, **not** applied to ASR / lexicon / repair surfaces |
| Unicode NFKC | ACTIVE in IME alignment only |
| ASR traditional→simplified | MISSING |
| Lexicon `normalized` / `canonical_word` | PARTIAL columns; not a t2s owner |
| Semantic-repair OpenCC | ACTIVE **outside** FW Repair V4 |
| New normalizer this round | **NOT ADDED** |

Verdict: **NORMALIZATION_OWNERSHIP_GAP**. Existing OpenCC may be **restored** in a later phase; this round does not wire it.

---

## 7. Outside recall

| Class | N |
|-------|--:|
| SCRIPT_NORMALIZATION | 145 |
| PUNCTUATION | 0 |
| INSERT_DELETE | 16 |
| FUNCTION_WORD | 30 |
| NON_LEXICAL_EDIT | 0 |
| ASR_UNRECOVERABLE | 5 |

These must not enter the recall-algorithm failure rate.

---

## 8. Single character

```
Single-Char Responsibility N (true recall): 229
Single-Char Target In Lexicon: 0
Single-Char Indexed: 0
Single-Char Raw Recall Hit: 0
Single-Char Coverage Gap: 229
SINGLE_CHAR_LEXICON_COVERAGE_RATE: 0
base_lexicon length-1 enabled: 0
```

Do not import a 2000–3000 list this round. Next phase must inventory **type / frequency / production scope** of these 229 (content / homophone / 定→订 vs leftover script-adjacent).

---

## 9. FineSpan secondary

Eligibility gap remains **10 units**. After D binding fix, Model2 D wrong-span WindowCandidates are gone; **d090 BASE `上线`** is the remaining `CANDIDATE_BOUND_TO_WRONG_SPAN` (out of D-fix scope). 1-char PathFineSpan vs 2-char exact-align remains legal rejection.

FineSpan design change: **NO**.

---

## 10. Decision rules applied

Most of the original “recall miss” mass is **script normalization + empty single-char table + alignment chunks**, not a mandate to grow generic 2–5 character vocabulary.

Where a true-recall target is missing: record **LEXICON_COVERAGE_GAP** (345). Where it exists but no matching-length FineSpan query exists: **QUERY_GENERATION_GAP** (34). Where raw hit would exist but candidate missing: not observed as a materialization bug among the 379.

---

## Required final verdict

```
Post-Trace Freeze: PASS
MATERIALIZABLE_TARGET_V1: FROZEN
Model2: FROZEN
Assembly: FROZEN
FineSpan Architecture: FROZEN
Candidate Budget: FROZEN
KenLM: FROZEN

CONFIRMED FIXES
Model2 D Wrong-Span Binding: FIXED
Business Behavior Changed: NO
Trace Observation Fields: COMPLETE

RESPONSIBILITY
Total Correction Units: 601
Lexical Recall Responsibility: 405
Normalization Responsibility: 145
Single-Char / Function Word: 30
Insert/Delete: 16
Punctuation: 0
ASR Unrecoverable: 5
Ownership Gap: 145

TRUE RECALL
True Recall Responsibility N: 405
Target Exists In Lexicon: 38
Target Missing From Lexicon: 367
Indexed: 38
Query Generatable: 191
Raw Base Recall Hit: 38
Raw P Recall Hit: NOT_APPLICABLE
Raw D Recall Hit: NOT_APPLICABLE
Candidate Materialized: 4
Post-Budget Present: 4

RECALL ROOT CAUSE
LEXICON_COVERAGE_GAP: 345
LEXICON_INDEX_GAP: 0
QUERY_GENERATION_GAP: 34
NORMALIZATION_MISMATCH: 0
PINYIN_MISMATCH: 0
TONE_MISMATCH: 0
FUZZY_DISTANCE_REJECT: 0
LENGTH_GATE_REJECT: 0
BASE_RECALL_MISS: 0
P_RECALL_MISS: 0
D_RECALL_MISS: 0
CANDIDATE_MATERIALIZATION_BUG: 0
CANDIDATE_BINDING_BUG: 0
BUDGET_PRUNE: 0
OTHER: 0

OUTSIDE RECALL
SCRIPT_NORMALIZATION: 145
PUNCTUATION: 0
INSERT_DELETE: 16
FUNCTION_WORD: 30
NON_LEXICAL_EDIT: 0
ASR_UNRECOVERABLE: 5

SINGLE CHARACTER
Single-Char Responsibility N: 229
Single-Char Target In Lexicon: 0
Single-Char Indexed: 0
Single-Char Raw Recall Hit: 0
Single-Char Coverage Gap: 229

FINESPAN SECONDARY
Eligibility Gap Before: 10 units
Eligibility Gap After Binding Fix: 10 units
Wrong-Span Binding Remaining: 1 (BASE d090)
FineSpan Design Change Required: NO

DECISION
Primary Product Bottleneck: script-normalization ownership gap + empty single-char lexicon vs frozen design + residual 2-char coverage/query-generation
Lexicon Expansion Required: NOT_YET_PROVEN
Recall Algorithm Fix Required: NOT_YET_PROVEN
Normalization Fix Required: YES (restore existing OpenCC onto ASR/repair — not this round)
Single-Char Lexicon Work Required: NOT_YET_PROVEN (inventory first; table is empty vs 2000–3000 design)
Model2 Retraining Required: NO
Assembly Work Required: NO
FineSpan Work Required: SECONDARY
Architecture Change Proposal: NO
Recommended Next Phase: NORMALIZATION_RESTORE_PROPOSAL + SINGLE_CHAR_COVERAGE_INVENTORY (no import, no training, no FineSpan redesign)
```
