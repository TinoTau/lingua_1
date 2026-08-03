<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Test/Tone_V2_Phase3_Node_E2E_Test_Report_2026_06_29.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# Tone V2 Phase 3 — Node E2E Test Report

**Date:** 2026-06-29  
**Constraint SSOT:** [Tone V2 Phase 3 — Supplement Addendum II](./Tone%20V2%20Phase%203%20%E2%80%94%20Supplement%20Addendum%20II.md)  
**Artifact:** `electron_node/electron-node/tests/experiments/tone-v2-phase3-dialog200-batch-result.json`  
**Batch script:** `electron_node/electron-node/tests/tone-v2-phase3-dialog200-batch.js`  
**Verdict:** **CONDITIONAL PASS**（Runtime 冻结链路成立；190/190 有效样本 `effective_chain`；10 条 ASR 冷启动失败为环境噪声，非架构问题）

---

## 1. 测试环境

| 项 | 值 |
|----|-----|
| 节点端口 | 5020 |
| 语料 | `test wav/dialog_200`（manifest 200 条） |
| 时间上限 | 15 min（实际 717s ≈ 12 min 跑完全部可执行用例） |
| Session | `tone-v2-phase3-d200-v1` |
| 前置 | 进程清理 → `npm run build:main` → `start_electron_node.ps1` |
| Python 回归 | 29/29 unittest PASS（含 Phase 3 四项 Gate） |
| Runtime 反事实审计 | `python -m tone_module.audit_runtime_acceptance` PASS |

---

## 2. 汇总指标

### 2.1 执行统计

| 指标 | Phase 3 本轮 | Phase 2 基线（参考） |
|------|-------------|---------------------|
| 评估成功条数 | **190** | 131（15min 内） |
| 失败/跳过 | 10（d001–d010，`No available ASR service`） | 0 |
| `tone_effective_chain` | **190 / 190（100%）** | 131 / 131（100%） |
| `model_error` | **0** | 0（未显式统计） |
| `assembly_guard_absent_all` | **true** | true |
| `fw_triggered_rate` | 1.0 | 1.0 |
| `fw_applied_total` | 0 | 76 |

### 2.2 识别质量（观测，非 Runtime Contract）

| 指标 | 值 |
|------|-----|
| `exact_match_rate` | 12.6% |
| `mean_cer` | 0.283 |
| `p50_cer` | 0.217 |
| `p95_cer` | 0.529 |

> CER 仅作模型/ASR 质量观测（Addendum II §7）；不构成冻结契约。

### 2.3 性能

| 指标 | Phase 3 p50 | Phase 3 p95 | Phase 3 mean | Phase 2 p50（参考） |
|------|------------|------------|-------------|-------------------|
| `pipeline_ms` | 3383 | 6392 | 3728 | 6131 |
| `fw_step_ms` | 982 | 1239 | — | 1274 |
| `case_ms` | 3387 | 6397 | 3733 | 6136 |

### 2.4 Tone 召回统计（Decision 输入侧）

| 指标 | 值 |
|------|-----|
| `tone_enabled_cases` | 190 |
| `tone_recall_active` | 190 |
| `recall_tone_compatible_total` | 516 |
| `recall_tone_fallback_total` | 8108 |

---

## 3. 抽样（12 条，见 result `samples`）

| ID | CER | effective_chain | toneEnabled(ASR) | recallFallback | fw_applied | pipeline_ms |
|----|-----|-----------------|-------------------|----------------|------------|---------------|
| d011 | 0.190 | ✓ | true | 43 | 0 | 21470 |
| d012 | 0.000 | ✓ | true | 41 | 0 | 9428 |
| d013 | 0.000 | ✓ | true | — | 0 | 3091 |
| d057 | 0.000 | ✓ | true | — | 0 | 3345 |
| d068 | 0.000 | ✓ | true | — | 0 | 3984 |
| d096 | — | ✓ | true | — | 0 | — |
| d120 | — | ✓ | true | — | 0 | — |
| d150 | — | ✓ | true | — | 0 | — |
| d180 | — | ✓ | true | — | 0 | — |
| d198 | 0.000 | ✓ | true | — | 0 | 2271 |
| d199 | 0.105 | ✓ | true | — | 0 | 3989 |
| d200 | 0.233 | ✓ | true | — | 0 | 3261 |

典型有效链路样例（d011）：

```json
"tone": {
  "asr_payload": { "toneEnabled": true, "sliceCount": 19, "model_error": false },
  "recall": {
    "toneEnabled": true,
    "recallToneCompatibleCount": 6,
    "recallToneFallbackCount": 43,
    "ngramTonePatternHitCount": 53
  },
  "effective_chain": true
}
```

---

## 4. 环境异常（非架构漂移）

| ID | Expected | Actual | Impact | Severity | 建议 |
|----|----------|--------|--------|----------|------|
| ASR 冷启动 | 节点就绪后首批用例可 ASR | d001–d010 `No available ASR service` | 10 条未进入 Tone 链路 | **LOW** | **KEEP** 架构；测试脚本增加 `waitHealth` + ASR ready probe 或跳过首批重试 |

---

## 5. Frozen Architecture Verification

### 5.1 冻结运行链路（未因 Phase 3 改变）

```text
FW/ASR → run_tone_inference → UtteranceResponse.tone → ctx.acousticToneSlices → Recall → Ranking → Assembly → KenLM → Apply
```

| 检查项 | 存在 | 生效 | 证据 |
|--------|------|------|------|
| Tone ASR 推理 | ✓ | ✓ | 190 条 `asr_payload.toneEnabled=true`，`model_error=0` |
| acousticToneSlices 进入 Recall | ✓ | ✓ | 190 条 `recall.toneEnabled=true`，`recallToneFallbackCount>0` |
| Recall 拥有 Tone 决策 | ✓ | ✓ | `recallToneCompatibleCount` / `ngramTonePatternHitCount` 非零；Assembly 无 tone guard |
| Assembly tone guard 缺席 | ✓ | ✓ | `assembly_guard_absent_all=true` |
| Single Service / Single Model | ✓ | ✓ | Phase 2 扫描 + 本轮无 loader/runtime 改动 |
| `confidence` 不进 penalty | ✓ | ✓ | 无本轮改动；Recall 契约未变 |

### 5.2 Phase 3 新增逻辑 — 责任边界与生效性

| 功能 | 设计定位 | 进入 Runtime Decision？ | 存在 | 生效 | 反事实验证 |
|------|----------|------------------------|------|------|-----------|
| `train_tone_cnn` contract 对齐 | Training SSOT | **否** | ✓ | ✓（源码 + unittest） | 移除 contract 引用 → Feature Parity 测试失败 |
| Artifact metadata 写入 | Training Artifact | **否** | ✓ | ✓（save 逻辑） | 未重训；当前 Runtime 仍用既有 npz |
| `validate_artifact` | 离线 Acceptance Gate | **否** | ✓ | ✓（train 后强制调用） | 缺 w1 → schema fail；`audit_runtime_acceptance` model_error 用例 |
| `offline_tone_eval` | 离线 posterior 分析 | **否** | ✓ | ✓（infer_batch only） | production runtime 无 import；Isolation 测试 PASS |
| `artifactHash` diagnostics 别名 | Runtime Diagnostics 命名 | 仅观测 | ✓ | ✓（loader 设 hash → diagnostics） | 不影响 Recall 排序 |
| `test_phase3_contracts` | Regression Gate | N/A | ✓ | ✓ | 29/29 PASS |

**结论：** Phase 3 新增模块按设计**刻意不进入** Runtime Decision；E2E 验证的是 **Phase 2 Runtime 未被破坏**，而非 Offline 模块参与在线决策。

### 5.3 反事实验证（Runtime 核心链路）

| 场景 | 操作 | 预期退化 | 实测 |
|------|------|----------|------|
| 模型缺失 | `ToneModelLoader.load(missing)` | `ready=false` → inference `model_error` | `audit_runtime_acceptance`: `model_error_missing` ready=false |
| 权重损坏 | corrupt npz | load fail-closed | `model_error_corrupt` |
| 缺 required key | 仅 w1 的 npz | loader 拒绝 | `model_error_invalid_format` + ArtifactValidationTest |
| 正常默认权重 | `load(valid)` | ready=true，Tone 启用 | E2E 190 条 toneEnabled + effective_chain |
| 无音频 | 空输入 | `skippedReason=no_audio` | audit: `no_audio_direct` toneEnabled=false |

> E2E 无法在不停服情况下做在线 A/B「关闭 Tone」对比；Recall 侧反事实由 Phase 1/2 冻结审计 + `audit_runtime_acceptance` 覆盖。

### 5.4 漂移 / 死代码 / 旁路检查

| 检查 | 结果 |
|------|------|
| Registry / hot_reload / model_switch | 未发现（Phase 2 DeploymentBoundary 仍 PASS） |
| `validate_artifact` / `offline_tone_eval` 被 production import | 未发现 |
| `audit_tone_reliability.py` 0.75/0.45 进入 Gate | 未接入（**KEEP** 人工工具） |
| `validationResult` 写入 Artifact | 不存在（**DELETE** 概念已落实） |
| Assembly tone guard 复活 | 未出现 |
| Offline Evaluation 进入 Ranking/Penalty | 无代码路径 |

---

## 6. Drift Matrix（本轮相关）

| 区域 | Expected | Actual | Impact | Severity | 处置 |
|------|----------|--------|--------|----------|------|
| Runtime 链路 | 不变 | 不变 | 无 | — | **KEEP** |
| Training SSOT | contract.py | train 已引用 | 消除硬编码 | — | **KEEP**（已完成） |
| Artifact Acceptance | infer_batch 门禁 | validate_artifact 实现 | 训练发布安全 | — | **KEEP** |
| Diagnostics `artifactHash` | Addendum II 命名 | 与 modelHash 双写 | 文档对齐 | LOW | **KEEP** |
| ASR 冷启动 | 首批可跑 | d001–d010 失败 | 测试覆盖缺口 | LOW | **MODIFY** 测试脚本预热（非架构） |
| 全量重训 + 新 Artifact 部署 | Addendum II §7 | 本轮未执行 | Model Quality 证据不完整 | MED | 后续 **MODIFY** 运维流程补证 |

---

## 7. Architecture Compliance 评估

| 维度 | 评估 |
|------|------|
| **冻结架构符合性** | **PASS** — Runtime / Decision / Loader / Backend 未改；主链路 190/190 effective |
| **Phase 3 离线能力** | **PASS** — Training / Validation / Offline Eval 按 Addendum II 落地且隔离 |
| **Model Quality Acceptance** | **PARTIAL** — Offline Eval 模块就绪但未重训；E2E 无模型回归劣化信号（effective_chain 100%，model_error 0） |
| **测试完整性** | **CONDITIONAL PASS** — 10 条 ASR 冷启动失败需测试脚本改进 |

**总评：** 本轮开发**符合冻结架构**；功能测试与架构验证均支持「Phase 3 改训练/校验、不改 Runtime」的设计目标。完整 Model Quality Acceptance 待重训 + 新权重部署后补一轮 E2E。

---

## 8. 复现命令

```powershell
cd D:\Programs\github\lingua_1
.\scripts\cleanup_orphaned_processes_simple.ps1
cd electron_node\electron-node
npm run build:main
cd D:\Programs\github\lingua_1
.\scripts\start_electron_node.ps1
# 等待 Test server :5020 与 ASR 就绪后：
cd electron_node\electron-node
$env:PROJECT_ROOT='D:\Programs\github\lingua_1'
node tests/tone-v2-phase3-dialog200-batch.js --max-minutes 15

cd electron_node\services\faster_whisper_vad
python -m unittest tone_module.test_loader tone_module.test_classifier_fail_closed tone_module.test_phase2_contracts tone_module.test_phase3_contracts
python -m tone_module.audit_runtime_acceptance
```
