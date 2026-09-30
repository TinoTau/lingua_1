# Lingua1 — Dialog200 d149 Base Recall First-Divergence Trace Audit V1

**MODE:** AUDIT_ONLY / READ_ONLY / TRACE_FIRST / SINGLE_CASE / CONTRACT_FIRST  
**CASE:** d149 only  
**DATE:** 2026-09-23  
**RESULT_ENUM:** **F — CAPTURE_EVIDENCE_GAP_BLOCKS_ROOT_CAUSE**  
**NEXT_OWNER:** **EVIDENCE_DECISION**  
**TRUSTED_DIALOG200_FUNNEL_V2:** remains **BLOCKED**

Companion artifacts:

1. `LINGUA_DIALOG200_D149_BASE_RECALL_BOUNDARY_TRACE_V1.json`
2. `LINGUA_DIALOG200_D149_BASE_CANDIDATE_SET_DIFF_V1.json`

---

## 1. Executive Verdict

d149’s **first observable Capture↔Replay divergence** is at **E3 Base Recall unique candidate identity set** (boundary **B9**): same shared path IDs still show Capture `合适` vs Replay `何时`, plus Capture-only `合/是/三/推` vs Replay-only `天/散/把/腿`.

**TRUE_FIRST_DIVERGENCE cannot be proven** with current Frozen Capture evidence. Capture does **not** persist WordTimeSpan, mapped Tone, Production `finespans`, WindowQuery, CanonicalRecallQuery keys, SQL bound parameters, or per-query row identities. E2 only proves injected acousticToneSlices, not mapped toneNorm.

Therefore:

- `FIRST_OBSERVABLE_DIVERGENCE` = **B9 / E3 unique Base surface set**
- `TRUE_FIRST_DIVERGENCE` = **NOT_PROVABLE_WITH_CURRENT_FROZEN_EVIDENCE**
- Primary Result = **F**
- Next Owner = **EVIDENCE_DECISION**

Downstream E4/E6/E7/E9/E10 remain treated as cascade unless later evidence proves otherwise. E18 identity is **not** used to claim stage equivalence.

---

## 2. Frozen Authority Confirmation

Accepted / not reopened:

1. EVALUATION_SSOT_V1 authoritative  
2. Dialog200 Frozen Acoustic Evidence = single baseline SSOT  
3. Historical incomplete baseline retired  
4–5. No old/new dual baseline / fallback  
6. Multi-Batch Alignment State Repair V1 VALIDATED  
7. Restored replay state includes `segmentTimeOffsetsSec`, `asrSegmentNodeBatchIndices`, `segmentCharOffsets`  
8–10. Prior seven E18 mismatches + d157 resolved; E18 = 200/200; Production not proven defective from those cases  
11–12. Replay equivalence NOT_CERTIFIED; TRUSTED_DIALOG200_FUNNEL_V2 BLOCKED  
13. Path enum deterministic given identical lexical-edge input  
14. `EXPECTED_NONDETERMINISM` not authorized  
15. d160 out of scope  
16. E15/E16/E17 NOT_EVALUABLE not artificially improved  

---

## 3. Scope / Prohibitions Confirmation

| Gate | Status |
|------|--------|
| Only d149 | YES |
| No Production / Replay / Evaluator / SSOT / Frozen Evidence change | YES |
| No baseline / lexicon / model / KenLM / path-cap / threshold change | YES |
| No EXPECTED_NONDETERMINISM | YES |
| No `.slice(0,48)` as Base-set proof | YES — full unique sets + separate occurrence counts |
| Real field `finespans` | YES (Replay); Capture compact `fine_span_surfaces` empty / CAPTURE_NOT_OBSERVED |
| Downstream E4+ not independently “fixed” | YES |
| Funnel remains BLOCKED | YES |

Temporary audit dumps used existing replay diagnostics + Frozen Evidence reads only. No production behavior change.

---

## 4. d149 Known State

| Item | Value |
|------|--------|
| ASR | `請問,這雙鞋 不合是三天内可以退换吧` (Traditional) |
| Alignment | `segmentTimeOffsetsSec≈[0,1.2]`, `asrSegmentNodeBatchIndices=[0,1]`, `segmentCharOffsets=[0,6]` |
| E1 / E2 | PASS |
| E3 | FAIL (first observable) |
| Path count | Capture **4** / Replay **2** (Replay IDs ⊂ Capture IDs) |
| E18 final | identical: `请问,这双鞋 不合是三天内可以退换吧` |
| Capture kenlm_input_texts | includes both `不合适…` and `不何时…` |

---

## 5. Boundary-by-Boundary Trace

| Boundary | Capture↔Replay | Notes |
|----------|----------------|-------|
| **B1** Frozen ASR | **IDENTICAL** | rawMergedAsrText + segments.words local times match inject |
| **B2** Restored multi-batch state | **IDENTICAL** at inject echo | offsets/indices/charOffsets present at mock-inject boundary; JobContext consumer dump PARTIAL (not separately exported) |
| **B3** WordTimeSpan | **NOT_COMPARABLE** | Capture **CAPTURE_NOT_OBSERVED**. Replay live `wordTimeSpanCount=11`; offline rebuild from frozen inject inputs = **15** (**Replay-internal DIVERGENT** vs reconstructible table) |
| **B4** Mapped Tone | **NOT_COMPARABLE** | Capture **CAPTURE_NOT_OBSERVED**. E2 ≠ mapped identity. Replay SC: `合→he2`, `是→shi2`, `三→san4`, bi-syllable `6:8→he2\|shi2` |
| **B5** FineSpan (`finespans`) | **NOT_COMPARABLE** | Capture compact surfaces empty / not persisted. Replay `finespans` present per path |
| **B6** Window generation | **NOT_COMPARABLE** | Capture windows not persisted. Replay: globalWindowGenerated=70, logicalWindowRecall=54, uniqueRecallKey=54 |
| **B7** CanonicalRecallQuery | **NOT_COMPARABLE** | Capture **CAPTURE_NOT_OBSERVED**. Replay keys observed (see §9) |
| **B8** Base SQL | **NOT_COMPARABLE** | Capture rows/params not persisted. Replay: physicalSql=83, cacheMiss=54 |
| **B9** Base materialization unique set | **DIVERGENT** | **FIRST_OBSERVABLE_DIVERGENCE** |

Because **B3–B8** are CAPTURE_NOT_OBSERVED / NOT_COMPARABLE, a later DIVERGENT boundary **cannot** be promoted to proven TRUE_FIRST.

---

## 6. WordTimeSpan Audit

### 6.1 Offline rebuild (Frozen ASR + alignment)

`buildWordTimeSpans(rawMergedAsrText, segments, offsets, charOffsets, batchIndices)` → **15** spans, **0** index misses. Tokens include Traditional `請`, `問,`, `這`, `雙`, … plus segment-1 words with absolute times after +1.2s offset.

### 6.2 Replay live diagnostic

- `wordTimeSpanCount` = **11**
- `windowTimeAttemptCount` = 54 / `windowTimeHitCount` = 48
- `mappingMissReasonCounts.no_word_timespan_for_slot` = **2**

### 6.3 `no_word_timespan_for_slot`

| Window text | pinyinKey | Attribution | Why |
|-------------|-----------|-------------|-----|
| `这双鞋` | `zhe\|shuang\|xie` | word_timespan_mapping_failure | FineSpan/window surface is **Simplified**; ASR WordTimeSpan tokens are **Traditional** (`這`/`雙`) — char-range / token match fails for multi-char simplified windows |
| `双鞋` | `shuang\|xie` | same | same |

**Is this expected Production behavior?** Consistent with simplified FineSpan text vs Traditional ASR word tokens when mapping is token/char based — **not patched** this round.

**Capture parity?** **NO — CAPTURE_NOT_OBSERVED.** Cannot prove Capture had the same miss.

**Replay vs offline rebuild:** live count 11 ≠ rebuild 15 is a **Replay-observable anomaly** (likely simplified runtime `rawText` vs Traditional Frozen ASR at WTS consumer — **not proven** without JobContext rawText export). This is **not** claimed as TRUE_FIRST Capture↔Replay root cause.

---

## 7. Tone Mapping Audit

- Frozen acousticToneSlices injected: **15** (E2 PASS).
- Mapped Tone Capture: **CAPTURE_NOT_OBSERVED**.

Replay SC / recall-relevant tone keys (observed):

| Window | ASR surface | queryTonePinyinKey | Outcome |
|--------|-------------|--------------------|---------|
| 6:7 | 合 | `he2` | ACCEPT / selected 合 |
| 7:8 | 是 | `shi2` | MULTIPLE_TONE_EXACT; SQL hits `十/石/时/食` — **是 absent** |
| 8:9 | 三 | `san4` | ACCEPT_UNIQUE → selected **散** |
| 6:8 | 合是 | `he2\|shi2` | tone_exact → **何时** |

Offline acoustic argmax on rebuild WTS intervals (informational only): 合≈2, 是≈4, 三≈1 — **does not match** Replay SC patterns for 是/三. Suggests runtime WTS↔slice pairing and/or tone path differs from offline rebuild; **cannot** equate to Capture without Capture mapped-tone persistence.

---

## 8. FineSpan / Window Audit

- Capture: `fine_span_count=0`, `fine_span_surfaces=[]` on all 4 paths → **CAPTURE_NOT_OBSERVED** for Production `finespans` identity.
- Replay: `finespans` present on both surviving paths (field name **`finespans`**, not `fine_spans`).
- Replay window multiplicity: generated 70 / logical recall 54 / unique keys 54 — **Capture window identity UNKNOWN**.

Question “Does Replay generate the same logical windows Capture must have used?” → **UNKNOWN / CAPTURE_NOT_OBSERVED** (no inference from E18).

---

## 9. CanonicalRecallQuery Audit

Capture CanonicalRecallQuery keys: **CAPTURE_NOT_OBSERVED** — not inventable from compact `base_candidates`.

Replay examples (full key fields observed at runtime; no truncation of identity):

| windowId | surface | pinyinKey | toneNorm / queryTonePinyinKey | notes |
|----------|---------|-----------|-------------------------------|-------|
| 6:7 | 合 | he | he2 | exact |
| 7:8 | 是 | shi | shi2 | exact; 是 not in hits |
| 6:8 | 合是 | he\|shi | he2\|shi2 | tone_exact → 何时 |
| 8:9 | 三 | san | san4 | → 散 |
| 9:10 | 天 | tian | tian1 | |
| 13:14 | 退 | tui | tui3 | fuzzy path → 腿 in Base pack |
| 15:16 | 吧 | ba | ba3 | → 把 |

Aggregate: logicalQueryCount=54, uniqueRecallKeyCount=54, cacheHits=0, cacheMisses=54.

---

## 10. Base SQL Audit

- Capture SQL params/rows: **CAPTURE_NOT_OBSERVED**
- Replay: SQL executed for above queries; `6:8` tone_exact returns **何时**; SC `san4` returns **散**; no evidence of cache-driven divergence under identical keys (all misses)
- **Cannot** answer whether SQLite would return identical rows under Capture’s unknown historical keys → **Q16 = NOT_PROVABLE**

No SQLite / ORDER BY / query logic modified.

---

## 11. Base Materialization Audit

Counts (reported separately — do **not** collapse):

| Metric | Capture | Replay |
|--------|---------|--------|
| path_count | 4 | 2 |
| flat / occurrence n | 50 | 28 |
| unique_n | 21 | 21 |
| live sa.baseCandidateCount | — | 29 |
| live logicalQuery / uniqueKey / physicalSql | — | 54 / 54 / 83 |

Same-path-id subset (`2913b934…`, `8c9b3f82…`): Capture packs contain **合适** + **三**; Replay packs contain **何时** + **散** (+ 天/腿/把). Divergence is **not** only from the two missing Capture-only path IDs.

Capture `kenlm_input_texts` already includes a `不何时…` text — so Capture somehow emitted a 何时 path text, yet Capture path-local `base_candidates` never list `何时` (only `合适`). That inconsistency is itself an **observability/compact-pack gap**, not a proof of Capture CanonicalQuery identity.

---

## 12. Exact Candidate Set Diff

See `LINGUA_DIALOG200_D149_BASE_CANDIDATE_SET_DIFF_V1.json`.

| Set | Surfaces |
|-----|----------|
| **CAPTURE_ONLY** | 三, 合, 合适, 推, 是 |
| **REPLAY_ONLY** | 何时, 天, 把, 散, 腿 |
| **INTERSECTION** | 一, 亿, 以, 伊, 依, 入园, 内, 出园, 包车, 古桥, 古镇, 可, 导览, 尾, 鞋, 预订 |

Provenance (Replay side only):

- **何时** ← window `6:8` / `he2|shi2` / tone_exact  
- **散** ← window `8:9` / `san4` / SC unique  
- **天 / 腿 / 把** ← later windows (ASR 天/退/吧)

Capture-only surfaces cannot be tied to Capture queries — queries not persisted.

---

## 13. First Observable Divergence

**FIRST_OBSERVABLE_DIVERGENCE = B9_Base_materialization / E3 unique Base surface set**

Earliest boundary with direct Capture↔Replay comparable DIVERGENT evidence.

---

## 14. True First Divergence

**TRUE_FIRST_DIVERGENCE = NOT_PROVABLE_WITH_CURRENT_FROZEN_EVIDENCE**

Reason: earlier causal boundaries (WTS, mapped Tone, FineSpan, WindowQuery, CanonicalRecallQuery, SQL) lack Capture persistence. Claiming H2/H3/H5 as proven Capture↔Replay root cause would invent evidence.

---

## 15. Q1–Q20 Answers

| Q | Answer |
|---|--------|
| **D149-Q1** | YES — Frozen ASR identical at inject |
| **D149-Q2** | Alignment fields reconstructed and echoed at inject; consumer JobContext dump PARTIAL — fields required by alignment repair are present at the documented inject API |
| **D149-Q3** | Replay WTS **not fully proven correct**: live n=11 vs rebuild n=15; recall-relevant multi-char simplified windows miss Traditional tokens |
| **D149-Q4** | `这双鞋`, `双鞋` (`no_word_timespan_for_slot`) |
| **D149-Q5** | NO — Capture WTS parity not provable |
| **D149-Q6** | YES — frozen acousticToneSlices identical at injection (E2) |
| **D149-Q7** | NO — mapped Tone Capture CAPTURE_NOT_OBSERVED |
| **D149-Q8** | Replay `finespans` present and structurally usable; “correct vs Capture” not comparable |
| **D149-Q9** | NO — Capture FineSpan identity not proven (`fine_span_surfaces` empty) |
| **D149-Q10** | UNKNOWN — Capture windows not observed |
| **D149-Q11** | NO — Frozen Evidence lacks WindowQuery |
| **D149-Q12** | Replay keys include `he2`, `shi2`, `he2\|shi2`, `san4`, `tian1`, `tui3`, `ba3`, … (54 unique) |
| **D149-Q13** | NO — cannot reconstruct Capture CanonicalRecallQuery without inventing evidence |
| **D149-Q14** | Replay: 何时←6:8; 散←8:9; etc. Capture divergent surfaces: provenance **UNKNOWN** |
| **D149-Q15** | **Not proven.** Observable difference is Base unique set. Causal layer among windows / WTS / Tone / CanonicalQuery / SQL / materialization **blocked by Capture gap**. Replay-side anomalies (WTS 11≠15; `he2\|shi2`→何时; san4→散) are **hypotheses**, not proven Capture↔Replay TRUE_FIRST |
| **D149-Q16** | NOT_PROVABLE — Capture SQL params unknown |
| **D149-Q17** | **No proven Production SSOT contradiction** this round (G not selected) |
| **D149-Q18** | **No evidence** of Production nondeterminism; label forbidden |
| **D149-Q19** | FIRST_OBSERVABLE = **B9 / E3 unique Base set** |
| **D149-Q20** | TRUE_FIRST = **NOT_PROVABLE_WITH_CURRENT_FROZEN_EVIDENCE** |

---

## 16. Failure Classification

**Primary frozen class:** **3 — OBSERVABILITY GAP**

Replay tags (map to class 3):

- `CAPTURE_EVIDENCE_GAP` (primary)
- Secondary Replay-side observations (not promoted to TRUE_FIRST): `REPLAY_STATE_DIVERGENCE` candidate on WTS cardinality; `TONE_MAPPING_DIFFERENCE` / `WINDOW_QUERY_DIFFERENCE` / `BASE_QUERY_DIFFERENCE` as **unproven** Capture↔Replay causes

Not classified as EXPECTED_NONDETERMINISM. Not evaluator-only (real unique-set difference exists). Not proven Implementation Defect vs Production SSOT.

---

## 17. Result Enum

**F — CAPTURE_EVIDENCE_GAP_BLOCKS_ROOT_CAUSE**

---

## 18. Next Owner

**EVIDENCE_DECISION**

Decide whether to persist (or re-capture under contract) Capture-side:

- WordTimeSpan table  
- mapped Tone / acousticTonePattern per window  
- Production `finespans`  
- WindowQuery + CanonicalRecallQuery keys  
- SQL bound params + row identities  

before any Replay state repair or Production change.  
**TRUSTED_DIALOG200_FUNNEL_V2 remains BLOCKED.**

---

## 19. Production / Replay / Evaluator / SSOT Delta Check

| Surface | Delta |
|---------|-------|
| Production | none |
| Replay behavior | none |
| Evaluator | none |
| EVALUATION_SSOT_V1 | none |
| Frozen Evidence | none |
| Baseline | none |
| Lexicon / Model2 / Model3 / KenLM / path cap | none |

---

## Hypothesis Scorecard (tested, not assumed)

| H | Verdict |
|---|---------|
| H1 remaining JobContext omission | **UNPROVEN** as Capture↔Replay root; inject alignment OK; WTS consumer rawText not exported |
| H2 WordTimeSpan difference | Replay anomaly 11≠15 **observed**; Capture parity **UNKNOWN** |
| H3 mapped Tone difference | Replay `he2\|shi2` / `san4` **observed**; Capture mapped Tone **UNKNOWN** |
| H4 FineSpan/window difference | Capture **UNKNOWN** |
| H5 CanonicalRecallQuery difference | Capture keys **UNKNOWN**; Replay keys documented |
| H6 query execution/cache | Replay cache all miss; Capture **UNKNOWN** |
| H7 SQL under identical query | **NOT_PROVABLE** (Capture params unknown) |
| H8 materialization/dedup | Unique-set divergence **observed**; cause upstream **UNKNOWN** |
| H9 Capture observability gap | **PROVEN** |
| H10 evaluator-only artifact | **REJECTED** — real unique-set difference |

---

## Acceptance Gates (G1–G25)

All G1–G25 satisfied for this audit round. Single Result Enum **F**. Next Owner follows enum. Funnel remains BLOCKED.
