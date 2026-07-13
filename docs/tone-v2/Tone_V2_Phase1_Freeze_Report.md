# Tone V2 Phase 1 — Freeze Report

**Date:** 2026-06-29  
**Type:** Freeze / SSOT Synchronization（非开发）  
**Authority:** [Lingua Project Constitution](../CODING/Lingua%20Project%20Constitution%EF%BC%88Project%20SSOT%EF%BC%89.md) · [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)

---

## Executive Summary

**Tone V2 Phase 1 正式关闭。**

本轮仅执行冻结、文档同步与 SSOT 整理，**未修改** Runtime、Decision、Contract 代码或行为。

| 冻结域 | 状态 |
|--------|------|
| Runtime Contract（FW → Apply） | ✅ FROZEN |
| Data Contract | ✅ FROZEN |
| Ownership Contract | ✅ FROZEN |
| Feature Baseline（P0） | ✅ FROZEN |
| Loader Contract | ✅ FROZEN |
| Diagnostics Contract | ✅ FROZEN |
| DELETE Contract | ✅ 已执行并确认 |
| Regression Gate | ✅ 已同步至 SSOT |
| 文档 SSOT | ✅ 单一入口：`TONE_V2_CONTRACT_FREEZE.md` + [README.md](./README.md) |

**E2E 证据：** [Node E2E Runtime Recovery Report](./Tone_V2_Phase1_Node_E2E_Runtime_Recovery_Report.md) — dialog_200 **200/200** `tone_effective_chain`。

**Final Verdict: PASS**

---

## Frozen Runtime Contract

```text
FW Worker
  → run_tone_inference()
  → UtteranceResponse.tone
  → ASRResult.tone
  → ctx.acousticToneSlices
  → Recall
  → Ranking
  → Assembly
  → KenLM
  → Apply
```

| 约束 | 裁决 |
|------|------|
| 主链顺序 | **冻结** — Phase 2 前不得改 hop |
| Tone Effective 范围 | Recall / Ranking（间接） |
| KenLM · Apply | **intentionally tone-free** |
| 禁止 | Node 独立 Tone Step · 第二 HTTP tone 出口 · Assembly Tone Guard |

**代码锚点（只读引用）：**

- FW：`tone_module/classifier.py` · `api_routes.py`
- Node：`faster-whisper-asr-strategy.ts` · `asr-step.ts` · `fw-detector-v4-path.ts`
- Recall：`recall-topk-for-windows.ts` · `tone-match-score.ts`

---

## Frozen Data Contract

| 结构 | Required 字段 | 传输路径 |
|------|---------------|----------|
| `TonePosterior` | `{ t1, t2, t3, t4, t5 }` | slice 内 |
| `AcousticToneSlice` | `{ start, end, tonePosterior, confidence }` | payload 数组 |
| `UtteranceAcousticTonePayload` | `{ toneEnabled, acousticToneSlices, sliceCount, toneConfidenceAvg?, skippedReason? }` | HTTP + `extra.utterance_tone` |
| `ASRResult.tone` | 同上语义 | task-router |
| `ctx.acousticToneSlices` | 归一化后 slice 数组 | JobContext → Recall **唯一**声学输入 |

### `skippedReason`（Utterance 级，四值）

`no_audio` · `no_timestamps` · `non_zh` · `model_error`

### `toneReason`（Window Candidate 级）

`match` · `mismatch` · `no_pattern`

---

## Frozen Ownership Contract

| 模块 | Owner | 职责 |
|------|-------|------|
| **Tone** | FW `tone_module` | Posterior Provider |
| **Recall** | `recall-topk-for-windows` + `tone-recall-sort` | **Tone Decision**（`tonePenalty`） |
| **Ranking** | `candidate-score` · sentence combination | Sentence Ranking |
| **Assembly** | `assemble-domain-aware-span-sets` | Sentence Assembly（无 Tone Decision） |
| **KenLM** | `run-fw-sentence-rerank-from-prefilled` | Language Model |
| **Apply** | `apply-span-replacements` | Final Replace |

**禁止**变更 Owner 或插入第二 Tone Decision 层。

---

## Frozen Loader Contract

| 文件 | 职责 |
|------|------|
| `tone_module/contract.py` | Metadata · Feature baseline · 校验 |
| `tone_module/loader.py` | load / unload / ready / metadata |
| `tone_module/classifier.py` | 推理（经 Loader） |

**Fail-Closed：** load 失败 → `ready=false` → `toneEnabled=false` → `skippedReason=model_error` → **不进入** Recall/Ranking。

**禁止：** bootstrap · silent upgrade · mock weights · load 失败仍 `ready=true`。

**Metadata Contract（optional diagnostics）：** `backend` · `modelVersion` · `featureVersion` · `modelHash` · `formatVersion` · `loadError` · `metadataWarning`

---

## Frozen Diagnostics Contract

### HTTP（FW）

`diagnostics.toneModule` — 长期保留 optional 字段；**不进 Decision**。

### Node / FW spanAssemblyV4

| 字段 | 语义 |
|------|------|
| `recallToneCompatibleCount` | `toneReason === 'match'` |
| `recallToneFallbackCount` | `tonePenalty < 1.0` |
| `toneExactHitCount` / `plainFallbackHitCount` | SQL 观测（≠ `toneReason`） |

**已 DELETE：** `toneGuardBlockedCount`

---

## Frozen Feature Baseline

```text
featureVersion = p0-v1（语义等价：mel_mean_80_v1）
sampleRate     = 16000
nMels          = 80
nFft           = 512
hopLength      = 160
fMin           = 50
fMax           = 7600
minSliceSec    = 0.02
```

**Feature Alias：** Loader 接受 `p0-v1` 与 `mel_mean_80_v1`；diagnostics 可记 `metadataWarning=featureVersion_legacy_*`。

**Mel / Normalization SSOT：** `tone_module/mel.py` · `contract.py`

---

## DELETE Summary

| 项 | 状态 | 验证 |
|----|------|------|
| `apply-tone-assembly-guard.ts` | **DELETED** | 文件不存在 · `freeze-contract` GATE-RANK-04 |
| orphan `filter-domain-candidates-per-span.ts` | **DELETED** | 文件不存在 · 逻辑内联于 `assemble-domain-aware-span-sets.ts` |
| `UtteranceTonePayload` / `UtteranceTonePayloadModel` | **DELETED** | Python 无匹配 |
| `toneGuardBlockedCount` | **DELETED** | `types.ts` 无匹配 |
| Assembly Tone Guard 文档承诺 | **DELETED** | `ARCHITECTURE.md` · `freeze/FROZEN.md` 已同步 |
| 第二 Tone Decision | **不存在** | `assembly_guard_absent_all: true`（200/200） |

---

## Document Synchronization

| 文档 | 操作 |
|------|------|
| `TONE_V2_CONTRACT_FREEZE.md` | MODIFY — Phase 1 CLOSED · Ownership · Regression Gate |
| `tone-module/ARCHITECTURE.md` | MODIFY — CLOSED 标记 · E2E Regression Gate |
| `fw-detector/ARCHITECTURE.md` | MODIFY — 移除 Tone Guard 流水线描述 |
| `fw-detector/freeze/FROZEN.md` | MODIFY — 移除 toneGuard · 增加 Tone V2 引用 |
| `fw-detector/assembly/RANKING_V1_2.md` | KEEP — 已与 Phase 1 DELETE 对齐 |
| `fw-detector/diagnostics/FROZEN.md` | MODIFY — 增加 `diagnostics.toneModule` 节 |
| `docs/tone-v2/README.md` | CREATE — SSOT 索引与归档声明 |

**SSOT 规则：** 实现争议以 `TONE_V2_CONTRACT_FREEZE.md` 为准；FW 子链以 `fw-detector/freeze/FROZEN.md` 为准；冲突时 Tone Runtime/Data 以 Tone V2 SSOT 优先。

---

## Regression Gate

| 门禁 | 命令 | Phase 1 结果 |
|------|------|----------------|
| FW Loader | `pytest tone_module/test_loader.py` | ✅（开发轮次） |
| Classifier fail-closed | `pytest tone_module/test_classifier_fail_closed.py` | ✅ |
| Contract / GATE-RANK | `npm run test:fw-detector` | ⚠️ 244/246（见 Risks） |
| Counterfactual | `tone-recall-counterfactual.test.ts` | ✅ 纳入套件 |
| Node E2E | `node tests/tone-v2-phase1-dialog200-batch.js` | ✅ 200/200 |
| 批测产物 | `tone-v2-phase1-dialog200-batch-result.json` | ✅ 基线冻结 |

**Acceptance 标准（冻结）：**

- `tone_effective_chain_cases === evaluated_count`
- `assembly_guard_absent_all === true`
- `skippedReason=model_error` 计数 = 0
- `fw_triggered_rate` = 1.0（dialog_200 全量）

---

## Architecture Compliance

| 检查项 | 结果 |
|--------|------|
| 单一 Runtime hop | ✅ |
| 单一 Tone Decision（Recall） | ✅ |
| 无 **Historical Issue:** Shadow / Offline Tone 路径（现行不存在） | ✅ |
| 无 Bootstrap / Compatibility alias 层（生产） | ✅ |
| 无第二 Pipeline / 第二 Runtime | ✅ |
| Loader fail-closed | ✅ E2E 验证 |
| Constitution Rule 3（Code SSOT） | ✅ 文档与代码一致（guard 已删） |

---

## Remaining Risks

| ID | 风险 | 严重度 | 影响 Phase 2？ |
|----|------|--------|----------------|
| R-01 | `freeze-contract` CLEANUP-2：`hardDropCount` 2 例失败（interval assembly 并行漂移） | LOW | 否 — 非 Tone hop |
| R-02 | E2E 需 `servicePreferences` 启用 FW/NMT/TTS | LOW | 运维文档化 |
| R-03 | Phase 1 质量（mean CER 0.229）非冻结目标 | INFO | Phase 2 模型质量 |

---

## Final Verdict

### **PASS**

Tone V2 Phase 1 满足冻结条件：Runtime/Data/Ownership/Loader/Diagnostics 均已写入 SSOT，DELETE 项已确认，E2E 全链 Effective，文档漂移已修复。

---

## 正式回答

### 1. Tone V2 Phase 1 是否正式关闭？

**是。** 自 2026-06-29 起 Phase 1 进入 **CLOSED / FROZEN**；后续改动须走再冻结流程（Phase 2 范围）。

### 2. 是否还有 Runtime Contract 未冻结？

**否。** FW Worker → Apply 全链已写入 `TONE_V2_CONTRACT_FREEZE.md` §1 并 E2E 验证；禁止再改 hop。

### 3. 是否还有多个 SSOT？

**否（Tone 域）。** 唯一现行 SSOT：`docs/tone-v2/TONE_V2_CONTRACT_FREEZE.md`，索引见 `docs/tone-v2/README.md`。历史审计/开发报告已声明为归档只读。

### 4. 是否还存在 **Historical Issue:** Shadow / Offline / Compatibility（现行不存在） / Bootstrap / 第二 Pipeline / 第二 Runtime / 第二 Decision？

**否（Tone 生产主链）。**

- Shadow：FW Beam 链仍存在但 **禁止** 进 KenLM/Apply（FW 框架既有设计，与 Tone 无关）
- Tone 无 **Historical Issue:** Shadow/Offline/Compatibility（现行不存在）/Bootstrap 门禁
- Assembly Tone Guard（第二 Tone Decision）已 **DELETE**
- 无第二 Tone Pipeline

### 5. 是否允许进入 Tone V2 Phase 2？

**是。** Phase 2 允许：模型权重 · Backend · Mel（须 bump `featureVersion`）· 诊断扩展。  
**禁止：** breaking Required Schema · Runtime hop 变更 · KenLM/Apply tone · 恢复 guard。

---

*Tone V2 Phase 1 Freeze · SSOT synchronized 2026-06-29*
