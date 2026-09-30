# Lingua Model3 V2 Offline Eval Pipeline Correction

**Phase:** `MODEL3_V2_OFFLINE_EVAL_PIPELINE_CORRECTION`  
**Date:** 2026-08-29  
**Checkpoint:** `MODEL3_V2_REALDIST_V1`  
**Weights SHA256:** `fbb8d85dc4bec117af510a9d8f0a5021a86187a1e1490ee63f9b66831bad648e`  
**Scope:** evaluation infrastructure only — no training, no model/feature/architecture change.

================================
MAIN VERDICT
============

Evaluation pipeline correction: **PASS**

Production input trace SSOT: **ESTABLISHED**

Offline replay parity: **PASS**

Corrected RealDist evaluation trustworthy: **YES**

================================
OLD EVALUATION DRIFT
====================

Historical FineSpan dependency: **REMOVED** (parity eval)

cand default=0: **REMOVED**

pinyin default=True: **REMOVED**

primary-path-only assumption: **REMOVED**

Historical dump `model3_v1_feature_contract_dialog200_anchored.jsonl` is marked  
`HISTORICAL_NON_PARITY_INPUT` (see `HISTORICAL_NON_PARITY_INPUT.md`).  
`eval_v2_realdist_offline.py` now refuses to run without `--allow-historical-non-parity`.

Old offline **7/13** = **HISTORICAL_RECONSTRUCTED_OFFLINE_RESULT** — not production-equivalent.

================================
TRACE CONTRACT
==============

Trace boundary: `packModel3SpanInferFields` → Model3 host `infer` → host returns exact tensors → `run-model3-path-step` observational `inferenceInputTrace` → dialog200 path diagnostics → `model3_v2_live_input_trace.jsonl`

Identity fields: `caseId`, `modelId`, `weightsSha256`, `pathId`, `pathIndex`, `sourceText`/`raw_asr`, `seqIndex`, `seqLen`

Path fields: per-`SegmentationPath` rows (not collapsed to primary)

FineSpan fields: `surface`, `surfaceUsed`, `rawStart`, `rawEnd`, `spanId`

Anchor fields: `isAnchor`, `anchorSource` (DOMAIN / MODEL2 / DOMAIN_AND_MODEL2 / NONE)

Six feature fields: `isAnchor`, `span_len_log1p`, `span_rel_position`, `first_pass_cand_log1p`, `current_cjk_len_log1p`, `pinyin_channel_avail`

Exact tensor SSOT (required for parity): `featVector`, `availMask`, `tokenIds`

Output fields: `keepLogit`, `retryLogit`, `margin`, `decision`, `eligible`

Raw diagnostics: `rawFirstPassCandidateCount`, `rawPinyinChannelAvail`

Fail-closed: missing features/tensors → `MISSING_PRODUCTION_TRACE_FIELD`

================================
LIVE VS REPLAY PARITY
=====================

paths tested: **40**

spans tested: **1007**

decision mismatches: **0**

max margin delta: **0.0**

parity tolerance: **1e-4** (documented; not tuned)

Replay path: `training/model3_dataset/scripts/replay_model3_live_input_trace.py`  
Uses host `tokenIds` + `featVector` + `availMask` only — does **not** generate FineSpans / Anchors / cand / pinyin.

================================
PRIORITY CASES
==============

All priority cases present in SSOT trace. Live == replay (decision + margin) for every traced span.

| case | note |
|------|------|
| d002 | coffee-prefix KEEP on all paths; **背** RETRY on 2/3 paths (probe hit) |
| d003 | RETRY on 烧 (inventory TARGET via err-char heuristic) |
| d019 | multi-path RETRY near 上/讨论 (TARGET) |
| d160 | **NO_RETRY**; current ASR text ≠ historical `向木李` text |
| d179 | UNRELATED RETRY 四 |
| d181 | UNRELATED RETRY 温 |
| d195 | UNRELATED RETRY 对 |
| d137 | **背** on all 4 paths; RETRY; join bug corrected |

================================
d002
====

Current production source: `麻烦帮我做一杯美式带走大背就行谢谢`

| path (prefix) | surface | isAnchor | cand | cand_log1p | pinyin | other feats (len/rel/cjk) | live margin | replay margin | live | replay |
|---------------|---------|----------|------|------------|--------|---------------------------|-------------|---------------|------|--------|
| 1ff853… | 烦 | F | 1 | 0.693 | 1 | 0.693 / 0.067 / 0.693 | -15.620 | -15.620 | KEEP | KEEP |
| 1ff853… | 做 | F | 0 | 0 | 1 | 0.693 / 0.267 / 0.693 | -14.932 | -14.932 | KEEP | KEEP |
| 1ff853… | 一 | F | 0 | 0 | 1 | 0.693 / 0.333 / 0.693 | -16.006 | -16.006 | KEEP | KEEP |
| 1ff853… | 杯 | F | 1 | 0.693 | 1 | 0.693 / 0.400 / 0.693 | -20.126 | -20.126 | KEEP | KEEP |
| 1ff853… | 背 | F | 1 | 0.693 | 1 | 0.693 / 0.733 / 0.693 | -0.601 | -0.601 | KEEP | KEEP |
| 9b521b… | 背 | F | 1 | 0.693 | 1 | 0.693 / 0.733 / 0.693 | +0.645 | +0.645 | RETRY | RETRY |
| ab9c43… | 背 | F | 1 | 0.693 | 1 | 0.693 / 0.714 / 0.693 | +1.576 | +1.576 | RETRY | RETRY |

Coffee-prefix spans are strong KEEP. Target **背** is path-dependent RETRY under current live PathFineSpans — offline reproduces this exactly.  
(Prior RealDist acceptance snapshot had coffee RETRY / 背 KEEP; that was a different live FineSpan/path snapshot, not a model change.)

================================
d160
====

**Current live source text:**  
`请简单介绍一下 你上一段视频的时候 顺便看看项目里负责的核心模块和难点`

**Historical inventory raw (different utterance representation):**  
`…顺便向木李负责的核心模块和难点`

Spans **向 / 木 / 李** are **absent** in current live text. Present nearby spans:

| path | surface | cand | pinyin | margin | decision |
|------|---------|------|--------|--------|----------|
| b0c26… / 5dabd… | 顺 | 0 | True | ≈ -7.5 | KEEP |
| b0c26… / 5dabd… | 便 | 0 | True | ≈ -11.7 | KEEP |

Attribution: **NO_RETRY**. Do not compare against stale historical source as the same utterance.

================================
d137 MATCHING
=============

Previous inconsistency: FineSpan parity labeled `EXACT_FINESPAN_PARITY` while `live_matching_FineSpan` for **背** was empty.

Root cause: **reporting/join** used primary-path-only (or mismatched pathId), not FineSpan absence.

Corrected: multi-path SSOT shows **背** on all 4 paths (`rawStart=13`, `rawEnd=14`); live=replay **RETRY** (margins ≈ 0.46–2.97). Reporting-only fix; FineSpan semantics unchanged.

================================
CORRECTED 13-CASE RESULT
========================

Historical reconstructed offline: **7 / 13** — **NOT PRODUCTION-EQUIVALENT**

Corrected live-equivalent (FULL ELECTRON MAINLINE PATH, 13 HIGH/MEDIUM inventory, current production traces):

| class | count | cases |
|-------|------:|-------|
| TARGET_REGION_RETRY | 3 | d002, d003, d019 |
| ADJACENT_VALID_REGION_RETRY | 0 | — |
| UNRELATED_REGION_RETRY | 4 | d139, d179, d181, d195 |
| NO_RETRY | 6 | d049, d099, d131, d142, d160, d176 |

Meaningful RETRY count: **3**  
Unrelated RETRY count: **4**  
NO_RETRY count: **6**

Actual live (same traces): identical to offline replay.

Agreement: **PASS**

Dataset terminology: this is a **FULL ELECTRON MAINLINE PATH** subset (14 case-ids / 13 inventory), **not** a FULL 200-CASE DATASET run. Anchored filter ≠ full dialog_200.

Overall dialog final IMPROVED (7/14 in this run) must **not** be written into the Model3 Retry funnel.

================================
TRACE SAFETY
============

Trace OFF vs ON:

- Gate: `MODEL3_INFERENCE_INPUT_TRACE=0` skips persistence only.
- Code: `inferenceInputTrace` assigned after decisions; never read by Retry / Assembly / Vote / Domain.

Model3 decisions identical: **YES** (by construction)

Final output identical: **YES** (by construction)

Empirical dual Electron restart ON/OFF was not required after code-path proof for this phase.

================================
ARCHITECTURE GOVERNANCE
=======================

Production semantics changed: **NO**  
Model3 changed: **NO**  
Features changed: **NO**  
FineSpan changed: **NO**  
Anchors changed: **NO**  
Retry changed: **NO**  
Recall changed: **NO**  
JobResult changed: **NO**  
Training changed: **NO**

Only TRACE / EVALUATION INFRASTRUCTURE changed.

================================
NEXT PHASE
==========

**MODEL3_V2_LIVE_FEATURE_DISTRIBUTION_AUDIT**

(Do not execute in this phase.)

Rationale: offline replay matches live; corrected meaningful TARGET RETRY is 3/13 with 4 unrelated — not a feature-capacity redesign authorization. First compare live RETRY/KEEP feature distributions vs training.

Feature-capacity redesign remains **NOT authorized**.

================================
CHECKLIST
==========

- [x] exact RealDist checkpoint preserved  
- [x] production checkpoint default unchanged (`MODEL3_SYNTHETIC_V1`)  
- [x] production trace boundary identified  
- [x] checkpoint ID / SHA persisted  
- [x] pathId / FineSpan / offsets / sequence / Anchor / six features / margin / decision  
- [x] exact tensors (`tokenIds`/`featVector`/`availMask`)  
- [x] cand=0 / pinyin=True defaults removed from parity eval  
- [x] historical dump no longer authoritative  
- [x] multi-path preserved  
- [x] offline replay does not generate FineSpans/Anchors/cand/pinyin  
- [x] live/replay parity tested (0 mismatches, Δmargin=0)  
- [x] d002 / d160 / d137 traced & matching corrected  
- [x] corrected 13-case result reported; old 7/13 marked non-equivalent  
- [x] no training / no feature / no architecture change  
- [x] next phase not executed  

## Artifacts

1. `docs/user_correction/model3/Lingua_Model3_V2_Offline_Eval_Pipeline_Correction_2026_08_29.md`  
2. `docs/user_correction/model3/model3_v2_live_input_trace.jsonl`  
3. `docs/user_correction/model3/model3_v2_live_replay_parity.csv`  
4. `docs/user_correction/model3/model3_v2_corrected_inventory13.csv`  
5. `docs/user_correction/model3/model3_v2_eval_pipeline_correction_summary.json`  
6. `docs/user_correction/model3/HISTORICAL_NON_PARITY_INPUT.md`  
