# Lingua Dialog200 Residual Divergence Root-Cause Audit V1

**Mode:** READ_ONLY · TRACE_FIRST · CONTRACT_FIRST · NO_IMPLEMENTATION  
**Cases:** d149, d160 only  
**Date:** 2026-09-23

---

## 1. Executive Verdict

Two residuals remain after Multi-Batch Alignment State Repair V1. They are **independent**.

| Case | True first | Verdict |
|------|------------|---------|
| **d149** | Base unique surface set divergence (before Path 4→2) | **Real Capture↔Replay mid-stage divergence** — `D149-D`. Flat counts 50→28 are **not** comparable Base sizes. |
| **d160** | E14 ordered top-list identity with identical KenLM inputs; top1/gate/final preserved | **Evaluator + observability / tie-contract defects** — `D160-H`. No Production KenLM defect proven. |

**Overall:** `E. MIXED_EVALUATOR_AND_OBSERVABILITY_DEFECTS` (d149 also carries a real Base-set residual that is **not** evaluator-only).  
**Next Owner:** `EVALUATOR_REPAIR` (proven false measurement/attribution). d149 Base *why* needs a follow-on observability/query audit — **not** FUNNEL, **not** this round.

Replay equivalence remains **uncertified**. E18 200/200 does **not** certify stage-by-stage equivalence.

---

## 2. Frozen Authority / Scope

Accepted and not reopened:

1. EVALUATION_SSOT_V1  
2. Frozen Acoustic Evidence = Dialog200 SSOT  
3. Historical baseline retired  
4. Alignment reconstruction VALIDATED (`segmentTimeOffsetsSec`, `asrSegmentNodeBatchIndices`, `segmentCharOffsets`)  
5. d157 + prior seven E18 mismatches resolved  
6. E18 = 200/200; Critical FAIL = 0  
7. Production algorithms unchanged by alignment repair  
8. Evaluator defects known; TRUSTED_DIALOG200_FUNNEL_V2 remains BLOCKED  

Scope: **only** d149 + d160. No production / replay / evaluator / SSOT / baseline / ASR / Tone / KenLM / lexicon / threshold changes.

---

## 3. Known Evaluator Limitations (reconfirmed in code)

| Defect | Location | Status this round |
|--------|----------|-------------------|
| Unsupported promotion thresholds | `decidePromotion` | Not fixed; not used as authority |
| `EXPECTED_NONDETERMINISM` without Frozen Contract | `classifyDivergence` E6/E7/E14/E15 | **PROVEN** misuse on both residuals |
| `fine_spans` vs production `finespans` | `compactPathFromTrace` / capture compact | **PROVEN** — E5 vacuous |
| E16 NOT_CAPTURED while E17 scored | contract | Known |
| `.slice(0,48)` on compact surfaces | compact extract | Present; not material for d149 path-local sizes |
| `firstDivergence` order puts E7 before E3 | `order = [..., E7, E6, E3, ...]` | **PROVEN** attribution artifact on d149 |
| E15 inferred from E14 tops | `compareCaptureReplay` E15 | **PROVEN** |

---

## 4. d149 Existing Evidence

- Final IDENTICAL  
- Alignment OK: offsets `[0, ~1.2]`, indices `[0,1]`, charOffsets `[0,6]`  
- Evaluator firstDivergence: `E7_PATH_COUNT:EXPECTED_NONDETERMINISM` (**not authoritative**)  
- Reported: E3 50→28, E4 84→44, E6/E7 4→2  

---

## 5. d149 Pipeline Trace

| Step | Result |
|------|--------|
| D149-B1 Frozen ASR / segments | Injected; E1 PASS |
| D149-B2 Frozen Tone slices | Injected; tone inference skipped |
| D149-B3 Restored alignment | OK |
| D149-B4 WordTimeSpans | Live `wordTimeSpanCount=11`; some multi-char windows report `no_word_timespan_for_slot` — capture parity **UNKNOWN** |
| D149-B5 Mapped Tone | Single-char queries present (e.g. 合/`he2`, 是/`shi2`, 三/`san4`); full capture table **NOT_CAPTURED** |
| D149-B6 FineSpan | Live `finespans` arrays exist; compact looks for `fine_spans` → empty surfaces → E5 vacuous PASS |
| D149-B7–B8 Window / Canonical queries | **UNKNOWN** (not in capture SSOT) |
| D149-B9–B11 Base | **PROVEN unique-set divergence** (see §6–7) |
| D149-B12–B13 Model2 / union | Diff mirrors Base; not independently causal |
| D149-B14 LexicalEdge | Graph identity **UNKNOWN** (wrong compact field) |
| D149-B15 Paths | 4→2; replay path_ids ⊂ capture path_ids |

Stop causal attribution at first **proven** semantic delta: **Base unique surfaces**.

---

## 6. d149 E3 Count Semantics

**Code:** `compareCaptureReplay` → `capture_n: capPaths.flatMap(p => p.base_candidates).length` with equality via `eqSet`/`sortedUnique`. Per-path lists from `surfacesFromPack(...).slice(0,48)`.

| Question | Answer |
|----------|--------|
| What is counted? | Path-local compact Base **surfaces**, flatMapped across paths |
| Before/after dedup for `n`? | **Before** (cross-path duplicates counted) |
| Duplicates included in `n`? | **Yes** |
| `.slice(0,48)`? | Yes per path; **not material** here (sizes 12–14) |
| Same schema / boundary? | Yes — compact path-local packs |

**D149_E3_COUNT_COMPARABLE = NO**

Therefore **50→28 must not be treated as Base divergence**. It scales with path multiplicity (4 paths × ~12–13 vs 2 × 14). Unique sizes are **both 21**.

---

## 7. d149 Base / Model2 / Edge / Path Analysis

### Base unique sets (authoritative for set identity)

**MISSING_IN_REPLAY:** 三, 合, 合适, 推, 是  
**EXTRA_IN_REPLAY:** 何时, 天, 把, 散, 腿  

Same path_ids only (`2913b934`, `8c9b3f82`):

- Capture subset unique still has **合适 / 三 / 推**  
- Replay has **何时 / 天 / 散 / 把 / 腿** instead  

→ **Real Base surface-set divergence**, not merely flatMap scaling.

### Model2 84→44

Downstream of path multiplicity + Base cascade. **Not independently causal.**

### LexicalEdge / Path

- Replay keeps exactly capture paths #3–#4 (0-based).  
- Missing two alternate `path_id`s ⇒ non-identical complete path set.  
- Path enum is deterministic given identical edges+caps → edges/candidates space differs, **or** edge evidence is missing.  
- E5 PASS is **vacuous** (`finespans` vs `fine_spans`).  
- **LEXICAL_EDGE_GRAPH_IDENTICAL = UNKNOWN**  
- Do **not** label Path 4→2 as `EXPECTED_NONDETERMINISM`.

---

## 8. d149 True First Divergence

**TRUE_PIPELINE_FIRST_DIVERGENCE = Base unique surface set (E3 semantic)**  

Evaluator-observed first = E7 (order artifact + secondary remap).

---

## 9. d149 Result

**D149-D — BASE_RECALL_RESULT_DIVERGENCE_PROVEN**

| Field | Value |
|-------|-------|
| Top-level class | Residual Capture↔Replay behavioral divergence at Base; plus evaluator count/attribution defects |
| Secondary | `COUNT_SEMANTICS_MISMATCH`, `CANDIDATE_RESULT_DIVERGENCE`, `COMPARATOR_SCHEMA_MISMATCH`, `LEXICAL_EDGE_CASCADE` |
| Evidence | **PROVEN** (unique sets + same-path_id subset) |
| Production defect? | **NO** (upstream Window/Tone query identity not proven; no algorithm change authorized) |

---

## 10. d160 Existing Evidence

- Final IDENTICAL; Path 2=2; Alignment OK  
- E13 KenLM input set: PASS  
- E14 ordered tops: FAIL  
- E15 FAIL (inferred)  
- Label `EXPECTED_NONDETERMINISM`: **unsupported**

---

## 11. d160 KenLM Input Analysis

Live frozen replay vs capture:

- **KENLM_INPUT_SET_IDENTICAL = YES**  
- **KENLM_INPUT_ORDER_IDENTICAL = YES**  
- Candidate count 4; E12 pool count PASS  

E14 is **not** explained by input set/order divergence.

---

## 12. d160 Score / Rank / Tie Analysis

Capture does **not** persist KenLM scores → **KENLM_SCORE_IDENTICAL = UNKNOWN** (capture↔replay).

Live replay scores (`sentenceRerank.topCandidates`):

| Rank | Id | Text (abbrev) | Score | Δ vs raw |
|------|-----|----------------|-------|----------|
| 1 | raw | …上一段… | −60.280518 | 0 |
| 2 | candidate:3 | …上一段… (same text) | −60.280518 | 0 |
| 3 | candidate:1 | …上议… | −63.05818 | −2.78 |

**Exact tie** raw ↔ candidate:3 (`absDelta = 0` ≤ 1e-6).

Production sort (`rerank-fw-sentences.ts`):

```text
(b.kenlmScore - a.kenlmScore) || (b.deltaVsRaw - a.deltaVsRaw)
```

No text / path secondary key.

**KENLM_EQUAL_SCORE_ORDER_CONTRACT = UNDEFINED**

Capture rank2 = **商议**; live rank2 = tied duplicate **上一段**. 商议’s live Δ≈−2.82 — **not** a live tied peer. Without capture scores, historical score equality is **NOT_EVALUABLE**.

**Top1 differs? NO.**

---

## 13. d160 E15 Measurement Audit

- Explicit KenLM gate decision **not** in capture  
- **E15_EXPLICIT_CAPTURE_EVIDENCE = NO**  
- Evaluator: when finals equal, E15 ⇔ `eqOrdered(kenlm_tops)` → **duplicate of E14**  
- Per EVALUATION_SSOT: missing evidence ⇒ **NOT_EVALUABLE**, not FAIL  
- Live: `maxDelta=0 < minDeltaToReplace=3` → keep-raw; consistent with Final  

---

## 14. d160 Semantic Impact

**D160_DIVERGENCE_SEMANTIC_IMPACT = ORDER_ONLY**

- Not FINAL_AFFECTING  
- Not TOP1_AFFECTING  
- Not GATE_AFFECTING (gate not captured; live keep-raw aligns with Final)  

---

## 15. d160 True First Divergence

**TRUE_PIPELINE_FIRST_DIVERGENCE = E14 ordered top-list text identity**  
(with identical KenLM inputs; top1/final preserved). Not KenLM input divergence. Not a proven Production scoring defect.

---

## 16. d160 Result

**D160-H — MULTIPLE_INDEPENDENT_ROOT_CAUSES**

1. Evaluator ORDERED_IDENTITY / unsupported nondeterminism label (**≈ D160-A**, PROVEN)  
2. Missing gate evidence → E15 false FAIL (**≈ D160-F**, PROVEN)  
3. Unspecified equal-score order contract (**≈ D160-D**, PROVEN on live)  
4. Capture score observability gap (PARTIAL for explaining capture rank2 = 商议)  

Production defect? **NO.**

---

## 17. Root-Cause Matrix

| Case | Evaluator First | True First | Root Cause | Top-Level Class | Secondary Tag | Evidence Strength | Production Defect? | Repair Owner |
|------|-----------------|------------|------------|-----------------|---------------|-------------------|--------------------|--------------|
| d149 | E7_PATH_COUNT:EXPECTED_NONDETERMINISM | Base unique surface set (pre-E7) | Real Base candidate-set divergence; 50→28 count semantics misleading; Path 4→2 cascade / unknown edges | OBSERVABILITY GAP + residual Capture↔Replay Base divergence | COUNT_SEMANTICS_MISMATCH; CANDIDATE_RESULT_DIVERGENCE; COMPARATOR_SCHEMA_MISMATCH | PROVEN | NO | FURTHER_RESIDUAL_AUDIT / TARGETED_OBSERVABILITY (after evaluator repair) |
| d160 | E14_KENLM_RANKING:EXPECTED_NONDETERMINISM | E14 ordered tops (inputs identical; top1/final OK) | Evaluator order+E15 inference+undefined tie order; capture scores absent | 2 TEST / EVALUATOR DEFECT | KENLM_TIE_ORDER; MISSING_GATE_EVIDENCE | PROVEN (eval); PARTIAL (hist. scores) | NO | EVALUATOR_REPAIR |

---

## 18. Evaluator Repair Target List

**Proven only — do not implement this round:**

1. **Remove** unsupported `EXPECTED_NONDETERMINISM` legalization in `classifyDivergence` (E6/E7/E14/E15 when E18 PASS).  
2. **Fix first-divergence attribution** to true pipeline order (E3 before E7; do not let E7 remap hide independent E3 set failure without stating count vs set).  
3. **Fix FineSpan field ownership:** read production `finespans` (not only `fine_spans` / `path_fine_spans` / `spans`) so E5 is not vacuous.  
4. **E3/E4 `capture_n`/`replay_n`:** report unique-set size (and optionally per-path), or label flatMap length as `flat_n` — do not imply Base set cardinality.  
5. **Remove `.slice(0,48)` from authoritative equality** (keep only as display cap, or raise with explicit NON_AUTHORITATIVE).  
6. **E14:** do not require full ORDERED_IDENTITY of top texts unless Frozen Contract defines total order; prefer top1 / score-within-tolerance / gate decision.  
7. **E15:** if explicit gate absent → **NOT_EVALUABLE**; never infer solely from E14 ordered tops.  
8. **E16/E17:** E16 missing ⇒ E17 must not be treated as fully measured unless independent contract satisfied (pre-known; still open).  
9. **Promotion thresholds** (`e18Rate≥0.95` etc.): remain unauthorized — do not use as Replay certification.

Promotion threshold removal and SSOT-aligned stage semantics remain as governance items already known.

---

## 19. Required Questions

### d149

| Id | Answer |
|----|--------|
| Q1 ASR boundaries identical? | **YES** |
| Q2 Alignment ≡ capture semantics? | **YES** |
| Q3 WordTimeSpans identical? | **UNKNOWN** |
| Q4 Mapped Tone identical? | **UNKNOWN** |
| Q5 FineSpans comparable? | **NO** (comparator field miss) |
| Q6 WindowQueries identical? | **UNKNOWN** |
| Q7 CanonicalRecallQueries identical? | **UNKNOWN** |
| Q8 What do 50 and 28 count? | flatMap of path-local compact Base surfaces (duplicates across paths) |
| Q9 Counts comparable? | **NO** |
| Q10 Full Base sets available? | **PARTIAL** (compact surfaces yes) |
| Q11 First candidate delta? | 合适/合/是/三/推 missing in replay; 何时/… extra; same-path_id subset also diverges |
| Q12 Model2 84→44 independently causal? | **NO** |
| Q13 LexicalEdge graphs identical? | **UNKNOWN** |
| Q14 Why Path 4→2? | Only 2/4 capture path_ids retained; edge graph not proven identical; not authorized nondeterminism |
| Q15 TRUE first? | **Base unique surface set** |
| Q16 Production defect proven? | **NO** |

### d160

| Id | Answer |
|----|--------|
| Q1 Input sets identical? | **YES** |
| Q2 Input orders identical? | **YES** |
| Q3 Scores identical within 1e-6? | **UNKNOWN** (capture scores absent) |
| Q4 Rank swaps? | Rank2: 商议 ↔ duplicate 上一段 |
| Q5 Tied / near-tied? | Live: raw↔candidate:3 **exact tie**; capture#2 商议 not a live tie peer |
| Q6 Tie ordering defined? | **UNDEFINED** |
| Q7 Deterministic under identical inputs? | **PARTIAL** (scores; equal-score order not totally contracted) |
| Q8 Top1 differs? | **NO** |
| Q9 Explicit gate differs? | **NOT_EVALUABLE** |
| Q10 Gate captured? | **NO** |
| Q11 E15 measurable? | **NO** |
| Q12 Semantic impact? | **ORDER_ONLY** |
| Q13 TRUE first? | **E14 ordered top-list identity** (inputs OK) |
| Q14 Production defect proven? | **NO** |

---

## 20. Overall Result

**E. MIXED_EVALUATOR_AND_OBSERVABILITY_DEFECTS**

- d149: real Base-set residual **plus** evaluator count/attribution/finespans defects  
- d160: evaluator order/E15/tie-contract **plus** missing capture scores  

Not `BOTH_RESIDUALS_EVALUATOR_ONLY`. Not `PRODUCTION_DEFECT_FOUND`.

---

## 21. Next Owner

**EVALUATOR_REPAIR**

Do **not** select TRUSTED_DIALOG200_FUNNEL_V2.

After evaluator measurement is honest: schedule **TARGETED_OBSERVABILITY_CAPTURE** / **FURTHER_RESIDUAL_AUDIT** for d149 WindowQuery / Tone-mapping / edge tables that explain 合适→何时 — still READ-gated; no production patch from this audit.

---

## HARD STOP

No Replay / evaluator / Production / comparator / threshold / SSOT / baseline / ASR / Tone / KenLM / lexicon / Model2 / case-patch changes were made.

### Artifacts

1. `docs/user_correction/model3/LINGUA_DIALOG200_RESIDUAL_DIVERGENCE_ROOT_CAUSE_AUDIT_V1.md` (this file)  
2. `docs/user_correction/model3/LINGUA_DIALOG200_D149_RESIDUAL_TRACE_V1.json`  
3. `docs/user_correction/model3/LINGUA_DIALOG200_D160_RESIDUAL_TRACE_V1.json`  
