# KenLM Sentence Rerank — Batch-Only Runtime

**状态**：FROZEN（2026-06-17）  
**代码根**：`main/src/asr-repair/sentence-rerank/kenlm-scorer.ts` · `main/src/phonetic-correction/lm-scorer.ts`  
**V4 入口**：`fw-detector/kenlm/run-fw-sentence-rerank-from-prefilled.ts`

---

## 1. 概述

V4 句级 rerank 通过 **单次或分块 batch subprocess** 调用 KenLM `query.exe`，对 raw + 候选句打分后 pick 最佳句。  
**无 serial runtime、无 fallbackToSerial**；subprocess 失败时 **fail-open**（全句 score=0，不阻断 pipeline）。

典型 happy path：1 raw + 16 candidates = **17 行** → **1 次 spawn**（`kenlmSubprocessMaxLines=17`）。

---

## 2. 调用链

```text
runFwDetectorV4Path
  → runFwSentenceRerankFromPrefilled
      → createKenlmBatchScorer().scoreBatch(sentences)
          → tokenizeRows
          → splitNonEmptyTokenLines (chunk by maxLines)
          → runKenlmQueryBatch × N chunks (串行)
          → mapLmResultsToScores
      → pick + weak_veto / hard_gate
  → applyFwSpanReplacements (阈值 minDeltaToReplace)
```

**禁止修改**（冻结内）：`normalizeLmScore`、`minDeltaToReplace`、pick 逻辑、Apply gate。

---

## 3. Batch 行为

| 场景 | 行为 |
|------|------|
| 全空 token | 不 spawn；score 全 0；无 `kenlmSubprocessErrorReason` |
| subprocess 不可用 | fail-open；score 全 0 |
| batch 成功 | 按输入顺序映射 score（空行占位 score=0） |
| batch 失败 | 整批 scoreAllZero + `kenlmSubprocessErrorReason` |
| 非空句 > maxLines | chunk 串行 spawn，合并 `lmResults` 后映射 |

Chunk 示例：25 句中 5 空行、20 非空、`maxLines=17` → **2 spawns**（17 + 3）。

---

## 4. 配置

唯一加载入口：`loadFwDetectorRuntimeConfig()`（`fw-config.ts`）。

| 键 | 默认 | 说明 |
|----|------|------|
| `features.fwDetector.kenlmSubprocessTimeoutMs` | `5000` | 单次 spawn 超时（ms） |
| `features.fwDetector.kenlmSubprocessMaxLines` | `17` | 单次 batch 最大非空句数 |
| `features.fwDetector.enableKenLMGate` | `true` | **必需**，否则不 pick |
| `features.fwDetector.maxSentenceCandidates` | `16` | 候选句上限 |
| `features.fwDetector.minDeltaToReplace` | `0.03` | Apply pick 阈值（非 KenLM scorer 内使用） |
| `features.fwDetector.kenlmGateMode` | `weak_veto` | `weak_veto` \| `hard_gate` |

**兼容读取（旧键）：** `kenlmBatchSubprocessTimeoutMs` → `kenlmSubprocessTimeoutMs`；`kenlmBatchSubprocessMaxSentences` → `kenlmSubprocessMaxLines`。

**已删除：** `kenlmBatchSubprocessEnabled`、`kenlmBatchSubprocessFallbackToSerial`、`kenlmRuntimeMode`。

完整键表：[CONFIG.md](../CONFIG.md)。

---

## 5. Diagnostics 字段

`KenlmSubprocessRuntimeDiag`（经 `sentenceRerank` → `fw_detector` 透传）：

| 字段 | 含义 |
|------|------|
| `kenlmQueryCount` | 非空 token 行数 |
| `kenlmSubprocessMs` | subprocess 墙钟耗时 |
| `kenlmSubprocessCount` | spawn 次数 |
| `kenlmSubprocessErrorReason` | 失败原因（成功时省略） |

V4 path 顶层：`kenlmVetoMs` ← `kenlmSubprocessMs`（性能观测）。

**废止字段：** `kenlmRuntimeMode`、`kenlmBatchSubprocessMs`、`kenlmBatchSubprocessFallbackReason`。

---

## 6. 模型与 subprocess

| 项 | 路径/说明 |
|----|-----------|
| 模型 | `services/asr_sherpa_lm/models/kenLM/zh_char_3gram.trie.bin` |
| query | `query.exe`（与 phonetic-correction 共用 `lm-scorer.ts`） |
| 互斥 | batch spawn 进程级 mutex，避免并发 query.exe |
| 分词 | `tokenizeForLm`（char-level） |

HTTP 5016（`phonetic_correction_zh`）与 FW KenLM **独立**；本轮不改 Python 服务。

---

## 7. 静态门禁（GATE-1）

`kenlm-scorer.ts` **不得**出现：

```text
scoreBatchSerial · buildSerialKenlmTiming · shouldUseBatchSubprocess
runKenlmQuery · kenlmBatchSubprocessEnabled · fallbackToSerial · kenlmRuntimeMode
```

断言：`freeze-contract.test.ts`。

---

## 8. SSOT 文件

| 文件 | 职责 |
|------|------|
| `kenlm-scorer.ts` | batch-only scorer |
| `kenlm-batch-types.ts` | 类型与 diagnostics |
| `lm-scorer.ts` | `runKenlmQueryBatch`、mutex、parse |
| `run-fw-sentence-rerank-from-prefilled.ts` | V4 rerank 编排 |
| `fw-detector-v4-path.ts` | diagnostics 映射 |
| `kenlm-scorer.test.ts` | batch-only 单测 |

---

## 9. 性能参考（dialog200）

生产门槛（批测观测，非单测断言）：

| 指标 | 目标 |
|------|------|
| `kenlmVetoMs` P95 | &lt; 2000 ms |
| `fw_detector_step_ms` P95 | &lt; 4000 ms |

批测命令见 [README.md](../README.md)。

---

## 10. 禁止项（冻结内）

- 恢复 serial runtime 或 `fallbackToSerial`
- 在 `kenlm-scorer.ts` 直接读 node-config（须经 `loadFwDetectorRuntimeConfig`）
- 修改 `normalizeLmScore` 或 rerank pick 公式
- 将 KenLM 决策移入 Compatibility / Assembly 层

---

## 11. Follow-up（非阻塞）

`phonetic-correction/lm-scorer.ts` 中 `runKenlmQuery`（单次查询）为遗留 API，FW 主链不再使用，可单独清理。
