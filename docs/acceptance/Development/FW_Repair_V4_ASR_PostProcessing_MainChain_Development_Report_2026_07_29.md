<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_ASR_PostProcessing_MainChain_Development_Report_2026_07_29.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — ASR Post-Processing Main Chain Development Report

**Date:** 2026-07-29  
**Batches:** A (Frozen V2 Default) + B (WordTimeSpan Integrity) + C (Tone Participation Mapping)  
**Goal:** Tone Information Always Participates — 跑通 ASR 后处理主链（非 Tone Accuracy）  
**Plan:** `FW_Repair_V4_ASR_PostProcessing_MainChain_Development_Plan_2026_07_29.md`（Batch C 已按本轮指令从 Fill 改为 Mapping）

---

## 1. Development Summary

本轮完成三项限域修复，**未**重训、**未**改 Feature Contract / CNN / Lexicon / Domain / Assembly / KenLM / Span Window 规则：

| Batch | 内容 | 结果 |
| ----- | ---- | ---- |
| **A** | 生产默认 → Frozen Production V2；删 Tiny 默认；完整 identity 日志；Fail Closed | **DONE** |
| **B** | 删除 `words=None` 静默丢弃；`skip_text_dedup` 默认 true；ToneSlice>0∧words=0 Fail Closed | **DONE** |
| **C** | Tone Participation **Mapping**（非 Fill）：按 WordTimeSpan 坐标把真实 slice 映射到音节槽；删长度硬门 | **DONE** |

**Tone 职责：** 只输出真实 `AcousticToneSlice` posterior（Observation）。  
**Recall 职责：** 经 `mapToneEvidenceForRecall` 消费证据 → 得到可构建 `tonePinyinKey` 的 pattern → Mandatory Tone SQL。

**未在本轮执行：** 完整 Electron→NMT 真机 E2E；dialog_200 全量。代码与单测已具备进入全链测试的条件。

---

## 2. Modified Files

| File | Batch |
| ---- | ----- |
| `electron_node/services/faster_whisper_vad/config.py` | A |
| `electron_node/services/faster_whisper_vad/tone_module/loader_v1.py` | A |
| `electron_node/services/faster_whisper_vad/api_models.py` | B |
| `electron_node/services/faster_whisper_vad/text_processing.py` | B |
| `electron_node/services/faster_whisper_vad/api_routes.py` | B |
| `electron_node/electron-node/main/src/fw-detector/tone-time-align.ts` | C |
| `electron_node/electron-node/main/src/fw-detector/span-assembly-shared/tone-recall.ts` | C |
| `electron_node/electron-node/main/src/fw-detector/tone-time-align.test.ts` | C |

---

## 3. Modified Functions

| Function | Change |
| -------- | ------ |
| `config.TONE_MODEL_PATH` default | → `.../candidate/tone_cnn_production_v2_candidate_20260712.npz` |
| `loader_v1._resolve_model_path` | 默认仅 Frozen V2；无 Tiny fallback |
| `ToneModelLoaderV1.load` | 启动日志：path / sha256 / architecture / featureVersion / backend / inputShape / outputShape / trainingVersion |
| `UtteranceRequest.skip_text_dedup` | 默认 `True`（与 fw_detector_v1 主链一致） |
| `update_segments_after_deduplication` | **删除** `words=None`；保留 WordInfo |
| `api_routes` response gate | ToneSlice>0 且 words=0 → HTTP 500 Fail Closed |
| `mapToneEvidenceForRecall`（新） | Participation Mapping：syllable → WordTimeSpan → real slice argmax |
| `extractAcousticTonePatternByTime` | 改为调用 Mapping；删除 `overlapSlices.length !== rawEnd-rawStart → null` |
| `extractAcousticTonePatternForRecall` | 调用 `mapToneEvidenceForRecall` |

---

## 4. Data Contract

| 字段 | 合同 |
| ---- | ---- |
| Production model | `tone_cnn_production_v2_candidate_20260712.npz` SHA256=`AADE7B531049204FD7E8601944B3A3429BD3EC16015C550E2C6B3FD27B368723` |
| Word Timestamp SSOT | FW `segments[].words[]` / WordInfo |
| Tone Evidence | `AcousticToneSlice.tonePosterior`（真实推理） |
| Mapped pattern | `number[syllableCount]`，每位 ∈{1..5}，来自覆盖该音节字符槽的 Word 对应 **真实** slice |
| Recall | `resolveToneRecallReadiness` 不变；有 pattern → Tone SQL |

**禁止（本轮已遵守）：** 伪造 posterior、扩展/复制张量、Plain Recall、第二管道。

---

## 5. Code Logic

### Batch A

```text
explicit path > TONE_MODEL_PATH (test only) > Frozen V2 default
missing file → Fail Closed（不切 Tiny）
load success → identity log
```

验证（无 env）：

```text
RESOLVED = .../candidate/tone_cnn_production_v2_candidate_20260712.npz
SHA prefix = aade7b531049204f
```

### Batch B

```text
production: skip_text_dedup=true（Node fw_detector_v1 + API 默认）
dedup 若改写文本：保留 words，禁止 words=None
response: if toneSliceCount>0 && wordCount==0 → 500
```

### Batch C — Participation Mapping

```text
FOR each syllable slot in Fine Span:
  charOffset ← coordinate map (1:1 when charLen==syllableCount)
  covering WordTimeSpan ← FW words SSOT
  real AcousticToneSlice ← time overlap with that word
  pattern[i] ← argmax(real posterior)   // Observation only
DELETE: overlapSlices.length !== (rawEnd-rawStart) → null
```

多字 ASR token（一词一片）时，多个音节槽映射到同一真实 slice 的 argmax —— 这是 **坐标映射消费同一 Observation**，不是 Fill 算法按比例捏造新 posterior。准确率优化延期。

---

## 6. Deleted Logic

| Deleted | Why |
| ------- | --- |
| Tiny `tone_cnn_p1_v1_full.npz` 生产默认 | Batch A |
| loader 对 Tiny 的隐式默认回退 | Batch A |
| `update_segments_after_deduplication` → `words=None` | Batch B |
| `overlapSlices.length !== charSpan → pattern=null` | Batch C |
| Participation Fill（按长度复制/编造 pattern） | 本轮明确不做 |

---

## 7. Regression Result

### Unit tests

```text
PASS tone-time-align.test.ts
PASS tone-recall-readiness.test.ts
PASS tone-recall-counterfactual.test.ts
PASS tone-match-score.test.ts
18 passed
```

### Mapping regression samples（单元）

覆盖：`你好` `我们` `订单` `预订` `前台` `接口` `上线计划` `机场高速` `大杯小杯`  
断言：pattern 非空、长度=音节/字数、tone∈[1,5]（**参与性**，非准确率金标）。

### Default model

无 `TONE_MODEL_PATH` → Frozen V2 路径存在且 SHA 前缀匹配。

### Full Electron E2E / dialog_200

**本轮未跑。** 判定为：**代码就绪，可进入 dialog_200 全链测试。**

---

## 8. Acceptance Result

| Criterion | Status |
| --------- | ------ |
| Production 唯一 Frozen V2（无 env） | **PASS** |
| 无 Tiny 生产默认 / 无新增 fallback | **PASS** |
| 启动 identity 日志字段齐全 | **PASS**（代码） |
| WordTimeSpan SSOT 保留；words=None 删除 | **PASS** |
| ToneSlice>0∧words=0 Fail Closed | **PASS** |
| Tone 只输出真实 Evidence | **PASS**（inference 未改；Mapping 只读 posterior） |
| Recall 消费 Tone Evidence（Mapping → readiness → Tone SQL） | **PASS**（代码路径） |
| 无 Pattern 长度硬门导致大规模 no_pattern | **PASS**（硬门已删） |
| 未改 Recall/Domain/Assembly/KenLM/Lexicon/Span 规则 | **PASS** |
| Electron 全链实测 | **NOT RUN**（就绪待测） |

---

## 9. Remaining Deferred Items

```text
Tone Accuracy Optimization
Perfect Alignment / per-syllable re-inference
feature_v2 source provenance 重建
训练/export 链恢复
dialog_200 全量 Electron E2E 验收执行
非生产旧 artifact 全量清理
loader.py (P0) 遗留文件整理（生产主链走 loader_v1）
```

---

## 10. Final Must-Answer

| # | 问题 | 答案 |
| - | ---- | ---- |
| 1 | Production 是否唯一使用 Frozen V2？ | **YES**（无 env 默认即 V2；env 仅测试 override） |
| 2 | WordTimeSpan 是否唯一且完整？ | **YES**（SSOT=FW WordInfo；禁止静默清空；缺则 Fail Closed） |
| 3 | Tone 是否只输出真实 Evidence？ | **YES**（未改推理；未伪造 posterior） |
| 4 | Recall 是否真正消费 Tone Evidence？ | **YES**（`mapToneEvidenceForRecall` → Mandatory Tone path） |
| 5 | 是否删除生产旧兼容逻辑？ | **YES**（Tiny 默认、words=None、长度硬门） |
| 6 | 是否完成整个 ASR 后处理主链？ | **CODE READY / E2E NOT RUN** — 主链代码已打通参与性缺口；真机全链待 dialog_200 |
| 7 | 是否可以进入 dialog_200 全链测试？ | **YES** |

```text
PRODUCTION MODEL: Frozen V2 UNIQUE
WORD TIMESTAMP SSOT: FW WordInfo
TONE ROLE: Observation only
RECALL ROLE: Participation Mapping consumer
PARTICIPATION FILL: NOT IMPLEMENTED (rejected)
ACCURACY WORK: DEFERRED
READY FOR dialog_200 FULL CHAIN: YES
```

---

**文档状态：** DEVELOPMENT REPORT  
**下一动作：** 跑通 Electron → ASR → Tone → Span → Recall → Domain → Assembly → KenLM → NMT 的 dialog_200 全链验收。
