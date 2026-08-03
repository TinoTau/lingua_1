<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase2_Node_E2E_Test_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 Phase 2 — Node E2E Test Report

**Date:** 2026-06-29  
**Scope:** Phase 2 Restart 实装后 Node E2E 验收（dialog_200 时间封顶）  
**Corpus:** `D:\Programs\github\lingua_1\test wav\dialog_200`  
**Batch artifact:** `electron_node/electron-node/tests/experiments/tone-v2-phase2-dialog200-batch-result.json`  
**执行约束：** [Addendum](./Tone%20V2%20Phase%202%20Restart%20Supplement%20Addendum.md) · [Development Report](./Tone_V2_Phase2_Development_Report.md)

---

## 1. Executive Summary

在进程清理、`build:main`、Electron Node（5020）+ FW Worker（6007 `utterance_ready=true`）就绪后，执行 **15 分钟封顶** dialog_200 批测。

| 指标 | 结果 |
|------|------|
| 评估条数 | **131 / 200**（`time_limit_reached=true`，902s） |
| HTTP 错误 | **0** |
| `model_error` | **0** |
| `tone_effective_chain` | **131 / 131（100%）** |
| `assembly_guard_absent_all` | **true** |
| FW 触发率 | **100%**（131/131 `fw_triggered=true`） |
| Recall tone 活跃 | **131/131** `toneEnabled=true` |

**Tone 链路验收：PASS**（已测子集内全量 effective_chain，无 model_error，无 guard 复活）

**全量 200 条：** 未在本轮 15 分钟内完成；按 Phase 1 全量基线与本轮 131/131 一致性，**无架构回归信号**。

---

## 2. 测试环境

| 组件 | 状态 |
|------|------|
| Electron Node | `npx electron .`，Test Server `http://127.0.0.1:5020/health` → ok |
| FW `faster-whisper-vad` | `http://127.0.0.1:6007/health` → `utterance_ready: true` |
| `PROJECT_ROOT` | `D:\Programs\github\lingua_1` |
| Session | `tone-v2-phase1-d200-v1`（批测脚本沿用） |
| 批测命令 | `node tests/tone-v2-phase1-dialog200-batch.js --max-minutes 15` |

**说明：** `start_electron_node.ps1` 因 PowerShell 将 `npm warn` 视为终止错误而失败；改用 `npx electron .` 直接启动成功。

---

## 3. 质量与性能数据

### 3.1 质量（ASR / FW）

| 指标 | 值 |
|------|-----|
| exact_match_rate | 13.7%（18/131） |
| mean_cer | 0.220 |
| p50_cer | 0.214 |
| p95_cer | 0.500 |
| fw_applied_total | 76 |
| recall_tone_compatible_total | 350 |
| recall_tone_fallback_total | **5511** |

### 3.2 延迟（ms）

| 指标 | p50 | p95 | mean |
|------|-----|-----|------|
| pipeline_ms | 6131 | 11213 | 6883 |
| fw_detector_step_ms | 1274 | 1554 | — |
| case_elapsed_ms | 6136 | 11218 | 6888 |

首条 d001 含冷启动：`pipeline_ms=24600`；后续稳定在 ~5–11s/条。

### 3.3 Tone 专项

| 指标 | 值 |
|------|-----|
| `asr_payload.toneEnabled=true` | 131/131 |
| `recall.toneEnabled=true` | 131/131 |
| `skippedReason=model_error` | **0** |
| `effective_chain=true` | **131/131** |
| `assembly_guard_absent` | 131/131 true |

---

## 4. 测试结果抽样

| id | cer | fw | tone recall fallback | effective_chain | pipeline_ms | 备注 |
|----|-----|----|--------------------|-----------------|-------------|------|
| d001 | 0.444 | ✅ | 20 | ✅ | 24600 | 冷启动；sliceCount=12 |
| d002 | 0.059 | ✅ | 含 compatible=5 | ✅ | 9053 | recall 双路径均活跃 |
| d113 | 0.000 | ✅ | 34 | ✅ | 5763 | exact CER 命中 |
| d101 | 0.857 | ✅ | 43 | ✅ | 9046 | 高 CER 但 tone 链仍有效 |
| d131 | 0.500 | ✅ | 43 | ✅ | 5541 | 时间封顶前最后一条 |

**单条探针（d001）：** `utterance_tone.toneEnabled=true`，`sliceCount=12`；FW `recallToneFallbackCount=20`，`ngramTonePatternHitCount=52`，`tonePayloadAvailable=true`。

---

## 5. Frozen Architecture Verification

### 5.1 Runtime Hop（KEEP）

```text
FW perform_asr → run_tone_inference (pre-dedup)
→ Node asr-step → fw-detector-v4-path
→ Recall (tonePenalty / tone fallback)
→ Ranking → Assembly (tone-free) → KenLM → Apply
```

**E2E 证据：** 131/131 `fw_triggered=true`；`sentence_rerank.combinationCount>0`；无 `toneGuardBlockedCount`；无第二声学 Pipeline。

### 5.2 Exists vs Effective Matrix

| 功能 | 输入 | 输出 | 决策位置 | 影响路径 | Exists | Effective | 被覆盖？ |
|------|------|------|----------|----------|--------|-----------|----------|
| Feature SSOT (`contract→mel`) | audio slice | mel[80] | —（特征层） | → adapter | ✅ | ✅ | 否 |
| `numpy_p0.infer_batch` | mel_batch | posterior[N,5] | —（推理层） | → `acousticToneSlices` | ✅ | ✅ 131/131 toneEnabled | 否 |
| Loader `load(None)` | `TONE_MODEL_PATH` | weights ready | — | fail-closed | ✅ | ✅ 0 model_error | 否 |
| FW `run_tone_inference` | processed_audio + timestamps | `UtteranceAcousticTonePayload` | — | Node ctx | ✅ | ✅ sliceCount>0 | 否 |
| Recall tone | `acousticToneSlices` | SQL fallback/compatible | **Recall** | candidate 集 | ✅ | ✅ fallback 5511 累计 | 否 |
| Ranking | candidates | picked sentence | Ranking | 句级选择 | ✅ | ✅ combinationCount>0 | 否 |
| Assembly | spans | applied patches | Assembly | text 输出 | ✅ | ✅ tone-free | N/A |
| Registry/Switching | — | — | — | — | ❌ | ❌ | — |

### 5.3 反事实验证

| 反事实 | 方法 | 预期退化 | 结果 |
|--------|------|----------|------|
| Recall tone 关闭 | Jest `tone-recall-counterfactual.test.ts`：`toneTimestampOnlyEnabled=false` | tone effective path 无 penalty | **PASS**（2/2） |
| 模型 fail-closed | 批测观测 `skippedReason=model_error` | toneEnabled=false，链断裂 | **0 条**（Loader+adapter 正常） |
| Assembly Guard | 批测 `assembly_guard_absent_all` | guard 计数出现 | **全 true**（guard 未复活） |

**说明：** Phase 2 变更为等价 refactor，未改 Recall 权重；反事实以 **Recall 门控** + **model_error 零出现** 证明 tone 决策仍经主链生效，而非“代码存在但不参与决策”。

### 5.4 Phase 2 新增项验证

| 项 | 设计预期 | E2E 观测 | 判定 |
|----|----------|----------|------|
| Backend 不承担 Feature | mel 在 `mel.py` | 131/131 有 slice | ✅ |
| 无 Registry | 禁止 | 代码扫描 + 运行无切换 | ✅ |
| Legacy featureVersion | 兼容加载 | 0 model_error | ✅ |
| `loadMs`/`backendAdapter` diagnostics | FW optional | Node 批测未透传 FW diagnostics 子字段；**非 Required Schema** | ⚠️ 观测缺口（LOW） |

---

## 6. Drift / 不一致项

| ID | Expected | Actual | Impact | Severity | 建议 |
|----|----------|--------|--------|----------|------|
| D-E2E-01 | 15min 内尽可能多测 | 131/200，封顶退出 | 全量未闭合 | LOW | **KEEP** 门禁：延长跑满 200 |
| D-E2E-02 | Phase 2 diagnostics 可观测 | Node `extra` 未含 `loadMs` | 运维观测不完整 | LOW | **MODIFY**（可选）批测脚本透传 `diagnostics.toneModule` |
| D-JEST-01 | freeze-contract 全绿 | CLEANUP-2 `hardDropCount` 失败 | 非 Tone | MEDIUM | **MODIFY** 并行（span-assembly） |
| D-OPS-01 | `start_electron_node.ps1` 一键启动 | npm warn 触发 PS 终止 | 本地运维 | LOW | **MODIFY** 脚本 ErrorAction |

**无 Tone 架构漂移、无决策权迁移、无 Guard 复活、无 Registry。**

---

## 7. Architecture Compliance

| 准则 | 评估 |
|------|------|
| Single Service / Single Model | ✅ 单 FW 实例、单 TONE_MODEL_PATH |
| Runtime Hop 未变 | ✅ |
| Decision Ownership（Recall only） | ✅ fallback/compatible 累计非零 |
| Required Schema 未变 | ✅ |
| effective_chain 子集全 PASS | ✅ 131/131 |
| 新增 adapter 参与主链 | ✅ 非死代码 |

**Architecture Compliance：PASS**（在 131 条 E2E 子集 + 反事实 Jest 范围内）

**整体 Final Verdict：PASS（Tone 链路）** — 建议补跑剩余 69 条以闭合全量 200 门禁。

---

## 8. Regression 摘要

| Gate | 结果 |
|------|------|
| Python `test_phase2_contracts` 等 | 18/18 PASS（开发阶段） |
| Jest `tone-recall-counterfactual` | 2/2 PASS |
| dialog_200 E2E（15min） | 131/131 effective_chain，0 model_error |
| `freeze-contract` CLEANUP-2 | FAIL（pre-existing，非 Tone） |
