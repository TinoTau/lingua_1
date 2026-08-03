<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Test/Tone_V2_Phase1_Runtime_Test_Report_2026_06_29.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# Tone V2 Phase 1 — Runtime Test Report（dialog_200）

**日期：** 2026-06-29  
**语料：** `test wav/dialog_200`（200 条，Piper TTS 16kHz）  
**节点：** Electron Node test server `:5020` · FW Worker `:6007`  
**原始批测结果：** `electron_node/electron-node/tests/experiments/tone-v2-phase1-dialog200-batch-result.json`  
**FW 修复后抽样：** `docs/tone-v2/_audit_phase1_tokens_postfix.json`

---

## 1. 测试执行摘要

| 阶段 | 范围 | 耗时 | 结果 |
|------|------|------|------|
| **批测 A（修复前 Loader）** | dialog_200 全量 200 条 | 542s（≈9.0 min） | Pipeline 200/200 HTTP 200；**Tone/FW Effective 路径未生效** |
| **FW 直连接续验证（Loader 修复后）** | 随机 20 条 `/utterance` | ~56s | **20/20 toneEnabled=true** |
| **Node 端到端复测** | d003 单条 | — | **阻塞**：ASR 服务不可用（进程清理后旧 Node 实例未重启 FW 路由） |

---

## 2. 识别质量（批测 A — 200 条）

| 指标 | 值 |
|------|-----|
| 评估条数 | 200 |
| 精确匹配率 | **19.0%**（38/200） |
| 平均 CER | **0.248** |
| P50 CER | **0.211** |
| P95 CER | **0.500** |
| 异常点 | d150 CER=9.04（ASR 崩溃/空识别，单点 outlier） |

### 性能

| 指标 | P50 | P95 | Mean |
|------|-----|-----|------|
| 单条 case 墙钟（含 ASR+Pipeline） | 2.4s | 3.7s | 2.7s |
| pipeline_ms（extra） | 2.2s | 3.5s | — |

> 注：批测 A 期间 FW 步骤失败被吞掉（见 §4），CER 反映 **ASR 原始质量**，非 Tone 修复后 final 文本。

---

## 3. 测试结果抽样

### 3.1 批测 A（Tone 未生效时）

| ID | 期望（摘要） | ASR 输出（摘要） | CER | toneEnabled | FW spans |
|----|-------------|-----------------|-----|-------------|----------|
| d001 | 热拿铁·中杯·少糖 | 熱拿鐵**鐘貝**少糖… | 0.44 | false (model_error) | 0 |
| d003 | 燕麦拿铁·**少冰**·小杯 | 烟麦拿铁·**烧病**·小呗 | 0.21 | false | 0 |
| d012 | 检查报告·过敏发痒 | （精确匹配） | 0.00 | false | 0 |
| d048 | 咖啡场景 | … | 0.05 | false | 0 |
| d150 | — | 严重 ASR 失败 | 9.04 | false | 0 |

### 3.2 FW 修复后（Loader 接受 `mel_mean_80_v1`）

| ID | toneEnabled | sliceCount | tone_inference_ms | toneConfidenceAvg |
|----|-------------|------------|-------------------|-------------------|
| d164 | true | 17 | 15 | 0.727 |
| d003（类）d060 | true | 22 | 14 | 0.694 |
| 20 样本合计 | **20/20** | — | 9–15 ms | 0.69–0.73 |

---

## 4. Frozen Architecture Verification

### 4.1 Decision Path Matrix（本轮涉及）

| 功能 | 存在 | 批测 A 生效 | 修复后 FW 生效 | 决策位置 | 最终影响 |
|------|------|------------|---------------|----------|----------|
| Loader fail-closed | ✅ | ✅（误拒模型→model_error） | ✅（正确加载） | `tone_module/loader.py` | HTTP `skippedReason` / `toneEnabled` |
| `run_tone_inference` | ✅ | ❌（classifier not ready） | ✅ | FW `api_routes.py` | `UtteranceResponse.tone` |
| `ctx.acousticToneSlices` | ✅ 代码 | ❌（无 slices） | ⚠️ 未端到端复测 | `asr-step.ts` | Recall 输入 |
| Recall `tonePenalty` | ✅ 单测 | ❌（FW 步骤失败） | ⚠️ | `recall-topk-for-windows.ts` | candidateScore |
| Assembly Tone Guard | ❌ 已 DELETE | ✅ 未出现 | ✅ | — | — |
| KenLM/Apply tone-free | ✅ | ✅（无 tone 参数） | ✅ | rerank/apply | — |

### 4.2 根因分析（批测 A 失效）

| ID | Expected | Actual | Impact | Severity | 建议 |
|----|----------|--------|--------|----------|------|
| **R-01** | P0 npz 可加载；`featureVersion` 兼容 | Loader 仅接受 `p0-v1`；生产 npz 为 `mel_mean_80_v1` → **model_error** | 全链 Tone 静默失效 | **CRITICAL** | **MODIFY** Loader：`P0_COMPATIBLE_FEATURE_VERSIONS`（**已修**） |
| **R-02** | V4 orchestrator schema gate 通过 | 导入 `LEXICON_V3_FIVE_TABLE_RUNTIME_SCHEMA_VERSION`（undefined）→ FW 步骤抛错被吞 | Recall/Ranking/Assembly 未运行；`extra.fw_detector` 缺失 | **CRITICAL** | **MODIFY** 改为 `LEXICON_V3_FIVE_TABLE_V2_RUNTIME_SCHEMA_VERSION`（**已修 TS**；dist 需完整 rebuild） |
| **R-03** | 端到端可复测 | 进程清理后旧 Node 实例 ASR 路由失效 | 修复后未能重跑 Node E2E | **MEDIUM** | **KEEP** 流程：清理后须重启 Node |

### 4.3 Exists vs Effective

```text
批测 A：
  utterance_tone.toneEnabled = false, skippedReason = model_error  → Tone Exists 但 NOT Effective
  extra.fw_detector = absent, span_count = 0                       → Recall/Ranking NOT Effective

Loader 修复 + FW 直调（20 样本）：
  toneEnabled = true, sliceCount > 0, tone_inference_ms ≈ 9–15ms  → Runtime hop 前段 Effective

单元 / 门禁：
  tone-recall-counterfactual.test.ts                              → toneTimestampOnlyEnabled 反事实 PASS
  GATE-RANK-04                                                    → guard 不存在 PASS
```

### 4.4 反事实验证

| 反事实 | 方法 | 预期退化 | 实测 |
|--------|------|----------|------|
| Loader 拒绝模型 | 修复前 FW `/utterance` | toneEnabled=false, model_error | ✅ 20/20 model_error |
| Loader 接受模型 | 修复后 FW `/utterance` | toneEnabled=true, slices>0 | ✅ 20/20 enabled |
| `toneTimestampOnlyEnabled=false` | Jest `tone-recall-counterfactual.test.ts` | toneEnabled=false, penalty=1.0 | ✅ PASS |
| Assembly Tone Guard | GATE-RANK-04 静态 + 文件 DELETE | guard 不存在 | ✅ PASS |
| 禁用桶优先级（Ranking） | `ranking-repair-counterfactual.mjs`（历史） | 少冰→烧饼退化 | 文档/脚本级（需 dist 完整 rebuild 后重跑） |

---

## 5. Architecture Compliance 评估

| 维度 | 判定 | 说明 |
|------|------|------|
| **Contract Schema** | ✅ PASS | Required payload 未破坏；skippedReason 四值正确 |
| **Runtime Hop（设计）** | ✅ PASS | FW→tone→HTTP→Node 代码路径未改 |
| **Loader Foundation** | ⚠️ **CONDITIONAL** | 实现完成；初版 feature 校验过严导致生产 npz 被拒（**已 MODIFY**） |
| **Tone Effective（E2E）** | ❌ **FAIL（批测 A）** | model_error + FW orchestrator 崩溃 → 决策链未到达 Recall |
| **Tone Effective（FW 层）** | ✅ PASS（修复后） | 20/20 声学 slice 产出 |
| **DELETE guard/orphan** | ✅ PASS | 无 `applyToneAssemblyGuard`；无 `toneGuardBlockedCount` |
| **无第二 Tone Decision** | ✅ PASS | Assembly 无 tone guard |
| **KenLM/Apply tone-free** | ✅ PASS | 静态 + 批测无 tone 字段 |

**总评：** 本轮 Phase 1 **代码与冻结架构方向一致**，但 **首次 runtime 批测未通过 Architecture Compliance**——原因是指 Phase 1 新 Loader 与既有 orchestrator 导入错误，而非冻结设计本身。Loader 兼容修复后，**FW 层已恢复 Effective**；**Node→Recall 全链 Effective** 须在 dist 完整 rebuild + Node 重启后复验。

---

## 6. 后续必做（Regression Gate）

1. 完整 `npm run build:main`（修复既有 TS 编译错误：`build-sentence-candidates.ts` 等）
2. 清理进程 → 单实例启动 Node → 重跑 `tone-v2-phase1-dialog200-batch.js --limit 30`
3. 确认 `extra.fw_detector.triggered=true` 且 `spanAssemblyV4.tone.recallToneCompatibleCount > 0`
4. 将 `mel_mean_80_v1` 别名写入 `TONE_V2_CONTRACT_FREEZE.md` §Feature Baseline

---

## 7. 产物索引

| 文件 | 说明 |
|------|------|
| `tone-v2-phase1-dialog200-batch-result.json` | 200 条批测原始数据 |
| `_audit_phase1_tokens.json` | 修复前 FW 20 样本（全 model_error） |
| `_audit_phase1_tokens_postfix.json` | 修复后 FW 20 样本（全 enabled） |
| `Tone_V2_Phase1_Development_Report_2026_06_29.md` | 开发变更报告 |
