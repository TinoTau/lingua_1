# Tone V2 可行性审计报告（Dialog200 语料复验）

**审计日期**：2026-06-28  
**语料版本**：`dialog_200` / `restored_minimal_v1`（1 case：d001）  
**事实来源**：当前仓库代码 + 恢复后 dialog_200 minimal 语料 + 本轮 Runtime 探针  
**前置报告**：[Zero Baseline Audit](Tone_V2_Zero_Baseline_Rebuild_Readiness_Audit_2026_06_23.md)、[Dialog200 Restore](Dialog200_Corpus_Restore_Report_2026_06_28.md)、[Pre-Phase1 Verification](Tone_V2_Pre_Phase1_Runtime_Verification_Report_2026_06_28.md)

---

## Executive Summary

| 维度 | 裁决 | 说明 |
|------|------|------|
| **架构可行性（Tone V2 Extension Point）** | **PASS** | P0 链路仍成立；冻结合约 TONE-PRE-V2 4/4；无 V2 历史漂移 |
| **Runtime 可行性（minimal dialog_200 corpus）** | **CONDITIONAL PASS** | d001 全链路探针通过；仅 1 条语料；文本–音频不对齐 |
| **统计 / 批量可行性（dialog_200 200 条）** | **FAIL（阻塞）** | d002–d200 缺失；无法做 P95/Recall 收益统计 |
| **进入 Tone V2 Phase 1 开发** | **CONDITIONAL PASS** | 可开 Phase 1（契约 / backend / fail-closed）；**不可**宣称 200-case 回归已就绪 |

**一句话**：基于恢复的 dialog_200 minimal corpus，**Tone V2 在现有 P0 架构上重新开发是可行的**；但 **200 条语料级可行性证据不足**，Phase 1 必须以 Runtime Validation（minimal corpus）+ Unit Test 为主，full corpus 恢复前不得做批量语义验收。

---

## 1. 审计范围与方法

### 1.1 语料

| 项 | 值 |
|----|-----|
| Manifest | `test wav/dialog_200/cases.manifest.json` |
| Version | `restored_minimal_v1` |
| `isFullCorpus` | `false` |
| 可用 wav | `dialog_d001.wav`（来源 `context_prior/cp_001_hotel_latte.wav`） |
| 参考文本 | 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？ |

### 1.2 验证矩阵（本轮执行）

| # | 验证项 | 命令 / 方式 | 结果 |
|---|--------|-------------|------|
| V1 | FW Worker 健康 | `GET :6007/health` | **PASS** |
| V2 | Node 测试服务 | `GET :5020/health` | **PASS** |
| V3 | FW 直连接入 d001 | `POST :6007/utterance` + `dialog_d001.wav` | **PASS** |
| V4 | P0 Runtime Audit（全段） | `python -m tone_module.audit_runtime_acceptance --part all` | **PASS**（重试后） |
| V5 | Node 全链路 d001 探针 | `node tests/experiments/d001-timestamp-tone-probe.mjs` | **PASS** |
| V6 | 冻结合约 | Jest `TONE-PRE-V2-1..4` | **PASS** 4/4 |
| V7 | Fail-closed 单测 | `python -m unittest tone_module.test_classifier_fail_closed` | **PASS** 4/4 |
| V8 | 200-case batch | `run-dialog200-timed-batch.mjs` | **未执行**（语料不足） |

### 1.3 环境说明

- FW Worker 须使用 `.venv\Scripts\python.exe faster_whisper_vad_service.py`（系统 Python 缺 GPU EP 时 VAD 失败）。
- Node 探针需 `servicePreferences.faster-whisper-vad: true`（本轮审计前曾为 `false`，已改回 `true` 后探针通过）。
- 首次 audit 出现 d001 **504 Gateway Timeout**（FW 繁忙/冷启动）；直连 POST 与重跑 audit 均 **PASS**——属 **transient**，非架构缺陷。

---

## 2. Dialog200 Runtime Validation 证据

### 2.1 FW Worker → Tone（d001）

**输入**：`test wav/dialog_200/dialog_d001.wav`

| 字段 | 实测值 |
|------|--------|
| HTTP | 200 |
| raw ASR | 幫我去 任酒店訂 單然後給 我來一個藍莓馬芬和重倍拿鐵 |
| `toneEnabled` | **true** |
| `sliceCount` | **22** |
| `toneConfidenceAvg` | **0.628** |
| `tone_inference_ms` | **10–11**（≤ 20ms 目标） |

**说明**：ASR 文本与 manifest 参考句不一致（音频来自 context_prior 酒店场景），**不影响** Tone posterior / timestamp 链路验证，但 **不能** 作为 ASR golden 或 Recall 语义收益基线。

### 2.2 Node 全链路（d001-timestamp-tone-probe）

**Trace**：`electron_node/electron-node/tests/experiments/d001-timestamp-tone-probe-trace.json`（2026-06-28T19:49:13Z）

| 检查项 | 结果 |
|--------|------|
| manifest / wav 读取 | **PASS** |
| `asr_service_id` | `faster-whisper-vad` |
| `utterance_tone.toneEnabled` | **true** |
| `utterance_tone.sliceCount` | **22** |
| `beiShao_hasWindowTimeRange` | **true** |
| `beiShao_hasAcousticTonePattern` | **true** |
| `beiShao_pattern` | `[2, 4]` |
| `peishao_in_span_candidates`（焙烧误召回） | **[]** |
| `zhongBeiShao_sentence_candidates` | **[]** |
| `pipeline_ms` | ~12078 |

**Exists vs Effective（探针层）**：

| 能力 | 存在 | 本轮 d001 生效 |
|------|------|----------------|
| FW HTTP `tone` | ✅ | ✅ |
| Node `ctx.acousticToneSlices` | ✅ | ✅ |
| Word timestamps → `buildWordTimeSpans` | ✅ | ✅（22 words） |
| Timestamp-only tone window（bei\|shao） | ✅ | ✅ |
| Recall tone incompatible 计数（diagnostics） | ⚠️ | `spanAssemblyV3_tone: {}`（V4 diagnostics 未开，探针用 local 分析兜底） |

---

## 3. Frozen Architecture Verification

### 3.1 决策链路（不变）

```text
FW Worker (Whisper + word TS)
  → run_tone_inference (tone_module)
  → HTTP UtteranceResponse.tone
  → Node asr-step → ctx.acousticToneSlices
  → FW Span Assembly V4
      → Recall (tone pattern / tone_exact)
      → Ranking (tonePenalty × candidateScore)
      → Assembly → KenLM → Apply
```

Tone V2 **仍应**作为 **FW Worker 内 Posterior Provider** 扩展，**不**引入 Gateway/Scheduler 旁路或 Node 独立 Tone Step。

### 3.2 冻结合约（TONE-PRE-V2）

| ID | 断言 | 结果 |
|----|------|------|
| TONE-PRE-V2-1 | 无 dead `tonePayload` on v4 orchestrator | **PASS** |
| TONE-PRE-V2-2 | KenLM prefilled rerank 无 acoustic tone 死参 | **PASS** |
| TONE-PRE-V2-3 | `acousticToneSlices` 接线至 Recall | **PASS**（静态 + d001 运行态） |
| TONE-PRE-V2-4 | 无历史 tone-v2 drift 脚本路径 | **PASS** |

### 3.3 Fail-Closed（V2 加载语义前置）

| 场景 | 结果 |
|------|------|
| missing model | `ready=false`, `model_not_found` |
| corrupt npz | load error |
| invalid format | `missing required weight key: w1` |
| valid `tone_cnn_p0.npz` | `ready=true`, inference 正常 |

Bootstrap fallback **已移除**——与 Tone V2「无静默降级」方向一致。

---

## 4. Tone V2 可行性矩阵

### 4.1 Reuse Matrix（可直接复用）

| 组件 | 路径 | Dataset Probe 验证 |
|------|------|------------|
| Posterior 推理入口 | `tone_module/inference.py::run_tone_inference` | ✅ d001 |
| HTTP 契约 | `UtteranceAcousticTonePayload` / `response.tone` | ✅ |
| Node 合并 | `asr-step.ts` offset merge | ✅ |
| 时间对齐 | `tone-time-align.ts` | ✅ d001 probe |
| Recall 消费 | `tone-recall.ts`, `tone-match-score.ts` | ✅ 静态 + 探针 window |
| SQL tier | `tone_exact` | ⚠️ 未在本轮 Runtime Validation 断言 SQL 命中 |
| P0 模型 | `tone_cnn_p0.npz` | ✅ |

### 4.2 Need New / Extension（V2 必做项）

| 项 | 状态 | 阻塞 Phase 1？ |
|----|------|----------------|
| V2 backend registry + manifest | 未实现 | **否**（Phase 1 目标） |
| V2 权重 / CRNN（Phase 1 禁止） | 未实现 | — |
| 字级 timestamp | 不存在 | **否**（后续 Phase） |
| KenLM × tone 联合 rerank | 参数未接 | **否** |
| dialog_200 full corpus | **缺失** | **是**（批量验收） |
| E2E V2 benchmark harness | 需新建 | **部分**（可用 d001 + audit 过渡） |

### 4.3 Drift Matrix

| 漂移项 | Expected | Actual | Severity |
|--------|----------|--------|----------|
| tone-v2 代码/文档残留 | 无 | 无 | — |
| bootstrap 静默降级 | 无 | 无（fail-closed） | — |
| tonePayload 死参 | 无 | 无 | — |
| KenLM tone 死参 | 无 | 无 | — |
| Gateway Tone harness | 无 | 无 | — |
| dialog_200 200 wav | 200 | **1** | **High**（统计验收） |

---

## 5. Exists vs Effective（综合）

| 能力 | 存在 | 接线 | d001 运行生效 | V2 可复用 |
|------|------|------|---------------|-----------|
| `run_tone_inference` | ✅ | ✅ | ✅ | ✅ |
| HTTP → Node slices | ✅ | ✅ | ✅ | ✅ |
| Timestamp-only gate | ✅ | ✅ | ✅ | ✅ |
| Recall tone pattern | ✅ | ✅ | ⚠️ 未量化（diagnostics 空） | ✅ |
| Ranking tonePenalty | ✅ | ✅ | ⚠️ minimal corpus 未扫全候选 | ✅ |
| KenLM tone 参数 | ❌ 未实现 | ❌ | ❌ | 待 Extension |
| V2 backend | ❌ | ❌ | ❌ | Phase 1 新建 |
| 200-case regression | ❌ 语料 | — | ❌ | 需 RESTORE corpus |

---

## 6. 风险与限制

1. **语料代表性**：minimal d001 音频≠manifest 文本；Recall 同音字窗口（中杯/少糖/钟贝/焙烧）的 **语义收益无法在本轮量化**。
2. **批量缺口**：无 d002–d200 → 无法复现历史 `tone-module-p1-dialog-fw-scan.json` 200 条扫描统计。
3. **配置脆弱性**：`faster-whisper-vad: false` 时 Node 全链路 **503**；属运维/config 问题，非 Tone 架构问题，但会 **误判** 为 Tone 失效。
4. **FW 冷启动 / 504**：health=200 不保证 utterance 就绪；验收脚本应含 warmup 或重试。
5. **Phase 1 边界**：仍 **禁止** CRNN、公开模型、训练、模型选型；本轮仅证明 **P0 基线 + Extension Point** 可承载 V2 契约开发。

---

## 7. KEEP / MODIFY / RESTORE / DELETE

| 对象 | 裁决 |
|------|------|
| P0 `tone_module` + Node Recall 链 | **KEEP** |
| `UtteranceAcousticTonePayload` | **KEEP** |
| fail-closed 加载（无 bootstrap） | **KEEP** |
| TONE-PRE-V2 冻结合约 | **KEEP** |
| `restore-dialog200-smoke.py` + minimal manifest | **KEEP** |
| `tone-module-p1-dialog-fw-scan.json`（200 utterance 文本） | **KEEP**（full manifest SSOT） |
| `servicePreferences.faster-whisper-vad` | **MODIFY**（验收环境须 true） |
| dialog_200 d002–d200 wav + full manifest | **RESTORE**（后续，阻塞批量验收） |
| V2 backend registry / Phase 1 契约 | **Need New**（非 RESTORE 历史 drift） |
| 已回滚 tone-v2 旁路 / Gateway harness | **DELETE（保持）** |

---

## 8. Validation Result 汇总

| 层级 | 结果 | 证据 |
|------|------|------|
| L0 语料可读 | **PASS** | manifest + dialog_d001.wav |
| L1 FW Tone HTTP | **PASS** | toneEnabled, 22 slices, ~10ms |
| L2 Node ASR→Tone | **PASS** | faster-whisper-vad, 22 slices |
| L3 FW→Recall 消费 | **CONDITIONAL PASS** | d001 window/pattern OK；Recall 计数未完整 diagnostics |
| L4 冻结合约 | **PASS** | TONE-PRE-V2 4/4, fail-closed 4/4 |
| L5 200-case 统计 | **FAIL** | 语料未恢复 |

---

## 9. Final Verdict — 必答六项

| # | 问题 | 答案 |
|---|------|------|
| 1 | 恢复 dialog_200 后，Tone 链路是否仍可用？ | **是** — FW + Node d001 均 toneEnabled=true |
| 2 | Tone V2 是否仍可在当前架构上开发？ | **是（CONDITIONAL）** — Extension Point 未变；需 Phase 1 契约/backend |
| 3 | dialog_200 是否足以支撑 V2 可行性结论？ | **部分** — Dataset Probe 证明链路；**不足** 支撑 200 条统计结论 |
| 4 | Pre-Phase1 Runtime Verification 是否可重跑？ | **CONDITIONAL PASS** — audit all + d001 probe 已通过；full batch 仍否 |
| 5 | 是否存在新的 Architecture Drift？ | **否**（相对 Zero Baseline + Cleanup） |
| 6 | 是否可以进入 Tone V2 Phase 1？ | **CONDITIONAL PASS** — 可启动契约/backend 开发；并行 **RESTORE full dialog_200** |

### 总裁决

| 裁决 | 条件 |
|------|------|
| **架构 + Extension Point 可行性** | **PASS** |
| **Runtime Validation 可行性（dialog_200 v1）** | **CONDITIONAL PASS** |
| **Full Corpus 统计可行性** | **FAIL** |
| **进入 Tone V2 Phase 1** | **CONDITIONAL PASS** |

---

## 10. 建议下一步（非开发任务）

1. **RESTORE** `restored_full_v1`：自 `tone-module-p1-dialog-fw-scan.json` 生成 200 manifest + TTS/录制 wav。
2. 验收环境 **冻结** `faster-whisper-vad: true` 与 FW venv 启动脚本（写入 CI / 常用命令）。
3. Phase 1 门禁：`TONE-PRE-V2` + fail-closed + **d001 probe**（最低）；full corpus 恢复后追加 `audit --part all` n=200。
4. 开启 `spanAssemblyV4DiagnosticsEnabled` 后再跑 d001，补全 Recall tone 计数证据。

---

## 附录：复现命令

```powershell
# 恢复 minimal 语料
python electron_node/electron-node/scripts/test-corpus/restore-dialog200-smoke.py

# FW Worker
cd electron_node/services/faster_whisper_vad
$env:PYTHONUTF8="1"
.\.venv\Scripts\python.exe faster_whisper_vad_service.py

# 审计
.\.venv\Scripts\python.exe -m tone_module.audit_runtime_acceptance --part all
cd ..\..\electron-node
node tests/experiments/d001-timestamp-tone-probe.mjs
npm test -- --testPathPattern=freeze-contract.test.ts --testNamePattern="TONE-PRE-V2"
cd ..\services\faster_whisper_vad
.\.venv\Scripts\python.exe -m unittest tone_module.test_classifier_fail_closed -q
```
