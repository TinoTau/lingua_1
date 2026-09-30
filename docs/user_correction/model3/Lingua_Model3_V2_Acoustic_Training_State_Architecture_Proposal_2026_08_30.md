# Lingua Model3 V2 Acoustic Training-State Architecture Proposal

**Phase:** `MODEL3_V2_ACOUSTIC_TRAINING_STATE_ARCHITECTURE_PROPOSAL`  
**Date:** 2026-08-30  
**Mode:** ARCHITECTURE PROPOSAL ONLY — no implementation, no dataset, no training, no runtime change

================================
MAIN VERDICT
============

Recommended route: **MORE_EVIDENCE_REQUIRED**  
(preferred architecture if evidence later passes: **APPROVE_ROUTE_A_PLUS_B2_HYBRID**)

Confidence: **MEDIUM**  
(architecture preference **HIGH**; Model3-usable RETRY+cand funnel **LOW/INSUFFICIENT**)

User architecture decision required: **YES** (even before probe: authorize narrow yield probe scope)

Model3 runtime changed: **NO**

Dataset Build can resume: **NO**

================================
CURRENT BLOCKER
===============

`rawFirstPassCandidateCount` / `first_pass_cand_log1p` requires production:

Audio → FW timestamps → ToneModule → `AcousticToneSlice[]` + `WordTimeSpan[]` → `acousticTonePattern` → Mandatory Tone Recall → LexicalEdge → `PathFineSpan.candidates` → `model3FirstPassCandidateCount`

Text-only generation cannot legally produce this (Gate 0 FAIL; Plain Recall frozen-removed).

**Training acquisition** needs an authorized **offline upstream materialization** path. This proposal designs that path; it does **not** change Model3 modality (remains TEXT-ONLY).

================================
ROUTE A — REAL AUDIO / REAL STATE
=================================

**Architecture:** real audio → production ASR/FW → Tone → Recall → FineSpan/cand/paths → Model3 features

| Use | Suitability |
|-----|-------------|
| Distribution reference | **PASS** (live input trace SSOT) |
| Validation / calibration | **PASS** (replay parity established) |
| Supervised training | **FAIL / PARTIAL** — packed traces lack RETRY **GT**; dialog_200 heavily protected; scale tiny (14-case live Model3 input trace) |

Real ASR error audit (anchored subset): 46 eligible error utt / 153 spans proxy; HIGH RETRY-eligible cases ≥13 — useful **inventory**, not train-scale labeled acoustic corpus.

**Verdict:** Keep as **distribution reference + acceptance**; not sole supervised scale route.

================================
ROUTE B1 — PREDEFINED CORRUPTION → ACOUSTIC
===========================================

**Architecture:** reference → planned corrupted text → TTS → ASR → Tone/Recall → attach labels to **planned** corruption

**Central failure:** actual ASR often ≠ planned surface (e.g. planned 大背, ASR 大贝).

| If… | Classification |
|-----|----------------|
| Labels stay on planned text while features from ASR text | **CROSS_SAMPLE_PROVENANCE_MISMATCH** → **INVALID** |
| Override ASR text to planned corruption | **INVALID** (forbidden) |
| Keep only samples where `actualASR == plannedCorruption` | Conditionally coherent but **yield UNKNOWN** (no Model3 filter stats); high reject rate expected |

**Material advantage over B2:** none for provenance; only “controlled error family” illusion that breaks under real ASR.

**Verdict:** **FAIL** as primary architecture. Do not approve B1.

================================
ROUTE B2 — CLOSED-LOOP ACTUAL ASR
=================================

**Architecture:**

```
referenceText
  → authorized audio (TTS / existing wav)
  → production ASR/FW (actualAsrText + timestamps)
  → production Tone → Recall → FineSpan / cand / paths
  → align(referenceText ↔ actualAsrText)
  → training-only malformedRegion
  → V2 KEEP/RETRY/EXCLUDE projection
  → Model3 sample (currentText = actualAsrText)
```

**Key property:** label text == feature-state text == same acoustic/ASR/Tone/Recall **run** → supports `LABEL_FEATURE_PROVENANCE_COHERENT`.

**Label semantics:** ASR≠ref is **not** auto-RETRY. Use frozen V2 region contract (`label_spans_v2` / `derive_malformed_regions`). Deletion / no FineSpan target → EXCLUDE / NO_REPAIRABLE_TARGET.

**Alignment reuse:** **REUSABLE** — `stage2_v2_label.derive_malformed_regions` (`difflib.SequenceMatcher` opcodes: replace/delete/insert, unequal length). Secondary: Model2 `align_codepoints` (Myers) for TTS↔ASR probes — optional, not required to invent new aligner.

**Model2 Anchor later:** **PARTIAL/YES** — full ASR→Model2 expand path can materialize MODEL2 anchors offline if Model2 step included; not required for cand P0.

**Verdict:** Architecturally **preferred** supervised scale route **if** yield probe confirms usable Model3 RETRY+cand cells.

================================
ROUTE C — FROZEN TONE SIMULATOR
===============================

**Status:** **DOES_NOT_EXIST** → **NOT_CURRENTLY_AUTHORIZED**

No design in this phase.

================================
B1 VS B2
========

| Question | Answer |
|----------|--------|
| B1 advantage over B2? | **No** material advantage |
| B1 preserve actual ASR provenance? | **Only** if filtered to ASR==planned; otherwise **No** |
| B1 filter yield? | **UNKNOWN** / likely low — **INSUFFICIENT_EVIDENCE** for exact rate |
| B2 stronger label↔feature coherence? | **Yes** |
| B2 expected RETRY yield? | ASR mismatches common (see yield §); **USABLE_MODEL3_RETRY_YIELD** after Tone/cand/label **not yet measured** |
| Existing assets support B2? | **Yes** (Piper, dialog_200 wavs, ASR, ToneModule, lattice, V2 labeler, packer) — **policy not authorized** |

================================
LABEL / FEATURE PROVENANCE
==========================

**Invariant:** same materialized run owns:

1. `currentText` (= actual ASR for B2)  
2. FineSpan / path / cand / packed features  
3. `malformedRegion` from align(`currentText`, `referenceText`)  
4. KEEP/RETRY/EXCLUDE labels  

**Fail-closed gate:** `LABEL_FEATURE_PROVENANCE_COHERENT`  
Mismatch → **FAIL** dataset acceptance (`CROSS_SAMPLE_PROVENANCE_MISMATCH`).

**Training provenance identity (artifact, not JobResult):**  
`referenceText`, `audioAssetId`, audio source provenance, `actualAsrText`, ASR/FW/Tone/Recall/Lexicon run identities, `pathId`, FineSpan offsets, cand state, malformedRegion, label provenance, `evidenceLevel=TTS_ASR|HUMAN_ASR`.

================================
ERROR-YIELD EVIDENCE
====================

| Evidence | Source | Implication |
|----------|--------|-------------|
| Piper→ASR exact-match **21.6%**, error **78.4%** (n=320) | Model2 Phase4 TTS Probe | TTS→ASR **not** “too clean” |
| ASR error **83.3%** (2500/3000) | Model2 Phase5C | High mismatch rate |
| Accent scale ASREffectRate **0.906** | Model2 Phase5F | Perturbation often reaches ASR |
| dialog_200 raw exact **19%**, CER **0.248** | Tone Phase1 | Piper eval set has rich ASR noise |
| Anchored ASR-error: 46 utt / 153 spans; MULTI_CHAR 68, PHONETIC 64, INS 5, DEL 3 | Model3 Real ASR Error Audit | Real shapes ≠ Synthetic V1 1-char only |
| Coverage: 47/53 mismatch; ≥13 HIGH RETRY-eligible | Model3 Coverage Audit | Repairable region inventory exists |
| `LOW_ERROR_YIELD` | TTS readiness (superseded) | **Risk label only** — contradicted as “ASR too clean”; **not** a measured Model3 RETRY funnel |
| Full funnel: audio→Tone ready→cand>0→non-Anchor repairable RETRY | — | **INSUFFICIENT_EVIDENCE** |

**Usable Model3 RETRY yield:** **UNKNOWN** (must probe)  
**Confidence on ASR-error abundance:** MEDIUM-HIGH  
**Confidence on Model3+cand usable RETRY:** LOW

================================
ALIGNMENT REUSE
===============

| Logic | Status |
|-------|--------|
| `derive_malformed_regions` (Model3 V2) | **REUSABLE** — sub/ins/del/unequal |
| Model2 `align_codepoints` | **PARTIAL** optional for TTS probes |
| New aligner | **NOT** to be created |

================================
AUDIO / TTS ASSETS
==================

| Asset | Purpose | Reuse for B2 |
|-------|---------|--------------|
| Piper TTS service | Eval / Model2 / dialog_200 regen | **EXISTING_BUT_FOR_OTHER_PURPOSE** → needs **training-policy** authorization |
| dialog_200 wavs (200) | Tone/FW/lexicon eval | Re-pipeline possible; **holdout leakage** if used for Model3 train |
| AISHELL Tone train audio | Tone CNN/CRNN | **NOT** Model3 cand SSOT without ASR→Tone→Recall wrap |
| Model2 accent phoneme pipeline | Model2 | **EXISTING** perturbation for **audio**; not Model3-owned; tone corruption **DEFERRED**; d/t **not implemented** |

**TTS role if approved:** offline **TRAINING UPSTREAM STATE MATERIALIZATION SOURCE** only — not Model3 runtime/feature.

**B2 + existing pronunciation perturbation:** Model2 n/l, zh/z, nasal, f/h **implemented** and production-ASR validated for Model2. For Model3: **NOT_CURRENTLY_AVAILABLE** as authorized contract (ownership Model2; no Model3 freeze). Do not design new perturbation here. Optional later **reuse** only after ACP.

================================
SYNTHETIC BIAS
==============

| Risk | Level |
|------|-------|
| Single Piper voice / clean room | **HIGH** |
| Accent coverage vs real users | **HIGH** |
| ASR error-family bias (TTS-shaped) | **MODERATE–HIGH** |
| Tone distribution vs live | **UNKNOWN→MODERATE** |
| Domain/lexicon skew | **MODERATE** |

**Mitigation policy (not a new model):** Route **A** real traces as distribution reference / acceptance SSOT; never claim TTS solves real-user accent; protect dialog_200 holdouts from train.

**Hybrid A+B2:** **SUPPORTED** as data policy (B2 scale train; A validate) — not a second runtime chain.

================================
COMPUTE COST
============

| Stage | Estimate |
|-------|----------|
| TTS | MODERATE (Piper CPU; Model2 scale pipelines previously day-scale for thousands) |
| ASR + Tone + lattice/Recall | **HIGH** per utterance (full FW path) |
| Storage | MODERATE (wav + jsonl traces) |
| Offline repeatability | Feasible at **probe** (tens–low hundreds) then scale |

Historical TTS readiness rough: 10k utt ~8–16h class (order-of-magnitude only).

================================
ANCHOR / MULTIPATH IMPACT
=========================

Anchor: Domain owner already PASS offline; B2 full path can later exercise Model2 → **PARTIAL→YES** for distribution; secondary to cand.

Multipath: production enumeration preserved on all acoustic routes; not a route-selection criterion. Non-holdout multipath IDs already listed for future Gate0.

================================
ROUTE COMPARISON
================

See `model3_v2_acoustic_training_route_comparison.csv`.

Summary: **B2 ≫ B1**; **A** essential for validation; **C** unauthorized; **A+B2 hybrid** best long-term policy pending yield proof.

================================
ARCHITECTURE CHANGE PROPOSAL
============================

**Scope:** TRAINING DATA GENERATION ARCHITECTURE ONLY

**Current:** Model3 train samples text-only; cand channel collapsed / legacy-defaulted; Dataset Build BLOCKED.

**Proposed (pending yield probe + user approval):**

Authorize **Route B2** offline: existing TTS/audio → production ASR/FW/Tone/Recall/FineSpan → V2 labels on **actual ASR text**, with fail-closed provenance coherence; use **Route A** traces for distribution reference/acceptance only (no protected train leakage).

**Unchanged:** Model3 TEXT-ONLY runtime; six features; threshold; Mandatory Tone Recall; FineSpan; Anchor ownership; Retry; JobResult; no Plain Recall; no Tone simulator; no new Model3 inputs.

**Benefits:** honest `first_pass_cand`; label↔feature coherence; reuse existing owners; unlocks targeted-dist Dataset Build later.

**Risks:** synthetic bias; unknown Model3 RETRY+cand yield; compute cost; holdout leakage if dialog_200 misused; ASR≠planned family control.

**Rollback / rejection:** if user rejects acoustic materialization → Dataset Build remains **BLOCKED**; do **not** auto-remove `first_pass_cand`, restore Plain Recall, or invent Tone simulator.

================================
AUTHORIZATION BOUNDARY
======================

**If user later approves B2 / A+B2 (after probe):**

AUTHORIZED:

- Offline TTS/audio generation for **training upstream materialization**
- Re-running production ASR → Tone → Recall → FineSpan → pack for samples
- `evidenceLevel=TTS_ASR` provenance fields
- Using Route A traces as **eval/reference** (non-train / non-holdout rules)

**Still prohibited:**

- Acoustic Model3 runtime inputs  
- Changing Recall / Tone / FineSpan / six features / threshold  
- Plain Recall restore / Tone simulator / fake cand / fake tone  
- Training on protected dialog_200 inventory  
- Forcing ASR text to planned corruption (B1 override)

**Now (this phase):** only authorize proceeding to a **bounded yield probe** design/execution in next phase — not bulk generation.

================================
RECOMMENDATION
==============

**MORE_EVIDENCE_REQUIRED**

Preferred architecture to validate in the probe: **Route B2 closed-loop**, with **Route A** retained for reference/acceptance (**A+B2 hybrid** policy).  
**Reject B1. Keep C unauthorized.**

================================
NEXT PHASE
==========

**MODEL3_V2_ACOUSTIC_MATERIALIZATION_YIELD_PROBE**

Bounded, small-N offline probe to measure:

audio → ASR success → mismatch → align → repairable non-Anchor region → FineSpan overlap → Tone-ready cand state → V2 RETRY count  

= **USABLE_MODEL3_RETRY_YIELD** (+ cand 0/>0 natural support).

Do **not** execute in this phase.

================================
CHECKLIST
=========

[x] prior provenance audit as SSOT  
[x] Model3 runtime text-only preserved  
[x] acoustic limited to training materialization  
[x] candidate production contract preserved  
[x] label/feature same-run coherence defined  
[x] Routes A/B1/B2/C evaluated  
[x] B1 mismatch risk / B2 closed-loop analyzed  
[x] alignment reuse audited (REUSABLE)  
[x] TTS/audio + yield evidence audited  
[x] usable RETRY yield = INSUFFICIENT → probe  
[x] synthetic bias / compute assessed  
[x] perturbation: existing Model2 only; no new design  
[x] no simulator / Recall / dataset / training / runtime change  
[x] exactly one recommendation + next phase; not executed  
