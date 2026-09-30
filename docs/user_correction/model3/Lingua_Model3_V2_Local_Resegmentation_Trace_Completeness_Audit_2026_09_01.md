# Lingua — Model3 V2 Local Resegmentation Trace Completeness Audit

Date: 2026-09-01  
Phase: `MODEL3_V2_LOCAL_RESEGMENTATION_TRACE_COMPLETENESS_AUDIT`  
Mode: READ-ONLY / TEST-TRACE-ONLY causal evidence audit

================================
EXECUTIVE VERDICT
=================

| Item | Result |
|------|--------|
| **Verdict** | **`LOCAL_RESEG_TRACE_AUDIT_PASS_RECALL_PRIMARY`** |
| Historical unknown population | **65** |
| Resolved after trace completeness | **65 / 65** |
| Remaining unknown | **0** |
| Strict primary owner (65 unknown) | **`RECALL_TARGET_MISS`** — **65** |
| OLD_BOUNDARY_LOCK strict causal count | **0** (drift confirmed, not primary first-fail) |
| Recall strict causal count (65 + 6 controls) | **71** (`RECALL_TARGET_MISS` 65 + `RECALL_ZERO_RETURN` 6) |
| Downstream / no-blocker (13 controls) | **13** |
| Architecture status | Path-local Domain Vote **intentional**; `fallbackRegionLocalSpans` drift **confirmed** but **not** dominant strict blocker |
| **Next phase** | **`MODEL3_V2_RECALL_PRODUCTION_SIGNAL_LOSS_DESIGN_AUDIT`** |

**Headline:** All **65** previously `UNKNOWN_NEEDS_TRACE` cases are reclassified. Frozen `retry_regions` trace proves **fallback exposed repair-capable queries**, **production Retry Recall was invoked**, and **non-target candidates were returned** — first strict missing stage is **Recall target return**, not Local Resegmentation. The historical **84** count is retired as strict causal owner; it remains **`HISTORICAL_REGIONAL_LATTICE_FAILURE_COHORT=84`**.

No production code modified. No fresh ASR replay.

================================
FROZEN ARCHITECTURE
===================

| Invariant | Status |
|-----------|--------|
| Path-local business buckets | **INTENTIONAL** — one Domain Vote per retained path |
| Model3 role | KEEP / RETRY only; no domain merge, no Anchor creation |
| Retry role | Bounded local reinterpretation + Recall; no second Model3 pass |
| Domain Vote during Retry | **`secondDomainVote=false`** on all **423** traced retry regions → **NO_RETRY_SECOND_VOTE** |
| Cross-path merge | Later KenLM stage; not a Domain Vote defect |

================================
TRACE COMPLETENESS
==================

### Existing fields used (frozen `model3_v2_s3_mainline_s3_raw_cases.jsonl`)

| Field | Used for |
|-------|----------|
| `retry_regions.resegmentOk` | Lattice success vs fallback |
| `retry_regions.oldLocalSpanSurfaces` / `newLocalSpanSurfaces` | Fallback boundary lock detection |
| `retry_regions.recallCandidatesReturned` | Per-region Recall invocation + return count |
| `retry_regions.rawStart` / `rawEnd` | Error-region overlap |
| `retry_returned` / `retry_zero` | Case-level Recall aggregate |
| Population CSV `anyCandidateReturn` / `targetCandidateReturn` | Strict P5/P6 from prior causal audit (same frozen run) |

### Still missing (not required to resolve 65 unknown at region level)

| Gap | Impact |
|-----|--------|
| `retry_regions.latticeCode` | Inferred `NO_PATH_OR_EMPTY_PATH_VIEWS` from `resegmentOk=false` + production contract |
| `latticePathViewCount` | Not needed for 65 — all lattice-failed |
| Per-span `recallSpanTopKV2` pinyin/tone inputs | Future Recall design audit |
| Per-invocation returned candidate surfaces | Future Recall design audit |

### Test-only instrumentation

**Not required.** No executable production changes. No trace OFF/ON non-interference run needed.

================================
REGIONAL LATTICE
================

Among **84** historical regional-lattice-failure cohort:

| Metric | Count |
|--------|------:|
| `resegmentOk=false` | **84 / 84** |
| Inferred lattice failure | **NO_PATH** or **EMPTY_SLICE** (from `resegmentRetryRegionWithLattice` contract; exact per-region enum not in frozen trace) |
| `fallbackUsed` (inferred: `!resegmentOk`) | **84 / 84** |
| `oldLocalSpanSurfaces === newLocalSpanSurfaces` | **84 / 84** (fallback = first-pass FineSpan boundaries) |
| Regional multipath preserved when lattice succeeds | **N/A** in this cohort (0 lattice successes among 84) |

================================
REPAIR GEOMETRY
===============

| Classification | 65 unknown | 84 cohort |
|----------------|----------:|----------:|
| `GEOMETRY_EXISTS` | **65** | **84** |
| `GEOMETRY_NOT_EXPRESSIBLE` | **0** | **0** |
| Retry region sufficient | **65** | **84** |

All cases retain `triggerClass=TARGET_OVERLAP` and `regionSufficient=true` from frozen population.

================================
FALLBACK / OLD BOUNDARY
=======================

**Implementation drift:** `fallbackRegionLocalSpans` reuses first-pass FineSpan boundaries (comment: *"Fallback: one local span per original source span in region (boundary-locked)"*). This is **IMPLEMENTATION_DRIFT_FROM_FROZEN_RETRY_DESIGN** — not explicitly approved as frozen sliding/overlap Retry behavior.

**Strict causal OLD_BOUNDARY_LOCK:** **0 / 84**

| Test | Result |
|------|--------|
| Fallback used | 84 / 84 |
| Fallback exposes query overlapping error region | **84 / 84** (partial or full span coverage) |
| Boundary lock **blocks** required query **and** Recall never reached | **6** cases — but Recall **was** reached with **zero** return → owner **`RECALL_ZERO_RETURN`**, not boundary lock |
| Boundary lock blocks **and** Recall returned non-target | **0** |

**Key finding (HARD STOP E):** `fallbackUsed=true` alone does **not** imply causal Local Resegmentation failure. For **65 / 65** unknown cases, fallback spans **did** expose queries to `recallSpanTopKV2` (proven by `anyCandidateReturn=true` and `recallCandidatesReturned>0` on target-overlapping regions).

================================
PRODUCTION RECALL INPUT
=======================

Evidence type: **PRODUCTION_TRACE_OBSERVATION** (frozen run, not Lexicon proxy).

| Stage | 65 unknown |
|-------|----------:|
| Repair-capable query exposed (fallback) | **65** |
| `recallSpanTopKV2` effectively invoked (`anyCandidateReturn=true`) | **65** |
| Per-span pinyin/tone captured | **NO** (future Recall audit) |

Router contract (production code): every `localSpan` in `localSpans` (lattice or fallback) receives Recall with `windowText`, `syllables`, `windowPinyinKey`, `retainedDomains`.

================================
PRODUCTION RECALL OUTPUT
========================

| Outcome | 65 unknown | 6 strict controls | 13 target-in-pool |
|---------|----------:|------------------:|------------------:|
| Recall returned **some** candidates | **65** | **0** | mixed |
| Target-relevant candidate returned | **0** | **0** | **13** (downstream) |
| Strict owner | **RECALL_TARGET_MISS** | **RECALL_ZERO_RETURN** | **NO_BLOCKER** |

Zero-return vs target-miss separation: **6** controls moved from conservative `CONFIRMED_LOCAL_RESEGMENTATION_FAILURE` → **`RECALL_ZERO_RETURN`** (query exposed, Recall returned nothing).

================================
TARGET CANDIDATE SURVIVAL
=========================

Not applicable as first-fail for **65** unknown — target never returned from Retry Recall. **13** controls had target already in candidate/KenLM pool without requiring successful lattice (first-pass Model2, other path, or Retry non-target path not blocking final pool).

================================
STRICT CAUSAL FUNNEL (65 UNKNOWN)
=================================

| Stage | Input | Pass | Fail | Unknown | First-fail owner |
|-------|------:|-----:|-----:|--------:|------------------|
| UNKNOWN_NEEDS_TRACE | 65 | 65 | — | — | — |
| P0 Target-relevant RETRY | 65 | 65 | 0 | 0 | — |
| P1 Retry region sufficient | 65 | 65 | 0 | 0 | — |
| P2 Repair-capable geometry | 65 | 65 | 0 | 0 | — |
| P3 Lattice exposes query | 65 | 0 | 65 | 0 | (fallback continues) |
| P4 Fallback exposes query | 65 | 65 | 0 | 0 | — |
| P5 Recall invoked | 65 | 65 | 0 | 0 | — |
| P6 Recall returns candidates | 65 | 65 | 0 | 0 | — |
| P6 Target-relevant return | 65 | 0 | **65** | 0 | **RECALL_TARGET_MISS** |

================================
OWNER DISTRIBUTION (84 COHORT)
==============================

| Owner | Count | Denominator | Evidence | Confidence | Examples |
|-------|------:|------------:|----------|------------|----------|
| RECALL_TARGET_MISS | 65 | 84 | Frozen trace + population | HIGH | d005, d006, d007 |
| RECALL_ZERO_RETURN | 6 | 84 | Frozen trace | HIGH | d011, d054, d091 |
| NO_BLOCKER_DOWNSTREAM_TARGET_PRESENT | 13 | 84 | Frozen trace | HIGH | d001, d009, d030 |
| LOCAL_RESEGMENTATION (strict causal) | **0** | 84 | — | — | — |
| UNKNOWN | **0** | 84 | — | — | — |

**Sum = 84.**

================================
6 STRICT CONTROLS
=================

| Previous owner | New strict owner | Count |
|----------------|-------------------|------:|
| CONFIRMED_LOCAL_RESEGMENTATION_FAILURE | **RECALL_ZERO_RETURN** | **6** |
| Remain Local Resegmentation | — | **0** |
| Move to Recall | **RECALL_ZERO_RETURN** | **6** |

Cases: d011, d054, d091, d101, d102, d164.

**Interpretation:** Fallback exposed the same first-pass span boundaries; Recall ran but returned **zero** candidates. Prior audit conservatively assigned Local Resegmentation before proving Recall boundary — trace completeness moves ownership to **Recall**.

================================
13 TARGET-IN-POOL CONTROLS
==========================

All **13** have `targetCandidateReturn=true` with `resegmentOk=false`. Target entered pool **without** successful regional lattice — via first-pass Model2 candidates, Retry Recall (non-target regions still allowed target from other spans/paths), or cross-path merge. **Not** Local Resegmentation failures.

Examples: d001, d009, d030, d050, d084, d095, d120, d140, d156, d163, d165, d184, d185.

================================
65 HISTORICAL UNKNOWN
=====================

**All 65 resolved → `RECALL_TARGET_MISS`.**

Prior ambiguity: `resegmentOk=false` + `anyCandidateReturn=true` + `targetCandidateReturn=false` could not distinguish Local Reseg vs Recall without old/new surface + recall return linkage.

Frozen trace resolution:
1. `oldLocalSpanSurfaces === newLocalSpanSurfaces` → fallback query exposed.
2. `anyCandidateReturn=true` → Recall returned candidates on repair-capable input.
3. `targetCandidateReturn=false` → target-relevant candidate absent → **Recall** owns first-fail.

================================
ARCHITECTURE INVARIANTS
=======================

| Check | Required | Actual |
|-------|----------|--------|
| Path-local Domain Vote intentional | YES | YES |
| Different retained path buckets preserved | YES | YES |
| No Retry second Domain Vote | NO second vote | **0** observed |
| Model3 KEEP/RETRY only | YES | YES |
| Fallback preserves sliding/overlap alternatives | Expected NO | **NO** — verified |
| Candidate cap ≤16 | YES | Unchanged (frozen run) |
| JobResult unchanged | YES | YES |
| Exact Lexicon as Recall proxy | NO | NO |

================================
GOVERNANCE
==========

| Item | Changed |
|------|---------|
| Domain Vote | **NO** |
| FineSpan | **NO** |
| Model2 | **NO** |
| Model3 | **NO** |
| Retry business logic | **NO** |
| Recall | **NO** |
| Lexicon | **NO** |
| Assembly | **NO** |
| KenLM | **NO** |
| JobResult | **NO** |
| Training | **NO** |

Historical **LOCAL_RESEGMENTATION=84** **retired** as strict causal owner count.

================================
REQUIRED QUESTIONS (D1–D50)
===========================

| ID | Answer |
|----|--------|
| D1 | **YES** — all 65 unknown identities recovered from frozen artifacts |
| D2 | **YES** — 6 strict controls recovered |
| D3 | **YES** — 13 target-in-pool controls recovered |
| D4 | **NO** fresh ASR replay |
| D5 | N/A |
| D6 | Missing: `latticeCode`, path view count, per-span Recall I/O |
| D7 | **NO** instrumentation required |
| D8 | N/A |
| D9 | Inferred: **NO_PATH / EMPTY_SLICE** (exact enum not in trace) |
| D10 | **65 / 65** valid Retry regions |
| D11 | **65 / 65** repair-capable geometry |
| D12 | **0** not locally expressible |
| D13 | **0** exposed by lattice (all lattice-failed) |
| D14 | **65 / 65** exposed by fallback |
| D15 | **0** NOT exposed among 65 unknown |
| D16 | **0** causally explained by OLD_BOUNDARY_LOCK |
| D17 | **65** use fallback but NOT blocked (Recall reached) |
| D18 | **65 / 65** repair-capable queries reach Recall |
| D19 | **0** among 65 unknown (6 in controls) |
| D20 | **65 / 65** return candidates but miss target |
| D21 | **0** among 65 unknown |
| D22–D26 | N/A as first-fail (target not returned from Recall) |
| D27 | Largest first-fail: **RECALL_TARGET_MISS (65)** |
| D28 | Local Reseg primary blocker? **NO** |
| D29 | Recall primary blocker? **YES** |
| D30 | OLD_BOUNDARY_LOCK proven causal? **NO** (drift yes, causal no) |
| D31 | Previous 6 remain Local Reseg? **0** |
| D32 | Previous 6 move to Recall? **6** |
| D33 | 13 targets: first-pass / other path / Retry side-effect |
| D34 | 65 downstream failures? **NO** |
| D35 | NO_REPAIRABLE_TARGET among 65? **0** |
| D36 | Remain UNKNOWN? **0** |
| D37 | Multipath lattice preservation | N/A (0 lattice ok in cohort) |
| D38 | Fallback preserves sliding/overlap? **NO** |
| D39 | Retry second Domain Vote? **NO** |
| D40 | Path-local Vote intentional? **YES** |
| D41 | Different path buckets preserved? **YES** |
| D42–D44 | Trace/JobResult/final text unchanged: **YES** |
| D45 | Lexicon proxy for Recall? **NO** |
| D46 | Retire 84 as strict causal? **YES** |
| D47 | New distribution: 65 RECALL_TARGET_MISS, 6 RECALL_ZERO_RETURN, 13 NO_BLOCKER |
| D48 | Fix dominant issue requires ACP? **NO** (Recall signal-loss design audit next) |
| D49 | Exactly one verdict? **YES** |
| D50 | Exactly one next phase? **YES** |

================================
NEXT PHASE
==========

**`MODEL3_V2_RECALL_PRODUCTION_SIGNAL_LOSS_DESIGN_AUDIT`**

Do not execute automatically. Wait for user review.

================================
ARTIFACTS
=========

1. `Lingua_Model3_V2_Local_Resegmentation_Trace_Completeness_Audit_2026_09_01.md` (this file)
2. `model3_v2_retry_strict_causal_funnel.csv`
3. `model3_v2_retry_old_boundary_analysis.csv`
4. `model3_v2_retry_recall_trace.csv`
5. `model3_v2_retry_owner_distribution.csv`
6. `model3_v2_retry_trace_summary.json`

Audit runner (test-only): `electron_node/electron-node/tests/run-model3-v2-local-reseg-trace-completeness-audit.mjs`
