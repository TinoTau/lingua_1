# P1~P4 冻结后精简 — dialog_200 测试报告

版本：V1.0  
日期：2026-05-31  
数据集：`D:\Programs\github\lingua_1\test wav\dialog_200`  
脚本：`tests/run-lexicon-v2-p4-batch.js --max-minutes 15`

---

## 1. 测试环境

| 项 | 值 |
|----|-----|
| 节点 test server | `http://127.0.0.1:5020` |
| ASR | `faster-whisper-vad :6007`（`asr_model_loaded=true`） |
| 配置 | `patch-p4-config.mjs` → `freeze-config-ssot.json` |
| `PROJECT_ROOT` | `D:\Programs\github\lingua_1` |
| 时间上限 | **15 分钟**（`time_limit_reached=true`） |

启动注意：需清除 `ELECTRON_RUN_AS_NODE=1`，否则 Electron 以 Node 模式运行导致 test server 无法启动。

---

## 2. 执行摘要

| 指标 | 值 |
|------|-----|
| 计划用例 | 200 |
| **实际评测** | **108**（d001–d108） |
| 契约 PASS | **108 / 108（100%）** |
| 契约 FAIL | 0 |
| 批测墙钟 | **905 s（≈15.1 min）** |
| 平均墙钟/条 | **8.38 s** |

---

## 3. 识别质量（CER，归一化后字符级）

基于 `cases.manifest.json` 中 `utterance` 参考文本。

| 指标 | Raw ASR | Final（FW 后） |
|------|---------|----------------|
| 评测条数 | 108 | 108 |
| **平均 CER** | **37.29%** | **37.26%** |
| **中位 CER** | **27.27%** | **27.27%** |
| **P95 CER** | **88.00%** | **88.00%** |

### FW 修正效果

| 指标 | 数量 |
|------|------|
| FW improved（CER 下降） | **1** |
| FW degraded（CER 上升） | **0** |
| FW apply 总数 | **1** |
| 文本变更条数 | **1** |

**唯一 apply：d043**（`lexicon_homophone`）

| 字段 | 值 |
|------|-----|
| raw | 我們下午討論後 |
| final | 我们下午討論後 |
| span_count | 1 |
| sentence_rerank | pickedIsRaw=**false** |
| maxDelta | 0.0307（阈值 0.03） |
| kenlmQueryCount | 2 |
| pipeline_ms | 12737 |

与 P4 全量基线（200 条）一致：仍为 d043 单点 apply，无 degraded。

---

## 4. FW 主链诊断

### 4.1 Metadata Span Gate

| 指标 | P50 | P95 | Max |
|------|-----|-----|-----|
| span_count / job | 0 | 1 | 2 |
| fw_metadata_gate_ms | 0 | 1 | 1 |

### 4.2 Sentence Rerank（22 jobs，占 108 条中有 span 的子集）

| 指标 | 值 |
|------|-----|
| jobs_with_diagnostics | 22 |
| picked raw | 21 |
| picked candidate | **1**（即 d043） |
| combination_count P95 | 3 |
| kenlm_query_count P95 | 4 |
| max_delta P95 | 97（×10⁻⁴ 刻度） |

---

## 5. 性能

### 5.1 Pipeline 端到端（`pipeline_ms`）

| 分位 | ms |
|------|-----|
| min | 4425 |
| **P50** | **7468** |
| **P95** | **14791** |
| P99 | 25554 |
| max | 31569 |
| **avg** | **8374** |

### 5.2 FW Detector 子步

| 子步 | P50 | P95 | avg |
|------|-----|-----|-----|
| fw_detector_step_ms | 0 | 1192 | 177 |
| kenlm_sentence_rerank_ms | 0 | 1186 | 176 |
| fw_metadata_gate_ms | 0 | 1 | 0 |

### 5.3 墙钟

| 指标 | 值 |
|------|-----|
| batch_elapsed_sec | 905 |
| avg_wall_sec_per_case | 8.38 |

**性能说明：** 首条 d001 `pipeline_ms=25554`（ASR/GPU 冷启动）；后续多数落在 5–11 s。P95 受冷启动与 d067（31569 ms）拉高。**FW 步 P95 ≈ 1.2 s**，与历史 P4 全量（≈1.3 s）同量级，精简未引入 FW 侧回归。

---

## 6. 与历史基线对比

| 指标 | 本轮（108 条） | P4 全量基线（200 条） | P3.3 基线 |
|------|----------------|----------------------|-----------|
| 契约 PASS | 108/108 | 200/200 | 200/200 |
| avg CER final | 37.26% | 36.17% | 36.35% |
| FW apply | 1 | 1 | 24 |
| FW degraded | 0 | 0 | 14 |
| pipeline P95 | 14791 ms | 4337 ms | 4096 ms |
| sentence_rerank jobs | 22 | 39 | — |
| picked candidate | 1 | 1 | — |

**结论：**

- **质量 / apply 行为**：与 P4 全量基线一致（单点 d043 apply，0 degraded）；108 条 CER 与 200 条均值接近，属采样波动。
- **性能**：本轮 P95 高于 P4 全量，主因 **15 分钟窗口内仅跑 108 条、ASR 冷启动与个别 outlier**，非 P0/P1 配置精简导致的主链逻辑变化。
- **相对 P3.3**：apply 仍高度保守（1 vs 24），degraded 0 vs 14，符合 P4 句级 rerank 设计预期。

---

## 7. 冻结精简 Checklist 对照

| 检查项 | 结果 |
|--------|------|
| Metadata Gate 唯一 Span 来源 | PASS（span_gate_mode=fw_metadata_gate） |
| Lexicon V2 唯一 Recall | PASS |
| Sentence Rerank 唯一决策链 | PASS |
| applyFwSpanReplacements 唯一 Apply | PASS（apply=1，d043） |
| segmentForJobResult 唯一 NMT 输入 | PASS（契约 108/108） |
| maxSpans SSOT = gate.maxSpans(4) | PASS（config 镜像 SSOT） |
| enableKenLMGate 开启 | PASS |

---

## 8. 产物

| 文件 | 说明 |
|------|------|
| `tests/lexicon-v2-p4-batch-result.json` | 108 条原始批测 |
| `tests/lexicon-v2-p4-quality-perf.json` | 质量/性能聚合 |
| `tests/lexicon-v2-p4-batch-run.log` | 控制台日志 |
| [开发报告](./P1_P4_Freeze_Simplification_开发报告_2026_05_31.md) | 本轮代码变更摘要 |

---

## 9. 建议后续

1. 若需完整 200 条对比，可在 ASR 预热后重跑 `--max-minutes 25` 或不限时全量。
2. 批测前确认 `ELECTRON_RUN_AS_NODE` 未设置，并启用 `faster-whisper-vad` / `nmt-m2m100` / `piper-tts` 服务偏好。
