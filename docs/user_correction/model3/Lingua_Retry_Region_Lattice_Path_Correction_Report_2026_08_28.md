# Lingua — Retry Region Lattice & Path Correction（合并报告）

**Date:** 2026-08-28  
**Artifact policy:** 本轮全部产物合并为 **≤10 文件**（实际 5 文件）；后续阶段沿用同一 bundle 约定。

| 文件 | 用途 |
|------|------|
| 本报告 | 审计 + 输入 parity + 路径选择 + ASR 回归摘要 |
| `retry_region_lattice_path_bundle.json` | 各阶段 verdict / governance / 结构化摘要 |
| `retry_region_controlled_cases.csv` | 13 控例统一明细 |
| `retry_region_metrics.csv` | 跨阶段 before/after 指标 |
| `retry_region_candidate_lifecycle.csv` | Recall → pool → Assembly 生命周期 |

---

## Phase 1 — Lattice Alternative Path Audit（READ-ONLY）

**Verdict:** `LATTICE_INPUT_DRIFT` · Training gate: **HOLD**

**根因：** `resegmentRetryRegionWithLattice` 未传入 `acousticSlices` / `wordTimeSpans` → lattice 内 `toneActive=false` → 无 multi-char lexical edge → 仅 fallback 单字路径 → `segmentationChanged=0/13`。

**修复前指标（n=13）：** 2–5 字 lexical edge 区域均为 0；pathCount>1 为 0；4/13 案例 noTone=0 / withTone>0。

---

## Phase 2 — Input Parity Correction

**Verdict:** `PASS` · Training gate: **OPEN**

**改动：** orchestrator → `runModel3PathStep` → `resegmentRetryRegionWithLattice` 传递权威 `acousticSlices` / `wordTimeSpans`（区域 raw 重映射）+ config parity。

**修复后指标：**

| 指标 | BEFORE | AFTER |
|------|-------:|------:|
| 2-char edge regions | 0 | 6 |
| Regions >1 path | 0 | 6 |
| Segmentation changed | 0 | 3 |
| Tone evidence passed | 0 | 13 |

**修改文件：** `model3-retry-region-resegment.ts`, `run-model3-path-step.ts`, `span-assembly-v4-orchestrator.ts`

---

## Phase 3 — Path Selection Minimal Correction

**Verdict:** `PASS_WITH_COVERAGE_GAPS` · Training gate: **OPEN**

**根因：** `pathFineSpanViews` 按 **boundaryKey ASC** 输出；Retry 误用 `[0]` 而非 lattice `compareBestFirst` SSOT。

**改动：** 导出 `compareSegmentationPathBestFirst`；Retry 按 comparator 选最优 `segmentationPath` 对应 view。

**6 个多路径案例：** SSOT 在标准 1–6 打平时决胜同为 boundaryKey ASC → 选择与旧 `[0]` 相同（非 regression）。结构性假设已移除。

**修改文件：** `enumerate-complete-segmentation-paths.ts`, `model3-retry-region-resegment.ts`, `enumerate-complete-segmentation-paths.test.ts`

---

## Phase 4 — ASR-Env Controlled Validation（最终状态）

**Verdict:** `PASS` · Reference reachable: **5 / 13** · Lattice OK: **13 / 13**

| Case | Seg changed | Reachability |
|------|:-----------:|--------------|
| d179 | NO | REACHABLE |
| d142 | YES | REACHABLE |
| d099 | NO | NOT_REACHABLE |
| d131 | YES | NOT_REACHABLE |
| d160 | NO | NOT_REACHABLE |
| d176 | YES | NOT_REACHABLE |

**剩余瓶颈：** PHONETIC_RECALL_COVERAGE / LEXICON_COVERAGE（非 Retry 结构性阻塞）

**Performance：** Retry median ≈ 2 ms，p95 ≈ 15 ms

**Dialog_200：** NOT_RUN（electron whenReady 环境问题；改动仅影响 RETRY resegment）

---

## 最终结论

| 项 | 状态 |
|----|------|
| Input parity | PASS |
| Path selection SSOT | PASS_WITH_COVERAGE_GAPS |
| Model3 training gate | **OPEN** |
| Recommended next | `MODEL3_V1_TRAINING_COVERAGE_FOR_RETRYABLE_LOCAL_REGIONS` |

**Governance：** Model3 / FineSpan core / Lattice algorithm / Recall / Lexicon / Domain Vote / Assembly 均未改动。
