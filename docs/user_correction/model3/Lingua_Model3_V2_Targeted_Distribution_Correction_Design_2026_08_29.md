# Lingua Model3 V2 Targeted Distribution Correction Design

**Phase:** `MODEL3_V2_TARGETED_DISTRIBUTION_CORRECTION_DESIGN`  
**Date:** 2026-08-29  
**Mode:** DESIGN ONLY — no dataset build, no training, no runtime/model/feature change

================================
MAIN VERDICT
============

Design status: **READY**

Primary correction strategy:  
**PRODUCTION_EQUIVALENT_FEATURE_STATE + SAME_SURFACE_LABEL_CONTRAST + MULTIPATH_SEQUENCE_COVERAGE**

Feature Capacity change required: **NO**  
Model change required: **NO**  
Architecture change required: **NO**

================================
AUTHORITATIVE ROOT CAUSES
=========================

**P0**

1. `CANDIDATE_FEATURE_CHANNEL_COLLAPSE` — TRAIN_RETRY/KEEP `firstPassCandidateCount` hardcoded `0` (e.g. `build_v2_realdist_expanded.py`); live SSOT shows real 0/1 variation (~466 vs ~489 non-anchor in current trace).
2. `SURFACE_LABEL_SHORTCUT` — surfaces like 四/温/背/烧/上/对 become RETRY-exclusive or RETRY-dominated without legitimate KEEP contrast.

**P1**

3. `SINGLE_PATH_TRAINING` — one canonical `spans[]` per sample; live evaluates multiple SegmentationPaths (path-dependent 背/烧).
4. `SEQUENCE_DISTRIBUTION_GAP` — live misses with SEQUENCE_OOD / thin shells despite some scalar support.

**P2**

5. `POSITION_COVERAGE_PARTIAL` — keep RealDist HEAD/MID breadth; subordinate to P0/P1.
6. `UNEXPLAINED_STRONG_KEEP` — d131/d176: WELL support + TRAIN_RETRY neighborhood + WELL sequence but strong KEEP → **protected validation only**, no case patch.

================================
d160 INVENTORY CORRECTION
=========================

Previous: `CURRENT_TARGET_CHANGED_BUT_ALIGNABLE`

**Corrected: `STALE_TARGET_NOT_COMPARABLE`**

Reason:

- Historical suspicious region: `向木李`
- Current live: `顺便看看项目里…` — semantically normal
- Must **not** treat 顺/便 as missed RETRY
- Must **not** generate RETRY training for 顺/便 from historical d160

Updated in `model3_v2_corrected_inventory13.csv`.

Future acceptance binds **caseId + sourceText snapshot + target region**. If suspicious region disappears → `STALE_TARGET_NOT_COMPARABLE`.

================================
TARGET TRAINING SAMPLE CONTRACT
===============================

Extend usage of existing `MODEL3_TRAINING_SAMPLE_V1` (no runtime schema break required) with **production-shaped fields populated honestly**:

| Field | Ownership | Source |
|-------|-----------|--------|
| utteranceId / sampleId / corruptionFamilyId | training | generator |
| pathId / pathIndex | training | production-equivalent path enum |
| currentText / referenceText | training | corruption pipeline |
| spans[].surface, rawStart/rawEnd, seq order | FineSpan | **production PathFineSpan logic** |
| spans[].isAnchor, anchorSource | Anchor | existing offline Domain-equivalent materialization |
| spans[].recallEvidence.firstPassCandidateCount | Recall/lattice | **`model3FirstPassCandidateCount` semantics** (`!isCovered` candidates) |
| featureAvailability.pinyinTextDerived | syllables | production text-derived syllable SSOT |
| spans[].label KEEP/RETRY/MASKED | training-only | V2 **malformed-region projection** onto path FineSpans |
| raw + packed six features | derived | shared `span_features` / pack semantics |

**Multiple paths** from one utterance = multiple samples sharing `utteranceId`/`corruptionFamilyId`, distinct `pathId`.

Malformed-region metadata remains **training-only** (not JobResult).

================================
CANDIDATE STATE DESIGN
======================

**Current problem:** RealDist expansion writes `firstPassCandidateCount: 0` for every synthetic FineSpan → channel collapse.

**Target generation method (preferred):**

1. Generate / select utterance text (corrupt or clean).
2. Run **production-equivalent** FineSpan + lattice candidate materialization (same business path that fills `PathFineSpan.candidates`).
3. Persist **raw** count; pack `first_pass_cand_log1p = log1p(raw)` via shared packer.
4. **Fail closed** if cand field absent — never silent default 0 for “AVAILABLE”.

**Shared production logic:**  
Runtime SSOT already defined in `packModel3SpanInferFields` / `model3FirstPassCandidateCount`. Training must call the **same counting rule** on real candidate lists, not a parallel formula.

**No-duplication strategy:**

- Prefer offline driver that reuses Electron/FW FineSpan+candidate builders **or** a shared library extracted without changing runtime behavior.
- Forbidden: second “approx cand” heuristic in Python generators.

If wiring proves blocked in build phase → escalate to `MODEL3_V2_TRAINING_FEATURE_STATE_PIPELINE_AUDIT` (not needed at design time).

### Cand-state contrast floors (from live hint + anti-collapse)

| cell | min supervised spans |
|------|---------------------:|
| KEEP + cand=0 | 800+ per HEAD/MID/TAIL family (≥2400 total) |
| KEEP + cand>0 | 1000+ per band (≥3000) |
| RETRY + cand=0 | 500–700+ per band (≥1700) |
| RETRY + cand>0 | 500–900+ per band (≥2200) **P0 missing today** |

Proportions need not match live exactly; **usable variation** required.

================================
SURFACE-CONTRAST DESIGN
=======================

**Rule:** Teach `surface identity ≠ label`.

For surfaces with sufficient RETRY support **and** natural KEEP usage (clean corpus / production): require KEEP support floor.  
Inverse: common KEEP surfaces inside labeled malformed regions receive RETRY by **region projection**.

**Leakage metric** (dataset report):

- `support = KEEP+RETRY` (non-anchor)
- `retry_ratio = RETRY/support`
- `LEAKAGE_RISK_HIGH`: support≥50 AND (KEEP=0 XOR RETRY=0) AND opposite label natural
- `LEAKATE_RISK_MODERATE`: support≥50 AND retry_ratio≥0.85 with tiny KEEP share
- `LEAKAGE_RISK_LOW`: otherwise

**Pass:** HIGH count = 0 among natural-opposite surfaces; MODERATE ≤15% of supported surfaces.

**Hard negatives (structural):** KEEP where surface equals RETRY-heavy tokens but region is clean — via clean utterances / non-malformed regions / alternate paths.  
**Hard RETRY:** common KEEP tokens inside independently labeled malformed regions.

**Forbidden:** `if token == 四/温/…`, caseId branches. Audit tokens (四/温/背/…) are **evidence only**.

Policy file: `model3_v2_surface_contrast_policy.csv`.

================================
MULTIPATH DESIGN
================

**Source of paths:** Existing production SegmentationPath / PathFineSpan enumeration — **do not invent a second segmenter**.

**Label projection:** Map training malformed character/offset region onto **each path’s FineSpans** by offsets/overlap. Same underlying region may yield different surfaces, indices, neighbors. Never copy labels by span index across paths.

**Path-contrast pairs:** Same `utteranceId` with Path A/B/C when production emits them. RETRY only where region semantics say so — do not force RETRY on every path.

**Split policy:** All paths + surface-contrast variants of one `corruptionFamilyId` stay in **one** split. Never Path A→train, Path B→test.

**Coverage:** ≥15% multipath utterances, ≥200 multipath utterances, ≥50 path-contrast families; report paths/utterance vs live SSOT (directional).

================================
SEQUENCE COVERAGE DESIGN
========================

No new runtime features. Training must include local shells with:

- prev/next FineSpans, Anchor pattern, cand pattern, rel-position progression, surface sequence

**Live-like families** (from traces, not case patches):

- HEAD/MID/TAIL malformed
- cand=0 target amid cand>0 neighbors (and inverse)
- anchor-adjacent suspicious regions
- multipath neighbor variation

Acceptance: reduce `SEQUENCE_OOD` for protected live **families** vs RealDist baseline (structural dims, not exact text match).

================================
COVERAGE MATRIX
===============

See `model3_v2_target_distribution_coverage_matrix.csv`.

Cells marked `VALID_NEEDED` / `VALID_OPTIONAL` / `NOT_NATURAL` / `NOT_APPLICABLE`.  
Cartesian fill **not** required for unnatural cells (synthetic pinyin=0, fake multi-char FineSpans).

================================
PROTECTED HOLDOUT
=================

**Never train on** (or near-duplicate sourceText of):

d002, d003, d019, d049, d099, d131, d139, d142, d160, d176, d179, d181, d195

**Protected unexplained strong KEEP:** d131, d176 — validation only; no case-keyed RETRY injection.

**Stale:** d160 current snapshot — not a RETRY miss; not a RETRY train source for 顺/便.

================================
DATA VOLUME ESTIMATE
====================

Only after coverage (not “+100k” first):

| family | existing RealDist | required min spans | est. new utterances (order) |
|--------|------------------:|-------------------:|----------------------------:|
| KEEP cand=0 bands | large but cand fake | ~2400 honest | ~120–150 |
| KEEP cand>0 bands | ~0 honest | ~3000 | ~150–200 |
| RETRY cand=0 bands | large but cand fake | ~1700 honest | ~100–120 |
| RETRY cand>0 bands | ~0 | ~2200 | ~150–200 |
| Multipath subset | ~0 | ≥200 utt / ≥15% | included above |
| **Total new utt order** | | | **~1100–1600** after overlap discount |

Exact shard counts deferred to build phase after generator yield rates.

================================
ACCEPTANCE GATES
================

Defined in `model3_v2_future_dataset_acceptance_gates.json`:

1. **feature-state gate** — cand contrast both labels; no silent 0; honest pinyin variance  
2. **surface leakage gate** — HIGH=0; no token blacklist  
3. **multipath gate** — prod paths; contrast pairs; split integrity  
4. **sequence-support gate** — OOD↓ for protected families  
5. **split-leakage gate** — family-locked splits; inventory holdout  
6. **stale-target / d160 gate**  
7. **governance gate** — no case/token patching → `FAIL_DATA_DESIGN_GOVERNANCE`  
8. **position breadth** — WARN if regress to tail-only  

================================
FUTURE CONTROLLED TRAINING
==========================

**What remains fixed:** Model3 BiGRU, six-feature contract, threshold, optimizer family, eval harness, checkpoint identity/SHA rules, FineSpan/Anchor/Retry ownership.

**What changes:** **DATA DISTRIBUTION ONLY** → one candidate dataset `MODEL3_V2_TARGETED_DIST_CORRECTED_V1` vs baseline `MODEL3_V2_REALDIST_V1`.

Document seed; prefer matched hyperparameters. Do not change model and data together.

================================
POST-TRAIN ACCEPTANCE
=====================

Directional (no arbitrary absolute pass scores unless project SSOT adds them):

| metric | direction |
|--------|-----------|
| TARGET_REGION_RETRY (prod-equivalent SSOT) | ↑ |
| UNRELATED_REGION_RETRY | ↓ |
| token-shortcut dependence / leakage HIGH | ↓ |
| train/live cand collapse | **eliminated** |
| SEQUENCE_OOD on protected families | ↓ |
| path instability where behavior should be stable | ↓ |
| normal KEEP false RETRY | controlled (no regression) |
| STALE_TARGET_NOT_COMPARABLE | excluded from miss denominator |
| d131/d176 | observe; if still strong KEEP after structural fix → later Feature Capacity evidence |
| synthetic F1 | secondary only |

No production promotion in design or immediate next build-only phase.

================================
ROOT-CAUSE → CORRECTION MAP
===========================

| root cause | evidence | principle | data source | coverage | acceptance | risk |
|------------|----------|-----------|-------------|----------|------------|------|
| CANDIDATE_FEATURE_CHANNEL_COLLAPSE | train cand≡0; live varies | Real PathFineSpan candidates | prod FineSpan+lattice | KEEP/RETRY × cand 0/>0 | feature_state_gate | duplicate cand logic |
| SURFACE_LABEL_SHORTCUT | 四/温/对/背… | same-surface both labels | clean+corrupt; paths | leakage metric | surface_leakage_gate | case patching temptation |
| SINGLE_PATH_TRAINING | 1 spans[] vs live multipath | emit all prod paths | SegmentationPath enum | multipath % / contrast | multipath_gate | label-by-index bug |
| SEQUENCE_DISTRIBUTION_GAP | live OOD misses | live-like shells | structural families | HEAD/MID/TAIL×cand patterns | sequence_support_gate | overfit holdout text |
| POSITION_COVERAGE_PARTIAL | RealDist partial | preserve breadth | existing+new | p10/p90 | position gate WARN | optimize only position |
| UNEXPLAINED_STRONG_KEEP | d131/d176 | **NO DIRECT PATCH** | — | protected val | observe post-train | false capacity claim |

================================
ARCHITECTURE GOVERNANCE
=======================

Model3 / features / threshold / FineSpan / Anchor / Retry / Recall / JobResult: **UNCHANGED**

================================
NEXT PHASE
==========

**MODEL3_V2_TARGETED_DISTRIBUTION_DATASET_BUILD**

Do **not** execute in this phase.

Feasibility: candidate-state owner + multipath source identified; no frozen-architecture conflict.  
Not blocked on path-structure-only or feature-state pipeline audits unless build discovers reuse is impossible.

================================
CHECKLIST
==========

- [x] Prior audit used; d160 → STALE; stale-target rule  
- [x] Sample contract; cand owner; cand 0/>0 × KEEP/RETRY  
- [x] Same-surface contrast; no blacklist; leakage metric; hard ±  
- [x] Multipath + label projection + split policy  
- [x] Sequence coverage; position preserved; no fake pinyin  
- [x] Holdout + d131/d176 protected  
- [x] Coverage matrix; volume from coverage  
- [x] Acceptance gates; future causal train design  
- [x] No data gen / train / feature / model / threshold / arch change  
- [x] Next phase selected, not executed  

## Artifacts

1. `Lingua_Model3_V2_Targeted_Distribution_Correction_Design_2026_08_29.md`  
2. `model3_v2_target_distribution_coverage_matrix.csv`  
3. `model3_v2_surface_contrast_policy.csv`  
4. `model3_v2_future_dataset_acceptance_gates.json`  
5. `model3_v2_distribution_correction_design_summary.json`  
