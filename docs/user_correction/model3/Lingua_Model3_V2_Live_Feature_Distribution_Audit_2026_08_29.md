# Lingua Model3 V2 Live Feature Distribution Audit

**Phase:** `MODEL3_V2_LIVE_FEATURE_DISTRIBUTION_AUDIT`  
**Date:** 2026-08-29  
**Mode:** READ-ONLY — no training, no data generation, no feature/threshold/architecture change  
**SSOT:** `model3_v2_live_input_trace.jsonl` (post `MODEL3_V2_OFFLINE_EVAL_PIPELINE_CORRECTION`)

================================
MAIN VERDICT
============

Primary verdict: **MULTI_FACTOR_TRAINING_DISTRIBUTION_GAP**

Training distribution explains failures: **PARTIALLY**

Feature Capacity Audit authorized: **NO**

Threshold tuning authorized: **NO**

Architecture change authorized: **NO**

Dominant co-factors (not a single cause):

1. **Token/surface label shortcuts** in RealDist training (四/温/对/背/烧/上等 RETRY-heavy)
2. **Candidate-count train/live mismatch** (TRAIN_RETRY cand≈0 always; live TARGET_RETRY often cand=1)
3. **Train single-path vs live multipath** (d002/d003 path-dependent KEEP/RETRY)
4. **Sequence-context thin/OOD** for several misses despite scalar-feature neighborhood support

`FEATURE_CAPACITY_LIMIT_NOW_SUPPORTED` is **rejected**: training coverage is not adequate, label neighborhoods are biased, and path/sequence gaps remain.

================================
AUTHORITATIVE BASELINE
======================

Checkpoint: **MODEL3_V2_REALDIST_V1**  
SHA256: `fbb8d85dc4bec117af510a9d8f0a5021a86187a1e1490ee63f9b66831bad648e` — **verified**

Historical 7/13: **HISTORICAL_NON_PARITY** — excluded from real evidence

Current original inventory (case attribution):

| class | n | cases |
|-------|--:|-------|
| TARGET | 3 | d002, d003, d019 |
| ADJACENT | 0 | — |
| UNRELATED | 4 | d139, d179, d181, d195 |
| NO_RETRY | 6 | d049, d099, d131, d142, d160, d176 |

Current-source comparable inventory:

| class | n | notes |
|-------|--:|-------|
| TARGET | 3 | unchanged |
| UNRELATED | 4 | unchanged |
| NO_RETRY | 6 | unchanged |
| STALE | **0** | none fully non-comparable |

**d160** = `CURRENT_TARGET_CHANGED_BUT_ALIGNABLE` (historical `向木李` absent; current `顺便看看项目里`). Counted as alignable NO_RETRY on 顺/便 — **not** as Model3 missing `向木李`.

================================
GROUP DEFINITIONS
=================

| group | n | definition |
|-------|--:|------------|
| TRAIN_RETRY | 23216 | RealDist train+dev non-anchor RETRY spans |
| TRAIN_KEEP | 80000 | subsampled non-anchor KEEP |
| LIVE_TARGET_RETRY | 11 | inventory target-region spans with RETRY |
| LIVE_MISSED_TARGET | 111 | inventory target-region spans with KEEP |
| LIVE_UNRELATED_RETRY | 5 | live RETRY outside target region (d139/d179/d181/d195) |
| LIVE_NORMAL_KEEP | 302 | non-target KEEP on NO_RETRY cases |

Live target/missed counts are **span×path** (multipath), so missed n≫case count.

================================
SIX-FEATURE DISTRIBUTIONS
=========================

Selected continuous stats (full table: `model3_v2_live_train_feature_distribution.csv`):

### span_rel_position

| group | n | p50 | mean | note |
|-------|--:|----:|-----:|------|
| TRAIN_RETRY | 23216 | 0.55 | 0.62 | RealDist still mid/tail-heavy overall |
| LIVE_TARGET_RETRY | 11 | 0.62 | 0.63 | SMALL live n |
| LIVE_MISSED_TARGET | 111 | 0.47 | 0.42 | more head/mid than live hits |
| LIVE_UNRELATED_RETRY | 5 | 0.23 | 0.41 | SMALL_SAMPLE |
| LIVE_NORMAL_KEEP | 302 | 0.53 | 0.53 | |

Manifest: RealDist expansion RETRY position p50≈0.32; all-RETRY p50≈0.59. Live hits sit near all-RETRY mid/tail; misses skew earlier — **partial** position coverage only.

### first_pass_cand_log1p / rawFirstPassCandidateCount

| group | cand_log1p p50 | rawCand p50 | mean raw |
|-------|---------------:|------------:|---------:|
| TRAIN_RETRY | **0** | **0** | **0** |
| TRAIN_KEEP | **0** | **0** | **0** |
| LIVE_TARGET_RETRY | **0.69** | **1** | 0.91 |
| LIVE_MISSED_TARGET | 0 | 0 | 0.37 |
| LIVE_UNRELATED_RETRY | 0 | 0 | 0.20 |
| LIVE_NORMAL_KEEP | 0.69 | 1 | 0.53 |

**Critical:** training effectively has **no RETRY contrast on candidate count** (always 0). Live successes often have cand=1 — opposite of a cand-driven RETRY rule learned from labels. Separability TARGET vs MISSED on cand: **MODERATE** (live only); train/live semantics: **distribution mismatch**.

### pinyin_channel_avail

All groups: mean=1.0, std≈0 → **LOW_VARIANCE_FEATURE** (train + live). No PINYIN_FEATURE_DISTRIBUTION_MISMATCH — both sides constantly available. Feature carries almost no decision information here.

### span_len_log1p / current_cjk_len_log1p

Almost all 1-char FineSpans (p50≈0.693). Train/live **match**. Not an architecture finding.

### isAnchor

Groups exclude anchors for train/live decision analysis; live target/unrelated rows are non-anchor.

### margin

| group | p50 | mean | max |
|-------|----:|-----:|----:|
| LIVE_TARGET_RETRY | +2.46 | +2.07 | ~+2.7 |
| LIVE_MISSED_TARGET | **-11.4** | **-11.7** | ~-0.4 |
| LIVE_UNRELATED_RETRY | +3.87 | +3.04 | **+5.17** |
| LIVE_NORMAL_KEEP | -16.5 | -15.5 | — |

Misses are **strong KEEP** (not threshold-borderline). Unrelated **引/对** margins +4…+5 are **REPRESENTATION / TRAINING MISCLASSIFICATION**, not threshold edge.

================================
FEATURE COMBINATION SUPPORT
===========================

Top `(rel_bin|cand_bin|pinyin)` cells:

| group | top combos |
|-------|------------|
| TRAIN_RETRY | TAIL\|C0\|PY1, MID\|C0\|PY1, HEAD\|C0\|PY1 |
| LIVE_TARGET_RETRY | **MID\|C1\|PY1** (8/11) |
| LIVE_MISSED_TARGET | HEAD\|C0\|PY1, MID\|C1\|PY1, TAIL\|C0\|PY1 |
| LIVE_UNRELATED_RETRY | HEAD\|C0\|PY1, mixed |

Live successes concentrate in **C1** cells that training RETRY **almost never occupies** (train RETRY is C0-only). Live unrelated often sits in **C0** cells that *are* train-RETRY-heavy — consistent with shortcut firing without needing cand.

================================
TRAINING NEIGHBORHOOD
=====================

(k=25 NN in 6-D feature space; see `model3_v2_live_training_neighborhood.csv`)

| live span | support | neighborhood | interpretation |
|-----------|---------|--------------|----------------|
| d002 背 RETRY | THIN | TRAIN_RETRY | token+path; scalar space near RETRY |
| d003 烧 RETRY | WELL | TRAIN_RETRY | well supported; path-dependent |
| d019 上 RETRY | THIN | TRAIN_RETRY | token shortcut (上 RETRY-heavy) |
| d049 科 KEEP | THIN | **TRAIN_KEEP** | keep-dominated despite 科 train RETRY-heavy overall |
| d099 那 KEEP | THIN | TRAIN_RETRY | feature near RETRY but **margin≪0** → sequence gap |
| d131/d176 则 KEEP | WELL | TRAIN_RETRY | supported yet strong KEEP |
| d160 便 KEEP | WELL | TRAIN_RETRY | supported; changed target; strong KEEP |
| d179 四 | WELL | TRAIN_RETRY | shortcut |
| d181 温 | WELL | TRAIN_RETRY | shortcut |
| d195 对 | THIN | TRAIN_RETRY | shortcut + seq OOD |
| d139 引 | THIN | MIXED | overlap; tiny train count |

================================
SEQUENCE CONTEXT
================

BiGRU local ±3 context recorded in `model3_v2_live_sequence_context.csv`.

| case | span | sequence support | note |
|------|------|------------------|------|
| d002 | 背 | SEQUENCE_OOD | path-varying neighbors |
| d003 | 烧 | THIN | borderline margin on one path |
| d019 | 上 | OOD | multi-path but 上 RETRY robust |
| d099/d142 | targets | OOD | strong negative margins |
| d131/d160/d176 | targets | WELL | still KEEP → not pure sequence absence |
| d179/d181 | 四/温 | WELL | shortcut with supported seq shell |
| d195 | 对 | OOD | strong +margin unrelated |

================================
TOKEN / SURFACE SHORTCUT
========================

| surface | TRAIN_KEEP | TRAIN_RETRY | ratio | evidence |
|---------|----------:|------------:|------:|----------|
| 背 | 0 | 88 | 1.00 | TOKEN_LABEL_SHORTCUT |
| 烧 | 1 | 92 | 0.99 | TOKEN_LABEL_SHORTCUT |
| 上 | 203 | 321 | 0.61 | TOKEN_LABEL_SHORTCUT |
| 四 | 0 | 148 | 1.00 | TOKEN_LABEL_SHORTCUT |
| 温 | 3 | 311 | 0.99 | TOKEN_LABEL_SHORTCUT |
| 对 | 117 | 209 | 0.64 | TOKEN_LABEL_SHORTCUT |
| 苏 | 2 | 180 | 0.99 | TOKEN_LABEL_SHORTCUT (but live KEEP) |
| 引 | 0 | 3 | 1.00 | INSUFFICIENT_SAMPLE |
| 能 | 698 | 2 | 0.00 | NO_TOKEN_SHORTCUT (target KEEP) |
| 在 | 664 | 4 | 0.01 | NO_TOKEN_SHORTCUT |

Unrelated **四/温/对** align with TOKEN_LABEL_SHORTCUT. Success **背/烧/上** also sit in shortcut regime — successes are **not** clean proof of healthy target-region learning.

================================
PATH DEPENDENCE
===============

| case | surface | paths | RETRY | KEEP | margin range | class |
|------|---------|------:|------:|-----:|--------------|-------|
| d002 | 背 | 3 | 2 | 1 | -0.60 … +1.58 | **PATH_DEPENDENT** |
| d003 | 烧 | 2 | 1 | 1 | -1.65 … +0.33 | **PATH_DEPENDENT** |
| d019 | 上 | 8 | 8 | 0 | +2.39 … +2.71 | ROBUST_ACROSS_PATHS |
| d019 | 成 | 8 | 0 | 8 | -20.2 … -8.0 | ROBUST (miss probe 成) |

Train vs live path structure: **TRAIN_SINGLE_PATH_VS_LIVE_MULTIPATH**  
Training samples expose one `spans[]` sequence per utterance (0 `pathId` multipath field). Live inventory cases: 10/13 multipath.

================================
TRAIN VS LIVE PATH STRUCTURE
============================

- Train: one canonical FineSpan sequence / sample  
- Live: multiple SegmentationPaths with different seqLen / neighbors / margins for the same surface  
- Explains d002/d003 KEEP↔RETRY flips  
- Does **not** alone explain unrelated 引/四/温/对 or strong-negative misses on multipath-robust surfaces

================================
TARGET CASE ROOT-CAUSE MATRIX
=============================

| case | target | attr | margin | feat support | label neigh | seq | path | primary explanation |
|------|--------|------|-------:|--------------|-------------|-----|------|---------------------|
| d002 | 背 | TARGET | +1.58 | THIN | TRAIN_RETRY | OOD | PATH_DEP | MIXED (token+path) |
| d003 | 烧 | TARGET | +0.33 | WELL | TRAIN_RETRY | THIN | PATH_DEP | MIXED (token+path) |
| d019 | 上 | TARGET | +2.71 | THIN | TRAIN_RETRY | OOD | ROBUST | MIXED (token; probe 成 missed) |
| d049 | 科 | NO_RETRY | -10.8 | THIN | TRAIN_KEEP | OOD | ROBUST | TRAIN_KEEP_DOMINATED_NEIGHBORHOOD |
| d099 | 那 | NO_RETRY | -20.3 | THIN | TRAIN_RETRY | OOD | ROBUST | SEQUENCE_DISTRIBUTION_GAP |
| d131 | 则 | NO_RETRY | -20.7 | WELL | TRAIN_RETRY | WELL | ROBUST | TRAIN_RETRY_COVERAGE_GAP* |
| d142 | 回 | NO_RETRY | -18.2 | THIN | TRAIN_RETRY | OOD | SINGLE | SEQUENCE_DISTRIBUTION_GAP |
| d160 | 便 | NO_RETRY | -11.8 | WELL | TRAIN_RETRY | WELL | ROBUST | TRAIN_RETRY_COVERAGE_GAP + changed source |
| d176 | 则 | NO_RETRY | -20.8 | WELL | TRAIN_RETRY | WELL | ROBUST | TRAIN_RETRY_COVERAGE_GAP* |

\*“COVERAGE_GAP” here means: scalar/seq neighborhood looks RETRY-like but model emits strong KEEP — likely missing **hard RETRY contrast under live sequence shells**, not missing the surface token (苏/则/限 are often RETRY-heavy in train yet KEEP in live).

================================
UNRELATED RETRY ROOT-CAUSE MATRIX
=================================

| case | span | margin | support | neigh | seq | token | primary |
|------|------|-------:|---------|-------|-----|-------|---------|
| d139 | 引 | +4.68 / +3.87 | THIN | MIXED | WELL | insuff. (3 RETRY) | FEATURE_SPACE_LABEL_OVERLAP |
| d179 | 四 | +0.68 | WELL | TRAIN_RETRY | WELL | **SHORTCUT** | TOKEN_LABEL_SHORTCUT |
| d181 | 温 | +0.78 | WELL | TRAIN_RETRY | WELL | **SHORTCUT** | TOKEN_LABEL_SHORTCUT |
| d195 | 对 | **+5.17** | THIN | TRAIN_RETRY | OOD | **SHORTCUT** | TOKEN_LABEL_SHORTCUT |

Distance from true targets: 引≠能; 四≠限; 温≠下/贝; 对≠在 — confirmed UNRELATED.

================================
KEY QUESTIONS
=============

**Why d002/d003/d019 succeed?**  
Not because six-feature geometry cleanly separates targets. They succeed where (a) surface tokens are train-RETRY-dominated (背/烧/上), and/or (b) a favorable path sequence pushes margin over 0 (d002/d003 path-dependent). d019 RETRYs **上** robustly but **misses probe 成** — partial/region-shifted success.

**Why six targets are missed?**  
Mix of: strong negative margins (not threshold), sequence OOD (d099/d142), keep-dominated neighborhood (d049), well-supported-but-KEEP shells (d131/d176/d160) implying missing live-like RETRY contrast, plus d160 source change.

**Why d139/d179/d181/d195 RETRY unrelated?**  
Primarily **training label shortcuts** on 四/温/对 (+ high margins). 引 is rare but MIXED-overlap with large positive margin — not threshold noise.

**Can training distribution explain it?**  
**PARTIALLY — YES as primary driver family**, via shortcuts + cand collapse + single-path training vs multipath live + sequence shells. Not fully: some WELL_SUPPORTED misses remain after token accounting.

**Is feature capacity actually implicated?**  
**NO** for authorization now. Existing space already shows biased neighborhoods and train/live structural gaps; capacity redesign would confound those.

================================
GOVERNANCE
==========

Model3 changed: **NO**  
Feature contract changed: **NO**  
Threshold changed: **NO**  
Training data changed: **NO**  
Training executed: **NO**  
FineSpan / Retry / Recall / JobResult changed: **NO**

================================
NEXT PHASE
==========

**MODEL3_V2_TARGETED_DISTRIBUTION_CORRECTION_DESIGN**

Do **not** execute in this phase.

Design should specify (without generating data yet) how to jointly address:

1. Hard negatives for shortcut tokens (四/温/对/… ) in KEEP contexts  
2. Non-zero `first_pass_cand` contrast on both RETRY and KEEP  
3. Multipath / alternate-sequence RETRY–KEEP pairs for path-dependent surfaces  
4. Preserve RealDist position goals without reintroducing historical FineSpan eval

Optional subordinate audit if design needs a dedicated deep-dive: `MODEL3_V2_TRAIN_LIVE_PATH_STRUCTURE_AUDIT` (path is major but not sole).

Feature Capacity Audit: **not** next.

================================
CHECKLIST
==========

- [x] production SSOT used; historical 7/13 excluded; SHA verified  
- [x] inventory vs sourceText; stale/alignable marked (d160 alignable)  
- [x] groups A–F; six features; cand/pinyin/position/length/CJK  
- [x] combinations; NN support; label neighborhoods; ±3 sequence  
- [x] token shortcuts; path dependence; train/live path structure  
- [x] d002/d003/d019 + misses + unrelated explained  
- [x] no train / no data gen / no threshold / no feature / no arch change  
- [x] next phase selected, not executed  

## Artifacts

1. `docs/user_correction/model3/Lingua_Model3_V2_Live_Feature_Distribution_Audit_2026_08_29.md`  
2. `docs/user_correction/model3/model3_v2_live_train_feature_distribution.csv`  
3. `docs/user_correction/model3/model3_v2_live_training_neighborhood.csv`  
4. `docs/user_correction/model3/model3_v2_live_sequence_context.csv`  
5. `docs/user_correction/model3/model3_v2_live_distribution_audit_summary.json`  
