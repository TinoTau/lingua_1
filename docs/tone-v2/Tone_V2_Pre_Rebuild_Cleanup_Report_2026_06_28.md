# Tone V2 Pre-Rebuild Cleanup Report

**日期**：2026-06-28  
**阶段**：Tone V2 开发前清理（非 V2 模型开发）  
**SSOT**：当前仓库代码变更 + 回归执行结果  

---

## Executive Summary

本阶段完成 P0 遗留风险清理：移除 `ToneClassifier` bootstrap fallback、删除 Node 侧 `tonePayload` / KenLM `tone` 死参数、冻结 Tone payload 契约与 Runtime 边界，并补充 fail-closed 单测与冻结合约门禁。

| 项 | 结果 |
|----|------|
| Bootstrap 移除 | ✅ 完成 |
| Fail-closed 加载 | ✅ 完成 + 单测 |
| 死参数清理 | ✅ 完成 |
| 契约 / 边界冻结 | ✅ 文档 + 冻结合约 |
| Architecture Drift | ✅ 无 tone-v2 脚本/路径残留 |
| 最终裁决 | **CONDITIONAL PASS** |

**条件**：FW Worker 未在本机运行，`d001-timestamp-tone-probe.mjs` 与 HTTP `non_zh` 验收未执行；`npm run build:main` 存在与本次清理无关的既有 TS 错误（见 Regression Result）。

---

## Removed Items

### 2.1 Bootstrap Fallback（DELETE / MODIFY）

**文件**：`electron_node/services/faster_whisper_vad/tone_module/classifier.py`

| 删除项 | 说明 |
|--------|------|
| `_bootstrap_weights()` | 随机权重生成 |
| silent fallback 分支 | 模型缺失时不再 `ready=true` |
| fake ready 路径 | 加载失败时 `_clear_weights()`，`ready=false` |

**新行为**：

```text
model missing / corrupt / invalid format / load exception
  → ready=false
  → run_tone_inference → tone_enabled=false, skippedReason=model_error
```

**新增**：`tone_module/test_classifier_fail_closed.py`（missing / corrupt / invalid / valid 四类）

### 2.2 `tonePayload` 死参数（DELETE）

| 文件 | 变更 |
|------|------|
| `span-assembly-v4/span-assembly-v4-orchestrator.ts` | 移除 `tonePayload?` 输入字段 |
| `fw-detector-v4-path.ts` | 移除 `tonePayload: ctx.asrResult?.tone` 传参 |

声学 Tone 唯一 Node 入口仍为 **`ctx.acousticToneSlices`**（来自 `asr-step`）。

### 2.3 KenLM `tone` 死参数（DELETE）

| 文件 | 变更 |
|------|------|
| `kenlm/run-fw-sentence-rerank-from-prefilled.ts` | 移除 `tone?` 及 `UtteranceAcousticTonePayload` import |
| `fw-detector-v4-path.ts` | 移除 `tone: ctx.asrResult?.tone` 传参 |

KenLM 层**不接** acoustic tone；决策链不变。

### 其他

| 项 | 动作 |
|----|------|
| `tone-stage.ts` 注释 | MODIFY — 标明与 acoustic tone 无关 |
| `docs/tone-module/ARCHITECTURE.md` | MODIFY — §11 契约冻结 + fail-closed |
| `audit_runtime_acceptance.py` | MODIFY — fail 段覆盖 model_error 四类；`--part fail` 不依赖 manifest |

---

## Contract Freeze

以下 **required schema** 未改动（V2 仅可提升 posterior 质量）：

| 结构 | 位置 |
|------|------|
| `TonePosterior` | `{ t1..t5 }` |
| `AcousticToneSlice` | `{ start, end, tonePosterior, confidence }` |
| `UtteranceAcousticTonePayload` | Python + Node task-router |
| `ASRResult.tone` | ASR HTTP → Node |
| `ctx.acousticToneSlices` | JobContext → Recall |

文档 SSOT：`docs/tone-module/ARCHITECTURE.md` §11

---

## Runtime Boundary Verification

```text
FW Worker (faster_whisper_vad)
  → run_tone_inference
  → UtteranceResponse.tone
  → Node ASR Step
  → ctx.acousticToneSlices
  → Recall (recallTopKForWindows)
  → Ranking (compatibility + tonePenalty)
  → Assembly
  → KenLM (无 tone 参数)
  → Apply
```

| 检查项 | 状态 |
|--------|------|
| Tone 仍在 FW Worker 内 | ✅ |
| 无独立 Tone Pipeline Step | ✅ |
| 无 Gateway / Scheduler Tone 路径 | ✅ |
| 无 Shadow Tone Runtime | ✅ |
| 无第二条 Assembly tone 入口 | ✅（`tonePayload` 已删） |

冻结合约：`freeze-contract.test.ts` → `TONE-PRE-V2-1` … `TONE-PRE-V2-4`

---

## Decision Ownership Verification

| 层 | Tone 角色 |
|----|-----------|
| Tone Module | 仅输出 `AcousticToneSlice` / `TonePosterior` |
| Recall | 消费 `acousticToneSlices` → pattern → `tone_exact` / penalty |
| Ranking | `computeToneScoreResult` × `candidateScore` |
| Assembly | 无 tone 决策 |
| KenLM | 无 tone 输入（已删死参数） |
| Apply | 无 tone |

Tone **不拥有**最终 Apply 决策。

---

## Exists vs Effective Matrix

| 能力 | 存在 | 已接线 | Runtime 参与 | 清理后 |
|------|------|--------|--------------|--------|
| `run_tone_inference` | ✅ | ✅ | ✅ | 不变 |
| Fail-closed classifier | ✅ | ✅ | ✅ | **新增** |
| Bootstrap fallback | ❌ | ❌ | ❌ | **已删** |
| HTTP `response.tone` | ✅ | ✅ | ✅ | 不变 |
| `ctx.acousticToneSlices` | ✅ | ✅ | ✅ | 不变 |
| `tonePayload` orchestrator 参数 | ❌ | — | — | **已删** |
| KenLM `tone` 参数 | ❌ | — | — | **已删** |
| Recall tone pattern | ✅ | ✅ | ✅ | 不变 |
| YourTTS `TONEStage` | ✅ | ✅ | TTS only | 已注释区分 |

---

## Regression Result

| 命令 | 结果 | 说明 |
|------|------|------|
| `python -m tone_module.test_classifier_fail_closed` | **PASS** | 4/4 |
| `python -m tone_module.audit_runtime_acceptance --part fail` | **PASS**（本地） | model_error 四类；FW HTTP 未起（`fwServiceUp: false`） |
| `jest tone-match / tone-time / span-assembly-v4-tone-score` | **PASS** | 11/11 |
| `jest freeze-contract -t TONE-PRE-V2` | **PASS** | 4/4 |
| `npm run test:fw-detector` | **PARTIAL** | 236 pass；`build-sentence-candidates.test.ts` 等失败（`rawOverlap` 导出问题，**非本次变更**） |
| `npm run build:main` | **FAIL** | 既有 TS 错误（`classify-overlap-relation` 等），**非本次变更** |
| `node tests/experiments/d001-timestamp-tone-probe.mjs` | **SKIP** | FW Worker `:6007` 未运行 |

---

## KEEP / MODIFY / RESTORE / DELETE

| 对象 | 动作 |
|------|------|
| P0 Runtime 主链（Worker → ASR → Recall → KenLM → Apply） | **KEEP** |
| `UtteranceAcousticTonePayload` 契约 | **KEEP** |
| `ctx.acousticToneSlices` → Recall | **KEEP** |
| `toneTimestampOnlyEnabled` | **KEEP** |
| `_bootstrap_weights` / silent fallback | **DELETE** |
| `tonePayload` orchestrator 参数 | **DELETE** |
| KenLM `tone` 参数 | **DELETE** |
| `ToneClassifier` 加载逻辑 | **MODIFY**（fail-closed） |
| `ARCHITECTURE.md` | **MODIFY**（§11 冻结） |
| `tone-stage.ts` 注释 | **MODIFY** |
| `audit_runtime_acceptance.py` fail 段 | **MODIFY** |
| `freeze-contract.test.ts` TONE-PRE-V2 | **MODIFY**（新增门禁） |
| Gateway / Scheduler / tone-v2 scripts | **DELETE（保持清零）** |
| 历史 V2 backend registry | **RESTORE 不适用** |

---

## Architecture Compliance

```text
Raw Audio
  → FW Word Timestamp
  → Tone Posterior (fail-closed if no valid model)
  → Recall
  → Ranking
  → Assembly
  → KenLM
  → Apply
```

**未出现**：

- Gateway / Scheduler Tone 参与  
- Standalone / Offline / Shadow Tone Runtime  
- Node 独立 Tone Pipeline Step  
- KenLM tone shadow path  

---

## P0 Checklist

- [x] 删除 bootstrap fallback  
- [x] 模型加载失败 fail-closed  
- [x] 删除 `tonePayload` 死参数  
- [x] 删除 KenLM `tone` 死参数  
- [x] 冻结 Tone payload contract（文档 §11）  
- [x] 确认 Gateway / Scheduler 无 Tone 残留  
- [x] 确认无 tone-v2 历史漂移脚本  

## P1 Checklist

- [x] 清理 dead import（KenLM rerank `UtteranceAcousticTonePayload`）  
- [x] 更新 P0 架构说明（ARCHITECTURE.md）  
- [x] 增加 fail-closed 单测（Python）  
- [x] 增加 Exists vs Effective trace（freeze-contract TONE-PRE-V2-3）  
- [x] 标注 YourTTS tone-stage 与 acoustic tone 无关  

---

## Final Verdict

### **CONDITIONAL PASS**

**通过理由**：

1. P0 清理项全部落地且核心 tone 单测 / 冻结合约通过。  
2. Runtime 边界与决策归属未变；死参数已移除。  
3. Architecture Drift 保持清零。  

**剩余条件（进入 Tone V2 开发前建议完成）**：

1. 启动 FW Worker 后补跑 `d001-timestamp-tone-probe.mjs` 与 `audit_runtime_acceptance --part all`。  
2. 仓库既有 `build:main` / `build-sentence-candidates` 问题与本次清理无关，但会影响全量 CI。  

---

## 下一步（Tone V2 Phase 1）

仅在本清理 **PASS** 后启动：

```text
V2 model loader
Fail-closed model contract（本阶段已建立 P0 基线）
Model metadata
Feature / backend design
```

**不得**直接进入 CRNN、公开模型或训练。

---

*报告对应当前仓库清理提交；回归命令以 `electron_node/electron-node/package.json` 与 `tone_module/` 为准。*
