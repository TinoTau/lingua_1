# Lingua — Retry "One Bounded Local Re-Segmentation" Historical SSOT Audit

**Phase:** `RETRY_ONE_BOUNDED_RESEGMENTATION_HISTORICAL_SSOT_AUDIT`  
**Date:** 2026-08-29  
**Mode:** Strict read-only historical design audit  

---

## MAIN VERDICT

**RETRY_ONE_BOUNDED_RESEGMENTATION: `SEMANTIC_IMPLEMENTATION_DRIFT`**

Historical frozen design supports **Semantic A** (one bounded Retry **operation** per utterance). Current Retry implementation narrowed this into **Semantic B behavior** (consume exactly **one** `SegmentationPath`) without an approved architecture change.

---

## PHRASE ORIGIN

| Field | Value |
|-------|-------|
| **Earliest Source** | `MODEL3_ARCHITECTURE_CONTRACT_V1.md` (effective 2026-08-23) |
| **Date** | 2026-08-23 (re-segmentation phrase added 2026-08-28) |
| **Authority Level** | LEVEL_1 (Architecture SSOT) |
| **Original Context** | Model3 role correction: text-only KEEP/RETRY trigger requesting **bounded local re-recall**, not corrected text. Hard limits forbid recursive retry, second Model3, second Domain Vote, candidate explosion. |
| **"one" modifies** | **ONE_RETRY_ATTEMPT / ONE_RESEGMENTATION_PASS** (utterance-level bounded retry cycle) |
| **Original problem being prevented** | Recursive retry · repeated Model3 · second Domain Vote · unbounded latency · candidate explosion · second ASR / second Recall pipeline |

**Phrase evolution:**

- **2026-08-23–26:** "one bounded local **re-recall**" / "one bounded local Lexicon Recall retry" (no re-segmentation yet)
- **2026-08-28:** `model3_retry_contract_v1.md` adds "**re-segmentation +** re-recall" after Retry Region correction — still coupled to **Retry cycles ≤ 1**, not path cardinality

**Not found:** Any pre-implementation Level-1 document requiring **exactly one SegmentationPath** inside Retry.

---

## FINESPAN ORIGINAL CONTRACT

| Question | Answer |
|----------|--------|
| **Purpose** | Generate contiguous **1–5 syllable windows**, Recall-derived **LexicalEdges**, and **bounded complete SegmentationPaths** — not a single deterministic tokenizer |
| **Tokenizer or Candidate-Window Generator** | **Candidate-window generator** (Lattice Architecture V1.0.0 §4–§8) |
| **Overlapping local spans intended** | **YES** — full-utterance windows 1..5; multiple complete paths retained when caps allow |
| **Multiple local hypotheses** | **YES** — `SegmentationPath[]` is sole Fine Span SSOT; explicitly **forbids** "must pick unique boundary before Domain Vote" |
| **Pre-Recall single-path requirement** | **NOT_FOUND** |

**FINESPAN VERDICT:** `FINESPAN_MULTI_WINDOW_CONTRACT`

**Original flow (Lattice Architecture, 2026-07-26):**

```text
ASR → UtteranceSyllableCoordinate
→ contiguous 1–5 WindowQuery
→ SQLite Lexicon Recall
→ LexicalEdge[]
→ SegmentationPath[]          ← multiple hypotheses retained
→ per-Path Domain Vote
→ per-Path Assembly
→ Global merge ≤16
→ KenLM
```

FineSpan responsibility: **expose plausible local spans/windows so Recall can retrieve candidate lexical items** — not "decide the one true segmentation" before downstream processing.

---

## RETRY ORIGINAL CONTRACT

| Question | Answer |
|----------|--------|
| **Retry Region meaning** | Bounded raw/syllable/acoustic region where local interpretation is suspicious and may be reinterpreted |
| **One Retry attempt** | **YES** (Retry cycles / utterance ≤ 1) |
| **One Segmentation Path** | **NOT_FOUND** in pre-implementation design |
| **Explicit equivalence Region = Path** | **NO** |
| **Recursive Retry forbidden** | **YES** |
| **Second Model3 forbidden** | **YES** |
| **Second Domain Vote forbidden** | **YES** |

**Original Retry purpose (2026-08-28 ownership audit, pre-correction):**

> "The current local interpretation is suspicious. Re-run **bounded local postprocessing**."

Feasibility explicitly included: derive region · merge adjacent RETRY · **reuse FineSpan/window generation** · local re-segmentation · preserve retry-once / Vote-once.

**Not stated:** "Choose one replacement segmentation path and discard others."

**2026-08-28 correction report** implemented: region → **local lattice re-segmentation on slice** → `recallSpanTopKV2` per local span. It does **not** document single-path discard as a business rule.

---

## CURRENT IMPLEMENTATION (observed, not SSOT)

| Phase | Behavior |
|-------|----------|
| **First pass** | `for (const view of lattice.pathFineSpanViews)` — **all** retained paths |
| **Retry** | Regional `runLatticeFineSpanGeneration` → `preferredPathFineSpanView` → **one** `SegmentationPath` → per-span recall on that path's FineSpans only |

| Field | Value |
|-------|-------|
| **preferredPathFineSpanView introduced** | Initial Retry Region correction, **2026-08-28** |
| **First form** | `pathFineSpanViews[0]` (boundaryKey ASC, not best-first) |
| **Later fix** | `compareSegmentationPathBestFirst(...)[0]` — changed **which** path, not **how many** |
| **Reason in reports** | Technical correction / deterministic selection — **not** cited user business requirement |
| **Explicit business requirement for one path** | **NOT_FOUND** |

---

## ARCHITECTURE CHANGE HISTORY

| Question | Answer |
|----------|--------|
| **Explicit change from multi-hypothesis Retry to single-path Retry** | **NO** |
| **ACP / user-approved architecture change found** | **NO** |

---

## SEMANTIC COMPARISON

### Semantic A evidence (one Retry operation)

- MODEL3 Architecture §1, §3, §5: one bounded local re-recall; Retry cycles ≤ 1
- Retry contract hard limits: no recursion, no second Model3, no second Domain Vote
- Ownership audit §F: reuse window generation; bounded region reinterpretation
- Lattice Architecture: multi-path is normative for FineSpan/lattice (establishes what "re-segmentation" means mechanically)

### Semantic B evidence (one SegmentationPath)

- **Only** post-implementation code path (`preferredPathFineSpanView` / `[0]`)
- Path selection correction report (2026-08-28) — describes **ranking** of the one consumed path
- Later audit (2026-08-29) interpreting phase difference as intentional — **backward justification risk**

### Higher-authority evidence supports

**Semantic A** as the **original business constraint** on Retry **execution**.  
**Semantic B** appears as **implementation narrowing** without Level-1 authorization.

---

## ARCHITECTURE DRIFT

| Field | Value |
|-------|-------|
| **Architecture Semantic Drift** | **YES** |
| **Original Frozen Contract** | One bounded Retry operation with local lattice re-segmentation + re-recall inside derived region(s); reuse existing window/lattice machinery; first-pass retains multiple `SegmentationPath`s |
| **Current Implementation** | Retry discards all but one regional `SegmentationPath` before per-span recall |
| **First Drift Point** | `model3-retry-region-resegment.ts` initial region correction (2026-08-28): `pathFineSpanViews[0]` |
| **Affected Files** | `model3-retry-region-resegment.ts` (consumer: `model3-retry-router.ts`) |

---

## D160 TRACE (example only)

| Field | Value |
|-------|-------|
| **Region** | 顺便向木李 |
| **Current selected path** | 顺 \| 便 \| 向 \| 木 \| 李 |
| **Path classification** | `STRUCTURALLY_VALID_COMPLETE_SEGMENTATION_PATH`; **FALLBACK-HEAVY** (all length-1 edges) |
| **Regional paths enumerated** | 4 |
| **Alternative local hypotheses exist** | **YES** (paths with lexical/multi-char edges exist per controlled metrics) |
| **Would original FineSpan contract allow alternatives to reach Recall** | **YES** at regional lattice window recall layer; **AMBIGUOUS** for per-span Retry recall on non-selected path FineSpans |

No ranking recommendations. Reference 项目里 is validation context only.

---

## RETRY CONSUMER VERDICT

**`RETRY_CONSUMER_DRIFT`**

---

## PREVIOUS COVERAGE STATISTICS (26 vs 29)

| Item | Value |
|------|-------|
| Reported repair units | 26 |
| Published category sum (prior MD) | 29 |
| **Cause** | Summary table used WINDOW_BOUNDARY=13; authoritative units CSV has **11** |
| Correct primary sum | 9+11+2+1+1+2 = **26** |
| **Invariant** | **PASS** |

---

## TRAINING GATES

| Gate | Verdict | Reason |
|------|---------|--------|
| **ARCHITECTURE_TRAINING_GATE** | **OPEN** | Model3/Retry structural chain operable |
| **DEVELOPMENT_SEQUENCE_GATE** | **HOLD** | Retry consumer semantic drift unresolved — requires user decision before treating single-path Retry as authorized |

---

## NEXT PHASE

**`RETRY_MULTIHYPOTHESIS_MINIMAL_CORRECTION_AUDIT`**

Do **not** execute automatically. Do **not** change ranking, budgets, or production code in this phase.

Alternatives for user review: `SSOT_CLARIFICATION_REQUIRED` · `ACP_REQUIRED` · `KEEP_CURRENT_RETRY_SINGLE_PATH`

---

## OWNERSHIP (unchanged)

Model3 · Retry Region · FineSpan · Lattice · Recall · Domain Vote · Assembly: **KEEP**  
Lexicon: **COVERAGE_GAP** (from prior audit)

---

## GOVERNANCE

Production / tests / SSOT / architecture / Lexicon / Recall / FineSpan / Lattice / Model3 / training / config / JobResult modified: **NO**  
New fallback: **NO**  
Artifact count: **5** (≤10)

1. `Lingua_Retry_One_Bounded_Resegmentation_Historical_SSOT_Audit_2026_08_29.md` (this file)
2. `retry_semantic_chronology.csv`
3. `retry_ssot_evidence_matrix.csv`
4. `retry_semantic_audit_summary.json`
5. `retry_semantic_audit_governance.json`

**Hard stop.** No new frozen rule created. Awaiting user review.
