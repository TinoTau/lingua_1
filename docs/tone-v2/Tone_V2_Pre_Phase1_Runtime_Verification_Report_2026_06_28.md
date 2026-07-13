# Tone V2 Pre-Phase1 Runtime Verification Report

**日期**：2026-06-28  
**依据**：《Tone_V2_Pre_Rebuild_Cleanup_Report_2026_06_28.md》+ 当前冻结架构  
**范围**：Pre-Rebuild Cleanup 剩余条件补齐 + Tone V2 Phase 1 进入前验证（非 CRNN / 非训练 / 非公开模型）  

---

## Executive Summary

| 项 | 结果 |
|----|------|
| Pre-Rebuild Cleanup 升级 | **PASS**（相对清理报告 CONDITIONAL PASS） |
| FW Worker 启动与健康 | **PASS**（需 venv Python） |
| Tone P0 Runtime 主链 | **CONDITIONAL PASS**（FW→Posterior 已验证；Node 全链路受配置/语料限制） |
| Architecture Drift | **PASS**（Tone V2 漂移无残留） |
| 进入 Tone V2 Phase 1 | **CONDITIONAL PASS** |
| Phase 1 禁止项 | **仍禁止** CRNN / 公开模型 / 训练 / 模型选型 |

**摘要**：清理项（bootstrap 移除、fail-closed、死参数删除）已在运行态验证通过。FW Worker 经 `.venv` 启动后 `/health` 与 `/utterance` tone 输出正常。Node 侧 Recall 消费层经 **FW 实响应 + dist 模块** 验证通过，但 `run-pipeline-with-audio` 全链路因 **`servicePreferences.faster-whisper-vad=false`** 与 **`dialog_200` 语料缺失** 未能完成标准 d001 探针。

---

## FW Worker Startup Matrix

| 字段 | 值 |
|------|-----|
| **启动命令** | `Set-Location D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad`<br>`$env:PYTHONUTF8="1"`<br>`.\.venv\Scripts\python.exe faster_whisper_vad_service.py` |
| **失败说明** | 系统 `python` 直启因 VAD 需 `CUDAExecutionProvider` 且 onnxruntime 无 GPU EP → **FAIL**；`.venv` 内 onnxruntime-gpu 正常 |
| **端口** | `6007`（`FASTER_WHISPER_VAD_PORT` 默认） |
| **Health** | `GET http://127.0.0.1:6007/health` → `200`，`status: ok` |
| **ASR 模型** | `models/faster-whisper-medium`（cuda / int8_float16） |
| **Tone 模型路径** | `tone_module/models/tone_cnn_p0.npz`（15882 bytes，**存在**） |
| **`TONE_MODEL_PATH`** | 同上（config 默认解析） |
| **`ToneClassifier.ready`** | `true`（默认 npz 加载成功） |
| **Bootstrap fallback** | **不存在**（`tone_module/classifier.py` 无 `_bootstrap_weights`） |
| **Fail-closed** | missing/corrupt/invalid → `ready=false`；子进程 `TONE_MODEL_PATH=__missing__` → `False model_not_found` |

### Health 样例（节选）

```json
{
  "status": "ok",
  "device": "cuda",
  "asr_model_loaded": true,
  "vad_model_loaded": true,
  "asr_worker": { "is_running": true, "worker_state": "running" }
}
```

### Fail-Closed 验证

| 场景 | ready | skippedReason / loadError |
|------|-------|---------------------------|
| missing model | false | `model_not_found` |
| corrupt npz | false | load error present |
| invalid format（缺 w1） | false | `missing required weight key: w1` |
| valid `tone_cnn_p0.npz` | true | — |
| HTTP zh 推理（有效模型） | toneEnabled=true | 22–33 slices |
| 模型缺失时 inference | — | `model_error`（audit 逻辑 + 子进程验证） |

---

## Regression Result

| 命令 | 结果 | 失败原因 | 与清理有关？ | 阻塞 Phase 1？ |
|------|------|----------|--------------|----------------|
| `python -m tone_module.test_classifier_fail_closed` | **PASS** (4/4) | — | 否（验证清理） | 否 |
| `python -m tone_module.audit_runtime_acceptance --part fail` | **PASS** | — | 否 | 否 |
| `python -m tone_module.audit_runtime_acceptance --part all` | **FAIL** | `cases.manifest.json` 不存在 | **否**（测试语料缺失） | **是**（E2E 验收） |
| `node tests/experiments/d001-timestamp-tone-probe.mjs` | **FAIL** | 同上 + 缺 `dialog_d001.wav` | **否** | **是**（标准探针） |
| Jest tone-match / tone-time / v4-tone-score | **PASS** (11/11) | — | 否 | 否 |
| Jest `TONE-PRE-V2-*` 冻结合约 | **PASS** (4/4) | — | 否 | 否 |
| `npm run test:fw-detector` | **未全跑** | 仓库既有 `build-sentence-candidates` / TS 问题 | **否** | 否（非 Tone 清理引入） |
| Electron Node `:5020/health` | **PASS** | — | — | — |
| `run-pipeline-with-audio` | **FAIL** | `No available ASR service`（`faster-whisper-vad: false`） | **否**（本地配置） | **是**（Node 全链路） |

---

## Runtime Chain Verification

### A. FW Worker → HTTP tone（**PASS**）

**探针音频**：`test wav/dialog_200/context_prior/cp_001_hotel_latte.wav`（替代 d001，语料目录内唯一可用 wav）

| 检查项 | 结果 |
|--------|------|
| `UtteranceResponse.tone` 存在 | ✅ |
| `acousticToneSlices` 存在 | ✅（22–33 slices） |
| `TonePosterior {t1..t5}` | ✅ |
| `toneEnabled=true`（有效模型） | ✅ |
| `skippedReason=model_error`（模型缺失路径） | ✅（fail-closed 子进程/audit） |

### B. Node 消费层（**PASS**，桥接验证）

使用 FW 实响应 JSON + `dist/.../tone-time-align.js` / `tone-match-score.js`：

| 检查项 | 结果 |
|--------|------|
| `normalizeAcousticSlices` | ✅ 33 slices |
| `buildWordTimeSpans` | ✅ 34 spans |
| `extractAcousticTonePatternByTime` | ✅ pattern `[3,2]` |
| `computeToneScoreResult` | ✅ penalty 逻辑正常 |
| KenLM `tone` 死参数 | ✅ 已删除（静态扫描 + 冻结合约） |
| `tonePayload` orchestrator 死参数 | ✅ 已删除 |

### C. Node 全链路 ASR Step → Recall → KenLM → Apply（**CONDITIONAL**）

| 检查项 | 结果 | 说明 |
|--------|------|------|
| `ctx.acousticToneSlices` 写入 | ⚠ 未跑通 | `run-pipeline-with-audio` 未进入 ASR |
| Recall tone pattern / tone_exact | ⚠ | 单元测试 PASS；运行时未跑 d001 |
| KenLM 无 tone 参数 | ✅ 静态确认 |
| Apply 输出 | ⚠ 未验证 | 同上 |

**阻塞原因（非架构/非清理）**：

1. `%APPDATA%/lingua-electron-node/electron-node-config.json` → `servicePreferences.faster-whisper-vad: false`
2. `test wav/dialog_200/cases.manifest.json` 与 `dialog_d001.wav` **本地不存在**

**建议验证前操作（不改代码）**：

- 将 `servicePreferences.faster-whisper-vad` 设为 `true` 并重启 Electron Node（或由 Node 托管启动 FW）
- 恢复 `dialog_200` 语料包

---

## Tone Exists vs Effective Matrix

| 能力 | 存在 | 已接线 | Runtime 参与 | 本轮验证 |
|------|------|--------|--------------|----------|
| `run_tone_inference` | ✅ | ✅ | ✅ | FW HTTP PASS |
| Fail-closed classifier | ✅ | ✅ | ✅ | 单测 + audit PASS |
| Bootstrap fallback | ❌ | ❌ | ❌ | 代码扫描 PASS |
| HTTP `response.tone` | ✅ | ✅ | ✅ | PASS |
| `normalizeAcousticSlices` | ✅ | ✅ | ✅ | 桥接 PASS |
| Recall pattern extract | ✅ | ✅ | ✅ | 桥接 PASS |
| `tone_exact` / penalty | ✅ | ✅ | ⚠ | Jest PASS；d001 未跑 |
| KenLM `tone` 参数 | ❌ | — | — | 已删除 PASS |
| `tonePayload` 死参数 | ❌ | — | — | 已删除 PASS |
| Node pipeline E2E | ✅ | ⚠ | ⚠ | 配置阻塞 |

---

## Fail Closed Verification

| 断言 | 状态 |
|------|------|
| 无 bootstrap / silent fallback | ✅ |
| 模型缺失 → `ready=false` | ✅ |
| 损坏/无效 npz → `ready=false` | ✅ |
| 有效 npz → `ready=true` | ✅ |
| 推理层 `skippedReason=model_error` when not ready | ✅（设计 + audit；singleton 有 npz 时不触发） |

---

## Architecture Drift Residual Scan

| 扫描项 | 结果 | 处置 |
|--------|------|------|
| `scripts/tone-v2` | 不存在 | **KEEP（清零）** |
| `tone_module/v2` | 不存在 | **KEEP（清零）** |
| Gateway/Scheduler Tone benchmark | 不存在 | **KEEP** |
| Shadow Tone Runtime | 不存在 | **KEEP** |
| `tonePayload` 死参数 | 已删除 | **DELETE（已完成）** |
| KenLM `tone` 死参数 | 已删除 | **DELETE（已完成）** |
| `_bootstrap_weights` | 已删除 | **DELETE（已完成）** |
| `tonePayloadAvailable` 诊断字段 | 存在 | **KEEP**（有效 diagnostics，非第二入口） |
| ffmpeg `bootstrap.min.css` | 存在 | **KEEP**（无关） |
| lexicon `v2-shadow` bootstrap 文档 | 存在 | **KEEP**（Lexicon 域，非 Tone） |

---

## Required Repair Matrix

| 对象 | 动作 | 说明 |
|------|------|------|
| P0 cleanup 代码 | **KEEP** | 已验证 |
| FW 启动方式 | **KEEP** | 使用 `.venv\Scripts\python.exe` |
| `dialog_200` 语料 | **RESTORE**（测试资产） | 非 Tone 代码；阻塞 d001 / audit all |
| `servicePreferences.faster-whisper-vad` | **MODIFY**（配置） | 验证 Node 全链路时需 true |
| Gateway/Scheduler Tone 路径 | **DELETE（保持）** | 无残留 |
| V2 model loader | **待新建** | Phase 1 入口 |

---

## Final Verdict

### 六项必答

| # | 问题 | 答案 |
|---|------|------|
| 1 | Pre-Rebuild Cleanup 可否 CONDITIONAL → **PASS**？ | **是 → PASS**（bootstrap/死参数/fail-closed/FW 健康均已验证） |
| 2 | FW Worker 是否已启动并验证通过？ | **是**（`:6007`，venv 启动，`/health` + `/utterance.tone` PASS） |
| 3 | Tone P0 runtime 主链是否仍有效？ | **CONDITIONAL PASS**（FW→Posterior→Node 消费层 PASS；标准 Node E2E 未跑通） |
| 4 | 是否仍有 Gateway/Scheduler/shadow/offline 残留？ | **否** |
| 5 | 是否允许进入 Tone V2 Phase 1？ | **CONDITIONAL PASS** — 可启动 **V2 Model Loader / Model Contract**；需补语料 + 启用 Node ASR 偏好后做 d001 回归 |
| 6 | Phase 1 是否仍禁止 CRNN/公开模型/训练/选型？ | **是，仍禁止** |

### 裁决

| 维度 | 裁决 |
|------|------|
| Pre-Rebuild Cleanup | **PASS** |
| Pre-Phase1 Runtime Verification | **CONDITIONAL PASS** |
| Tone V2 Phase 1 入口 | **CONDITIONAL PASS** |

**进入 Phase 1 前建议完成（不改 Recall/Ranking/Assembly/KenLM/Apply 代码）**：

1. 恢复 `test wav/dialog_200/` 语料（manifest + d001 wav）  
2. 验证配置：`servicePreferences.faster-whisper-vad: true`  
3. 重跑 `d001-timestamp-tone-probe.mjs` 与 `audit_runtime_acceptance --part all`  

**Phase 1 合法首步**：

```text
V2 model loader
Fail-closed model contract（延续 P0 语义）
Model metadata
Feature / backend design
```

---

*证据文件（本地，非 SSOT）*：`electron_node/electron-node/tests/experiments/_prephase1_fw_resp.json`
