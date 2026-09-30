# Lingua Model3 V1 — Retry Region + ASR Postprocess Ownership Audit

**Phase:** `MODEL3_V1_RETRY_REGION_AND_POSTPROCESS_OWNERSHIP_AUDIT`  
**Date:** 2026-08-28  
**Mode:** READ-ONLY  
**Result:** **MULTIPLE_GAPS**

---

## Primary finding

**Model3 ownership is not the problem.**  
FineSpan ownership is not the problem.

The critical gap is:

> Current ASR postprocess implements `RETRY` as **boundary-locked** `recallSpanTopKV2(current FineSpan.rawStart/rawEnd)` — independent per span, **no adjacent merge, no local re-segmentation**.

That is too narrow for real ASR shapes:

`[valid/Anchor] + [meaningless / wrongly segmented region] + [valid/Anchor]`

Training is separately too narrow (length-1 bias + FineSpan-as-one-word `phoneticCompatible`).

Do **not** move region repair into Model3.

---

## A. Model3 original contract (recovered)

| Question | Answer | Evidence |
|----------|--------|----------|
| Target | **NON-ANCHOR FineSpan** | `MODEL3_ARCHITECTURE_CONTRACT_V1.md` §1 |
| Single-char restriction? | **NO** | Architecture + `span_len_log1p`; prior FineSpan audit: length-1 is training bias |
| Requires valid lexicon word? | **NO** | Trigger role; Class D (unreachable) → KEEP in labels |
| Requires correct segmentation? | **NO** | `model3_input_contract_v1.md`: do not invent segmentation; Model3 does not own FineSpan creation |
| Decision | **KEEP / RETRY** | Output contract |
| Conceptual role | Current local span interpretation **suspicious** → request one bounded re-recall | Architecture §1; retry contract: “repairable acoustic/pronunciation **site**” |
| Role drift? | **NO** | Implementation still emits KEEP/RETRY only |

**Length-1 restriction classification:** `TRAINING_DATA_BIAS` + `MATERIALIZER_BIAS` — **not** `BUSINESS_CONTRACT`.

---

## B. FineSpan semantics

| Question | Answer |
|----------|--------|
| Guarantees lexical validity? | **NO** |
| Malformed ASR surface allowed? | **YES** |
| Zero-candidate FineSpan allowed? | **YES** (`inject-fallback-edges.ts` empty candidates; materialize allows len=0) |
| Wrong segmentation possible? | **YES** (path is one SegmentationPath among alternatives) |

**Meaningless surface (e.g. 「积常倒店」):**  
**`VALID_REPRESENTATION_OF_INVALID_ASR`** — FineSpan object is valid; text is invalid ASR content.

Surface always = `rawText.slice(rawStart, rawEnd)`. Lexicon miss does not delete the FineSpan; fallback 1-syllable edges often carry empty candidate lists.

---

## C. Model3 inputs — no silent “unknown → RETRY”

Model-visible: surface tokens, `isAnchor`, `span_len_log1p`, position, `first_pass_cand_log1p`, `current_cjk_len_log1p`, `pinyin_channel_avail`.

**Not** model-visible: `phoneticCompatible`, lexicon membership flag, referenceReachability.

**No** hardcoded `if not in lexicon → RETRY` in runtime. Low candidate count is a feature, not a rule.

---

## D. Current RETRY path (exact)

```text
buildFineSpanCandidatePool (preRetry)
→ voteUtteranceDomainFromPool (ONCE)
→ materializeModel3Anchors
→ Model3 inferPath → KEEP|RETRY
→ Anchor mask
→ routeModel3Retry
     for each RETRY span in PathFineSpan order:
       windowText = rawText.slice(rawStart, rawEnd)   // FROZEN BOUNDARY
       syllables  = globalSyllables.slice(sylStart, sylEnd)
       recallSpanTopKV2(...)
       materializeRetryHits → pin candidates to SAME bounds
       mergeSpanCandidates → per-span cap
→ if mutated: buildFineSpanCandidatePool (SAME pathFineSpans)
→ completeDomainAwareAssemblyFromVote (SAME vote)
→ sentence candidates / KenLM
```

See `model3_v1_retry_current_path.csv`.

| Question | Answer |
|----------|--------|
| Uses current span boundary? | **YES** |
| Can reinterpret segmentation? | **NO** |
| Adjacent RETRY | **Independent** (A); no merge (B); no shared window (C) |

Effectively: **`RETRY(current FineSpan.surface/bounds)`** — assumes current boundaries remain the recall unit.

---

## E. Real case evidence (17 audited)

| Mode | Count |
|------|------:|
| SUFFICIENT | 4 |
| PARTIALLY_SUFFICIENT | 4 |
| **SEGMENTATION_LOCKED** | **6** |
| NO_REPAIRABLE_TARGET | 3 |

Example **d179** (`MULTI_CHAR_REPLACEMENT`):

- Proxy region ≈ multi-char nonsense vs reference phrase  
- Production FineSpans: consecutive **1-char** sequence `限|计|划|意|境|全|任|…`  
- Matched RETRY target would be **「限」** only  
- Current Recall would receive `windowText="限"` with frozen 1-char bounds  

Even if Model3 marked adjacent chars RETRY, postprocess would still **independently** re-recall each char — **SEGMENTATION_LOCKED**.

Deletions with empty ASR surface → **NO_REPAIRABLE_TARGET** (no FineSpan at the gap).

Full table: `model3_v1_retry_region_case_audit.csv`.

---

## F. Region-retry feasibility (audit only — not design)

Using **existing** `spanId` / offsets / path order only (no new Model3 fields):

| Capability | Feasible? |
|------------|-----------|
| Derive bounded region from offsets | YES |
| Merge adjacent RETRY without Model3 change | YES |
| Reuse FineSpan/window generation | YES |
| Reuse Recall / Model2 / budgets | YES |
| Preserve retry-once / Anchor / Vote-once | YES (must remain hard bounds) |

**Feasibility:** `FEASIBLE_WITH_EXISTING_COMPONENTS`

**Not** permission to implement in this phase.

---

## G. `phoneticCompatible` vs region retry

| Item | Finding |
|------|---------|
| Current check | FineSpan-level: current surface treated as a repairable lexical unit |
| Region need | Phonetic/acoustic repairability of a **bounded local region** after possible re-segmentation |
| Classification | **`TOO_NARROW_FOR_REGION_RETRY`** (+ still TRAINING_ONLY_PROXY for runtime) |
| Action | **Do not remove** this phase |

---

## H. Ownership matrix (summary)

| Responsibility | Owner | Status |
|----------------|-------|--------|
| Create FineSpan / boundaries | Lattice FineSpan | CORRECT |
| Judge span plausibility / KEEP·RETRY | **Model3** | CORRECT |
| Derive retry region / merge adjacent | **ASR postprocess** | **TOO NARROW / GAP** |
| Local re-segmentation | ASR postprocess + FineSpan regen | **GAP on RETRY path** |
| Recall / candidates / budgets | Recall + postprocess | API OK; **window wrong for regions** |
| Assembly / KenLM | Assembly | CORRECT |

---

## I. Root cause

| Flag | |
|------|--|
| MODEL3_CONTRACT_DRIFT | **NO** |
| FINESPAN_CONTRACT_DRIFT | **NO** |
| RETRY_POSTPROCESS_TOO_NARROW | **YES** |
| TRAINING_DATA_TOO_NARROW | **YES** |
| TRAINING_LABEL_TOO_NARROW | **YES** |

Do **not** classify “Model3 cannot handle 2-char” as root cause.

---

## J. Pilot + next steps

| Item | Value |
|------|-------|
| Pilot readiness | **HOLD_MULTIPLE_GAPS** |
| Model3 architecture / features | **KEEP_FROZEN** |
| FineSpan architecture | **KEEP_FROZEN** |
| ASR postprocess correction | **YES** (smallest next) |
| Training dataset/label correction | **YES** (separate later) |

**Smallest next correction:** ASR postprocess retry-region interpretation using existing offsets — not Model3 redesign.

**Recommended next phase:** `MODEL3_V1_ASR_POSTPROCESS_RETRY_REGION_CORRECTION`  
**Later separate:** `MODEL3_V1_TRAINING_COVERAGE_FOR_PRODUCTION_FINESPAN_FORMS`

---

## Governance

Read-only. No runtime / FineSpan / Model3 / training / dataset changes.  
Artifacts: **5**. **HARD STOP.**
