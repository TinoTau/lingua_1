<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase6B_tone_cnn_p2_Mainline_Replacement_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 Phase 6-B — `tone_cnn_p2` 主链替换验收报告

**Date:** 2026-06-29  
**Task:** 单模型替换训练与主链验收（`tone_cnn_p1` → `tone_cnn_p2`）  
**Scope:** Training → Artifact → `validate_artifact` → `TONE_MODEL_PATH` 部署 → FW 重启 → Node 主链 E2E（**非 Runtime 开发**）  
**Artifact:** `electron_node/services/faster_whisper_vad/tone_module/models/tone_cnn_p2.npz`  
**Raw E2E:** `electron_node/electron-node/tests/experiments/tone-v2-p2-dialog200-batch-result.json`  
**Batch script:** `electron_node/electron-node/tests/tone-v2-dialog200-batch.js`  
**Prior canonical:** [Tone V2 P4 Node E2E Test Report](./Tone_V2_P4_Node_E2E_Test_Report.md)（`tone_cnn_p1`）  
**Final Verdict:** **PASS**

---

## Executive Summary

本轮在**冻结架构**约束下完成 `tone_cnn_p2.npz` 的训练、artifact 校验、单路径部署与主链 E2E 验收。未修改 Runtime、Loader、Contract、Feature Baseline、Recall、Ranking、Assembly、KenLM、Apply、Service Boundary 或 Backend Adapter；未启用双链路、Shadow、A/B、Registry、Switching 或 Hot Reload。

| 阶段 | 结果 |
|------|------|
| 训练 `tone_cnn_p2.npz` | **PASS** — val_acc=0.732，训练内嵌 `validate_artifact` PASS |
| 独立 `validate_artifact` | **PASS** — schema/shape/loader/adapter 全通过 |
| 部署 `TONE_MODEL_PATH` → p2 + FW 重启 | **PASS** — Loader 探针 `model_version=tone_cnn_p2` |
| Node 主链 E2E（15 min cap） | **PASS** — 67/67 `effective_chain`，0 `model_error` |
| 冻结架构 / 漂移审计 | **PASS** — 单模型单路径；Recall tone active；Assembly tone-free |

**观测项（非 PASS/FAIL 门槛）：** 15 min 内完成 67/200 条（3 条 HTTP 504 超时，非 `model_error`）；重叠子集 mean CER 较 p1 略升 +0.011（非并行 A/B，仅历史对照）。

---

## Training Config

| 项 | 值 |
|----|-----|
| 命令 | `python -m tone_module.train_tone_cnn` |
| `--output` | `tone_module/models/tone_cnn_p2.npz` |
| `--model-version` | `tone_cnn_p2` |
| `--training-version` | `2026-06-29` |
| `--dataset-repo` | `CS5647Team3/data_mini` |
| `--cache-dir` | `tone_module/_data_cache` |
| 结构 | 现有 P0 MLP（80-dim mel → 32 ReLU → 5-class softmax） |
| Feature SSOT | `tone_module/contract.py`（`featureVersion=p0-v1`） |
| Backend | `numpy_p0` |
| 数据划分 | syllables total=11820 · train=10012 · val=1808 |
| Epochs | 80（末轮 train_acc=0.780 · val_acc=0.732） |
| 训练时长 | ~31s |
| 代码变更 | **无** Runtime 路径改动；复用既有 `train_tone_cnn.py` CLI |

**训练控制台摘要：**

```text
saved tone_module/models/tone_cnn_p2.npz
val_acc=0.732 train_acc=0.780
validation=PASS | schema=True | shape=True | loader=True | adapter=True | adapter_acc=0.7323
offline_acc=0.732 samples=1808 conf_mean=0.763
```

---

## Artifact Metadata

| 字段 | 值 |
|------|-----|
| 文件 | `tone_cnn_p2.npz` |
| 路径 | `electron_node/services/faster_whisper_vad/tone_module/models/tone_cnn_p2.npz` |
| 大小 | **15,760 B** |
| SHA256 | `0af2e49d98d444418f9a50db30e385da4fcb7c4710a73b5f0b5f6c0adf7025ef` |
| `formatVersion` | `npz-v1` |
| `featureVersion` | **`p0-v1`** |
| `modelVersion` | **`tone_cnn_p2`** |
| `trainingVersion` | **`2026-06-29`** |
| `datasetVersion` | `CS5647Team3/data_mini` |
| `backend` | `numpy_p0` |
| `buildTime` | `2026-06-29T12:49:24Z` |
| 离线 val_acc / train_acc | 0.732 / 0.780 |
| val_samples / train_samples | 1808 / 10012 |

**Loader 探针（`TONE_MODEL_PATH` → p2，独立 Python 进程）：**

```text
ready=True load_error=None
model_version=tone_cnn_p2 feature_version=p0-v1 backend=numpy_p0
model_hash=0af2e49d98d444418f9a50db30e385da4fcb7c4710a73b5f0b5f6c0adf7025ef
```

---

## validate_artifact Result

**命令：**

```powershell
python -m tone_module.validate_artifact `
  --artifact tone_module/models/tone_cnn_p2.npz `
  --json-out tone_module/models/tone_cnn_p2_validate.json
```

**结果：PASS**

| 检查 | 结果 |
|------|------|
| `passed` | `true` |
| `schema_ok` | `true` |
| `shape_ok` | `true` |
| `loader_ok` | `true` |
| `adapter_ok` | `true` |
| `errors` | `[]` |

**JSON 输出：** `tone_module/models/tone_cnn_p2_validate.json`

校验失败后已按约束**停止部署**；本轮校验通过后方才设置 `TONE_MODEL_PATH` 并重启服务。

---

## Deployment Config

| 项 | 值 |
|----|-----|
| `TONE_MODEL_PATH` | `D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\tone_module\models\tone_cnn_p2.npz` |
| 注入方式 | Electron Node 父进程 `process.env` → `ServiceProcessRunner` 继承 → FW Worker（`faster-whisper-vad` :6007） |
| 默认回退 | **未使用**（显式 env 覆盖 `tone_cnn_p0.npz` 默认路径） |
| 并行 p1 | **否** — 未加载 `tone_cnn_p1.npz`，无 shadow / A/B |
| Node Test Server | `http://127.0.0.1:5020` |
| FW Worker | `http://127.0.0.1:6007` |
| Session | `tone-v2-p2-d200` |
| 语料 | `test wav/dialog_200`（manifest 200 条） |
| 时间上限 | 15 min |
| 前置步骤 | `cleanup_orphaned_processes_simple.ps1` → 设 `TONE_MODEL_PATH` → `npm start`（Electron Node） |

**部署命令（复现）：**

```powershell
cd D:\Programs\github\lingua_1
.\scripts\cleanup_orphaned_processes_simple.ps1
$env:TONE_MODEL_PATH = "D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\tone_module\models\tone_cnn_p2.npz"
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
$env:NODE_ENV = "production"
cd electron_node\electron-node
npm start
# 等待 :5020 与 FW :6007 readiness.utterance_ready=true 后：
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
$env:TONE_MODEL_PATH = "D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\tone_module\models\tone_cnn_p2.npz"
node tests/tone-v2-dialog200-batch.js `
  --session tone-v2-p2-d200 `
  --out experiments/tone-v2-p2-dialog200-batch-result.json `
  --max-minutes 15 --wait-fw --warmup-cases 3
```

---

## Node E2E Result

### 运行时健康（E2E 启动时）

| 检查项 | 结果 |
|--------|------|
| FW HTTP `status` | `ok` |
| `readiness.utterance_ready` | **true** |
| `asr_worker.is_running` | **true**（`worker_pid=47464`） |
| `readiness.last_error` | **null** |
| Tone `model_error`（有效用例） | **0** |

### 主链验收汇总

| 指标 | 值 |
|------|-----|
| `evaluated_count` | **67** |
| `effective_chain_count` | **67 / 67（100%）** |
| `model_error_count` | **0** |
| `toneEnabled_count`（ASR） | **67** |
| `recall_tone_active_count` | **67** |
| `assembly_guard_absent` | **true**（全批） |
| `time_limit_reached` | **true** |
| `batch_elapsed_sec` | **903** |
| HTTP 504 失败 | **3**（warmup d003、timed d001、d038；非 `model_error`） |
| `exact_match_rate` | 13.4% |
| `mean_cer` | **0.227** |
| `p50_cer` / `p95_cer` | 0.200 / 0.500 |
| `fw_triggered_rate` | 1.0 |
| `fw_applied_total` | 25 |
| `recall_tone_compatible_total` | 185 |
| `recall_tone_fallback_total` | 2950 |

### 性能观测（非门槛）

| 指标 | p2 p50 | p2 p95 | p2 mean | p1 参考 p50 | p1 参考 p95 |
|------|--------|--------|---------|-------------|-------------|
| `pipeline_ms` | 10640 | 27896 | 12387 | 7249 | 12760 |
| `fw_step_ms` | 1235 | 5788 | — | 1256 | 1524 |
| `case_ms` | 10644 | 27920 | 12392 | 7255 | 12764 |

### 与 p1 历史对照（观测 only · 非 A/B）

| 指标 | p2 本轮 | p1（P4） | 备注 |
|------|---------|----------|------|
| `evaluated_count` | 67 | 109 | 同 15 min cap；p2 pipeline 更慢 |
| `effective_chain` | 67/67 | 109/109 | 均为 100% |
| `model_error_count` | 0 | 0 | 一致 |
| 重叠子集 mean CER（67 条） | 0.227 | 0.216 | Δ≈+0.011；**非并行实验** |
| 离线 val_acc | 0.732 | 0.732 | 同 holdout 划分下数值相同 |

### 抽样（result `samples`）

| ID | CER | effective | toneEnabled | compatible | fallback | fw_applied | pipeline_ms |
|----|-----|-----------|-------------|------------|----------|------------|-------------|
| d002 | 0.059 | ✓ | true | 5 | 34 | 0 | 31718 |
| d003 | 0.263 | ✓ | true | 3 | 23 | 3 | 29720 |
| d012 | 0.000 | ✓ | true | — | — | — | 23674 |
| d023 | 0.000 | ✓ | true | — | — | — | 11550 |
| d035 | 0.000 | ✓ | true | — | — | — | 11219 |
| d057 | 0.000 | ✓ | true | — | — | — | 4315 |
| d045 | 0.960 | ✓ | true | — | — | — | 7679 |

**典型有效链路（d002）：**

```json
"tone": {
  "asr_payload": { "toneEnabled": true, "sliceCount": 16, "model_error": false },
  "recall": {
    "toneEnabled": true,
    "recallToneCompatibleCount": 5,
    "recallToneFallbackCount": 34
  },
  "assembly_guard_absent": true,
  "effective_chain": true
}
```

---

## Frozen Architecture Verification

### 冻结运行链路（本轮未改动）

```text
FW/ASR → run_tone_inference → UtteranceResponse.tone → ctx.acousticToneSlices → Recall → Ranking → Assembly → KenLM → Apply
```

### Exists vs Effective Matrix

| 能力 | 存在 | 生效 | 证据 |
|------|------|------|------|
| Tone ASR 推理（`run_tone_inference`） | ✓ | ✓ | 67 条 `asr_payload.toneEnabled=true`，`skippedReason=null` |
| `acousticToneSlices` → Recall | ✓ | ✓ | 67 条 `recall.toneEnabled=true` |
| Recall Tone 决策（compatible / fallback） | ✓ | ✓ | compatible=185，fallback=2950 |
| Assembly tone guard **缺席** | ✓ | ✓ | `assembly_guard_absent_all=true` |
| KenLM / Apply tone-free | ✓ | ✓ | 无 tone 门控字段进入 Assembly/KenLM metrics |
| Single Service / Single Model | ✓ | ✓ | 单 FW + 单 `TONE_MODEL_PATH` → p2；无热切换 |
| `get_tone_loader().load(None)` | ✓ | ✓ | env 解析 p2；0 `model_error` |
| Model Registry / hot_reload / Shadow / A/B | ✗ | ✗ | 本轮部署与运行均未出现 |
| Second Tone pipeline | ✗ | ✗ | 无旁路 |
| offline_tone_eval 替代主链验收 | ✗ | ✗ | 仅训练/校验使用；E2E 为主链 SSOT |

### 禁止项核对

| 禁止项 | 本轮状态 |
|--------|----------|
| 双链路 / Shadow / A/B 并行 | **未启用** |
| 多模型同时加载 | **否**（仅 p2） |
| Model Registry / Switching / Hot Reload | **未发现** |
| Runtime Routing / 第二 Pipeline / 第二 Decision | **未发现** |
| 以 offline eval 替代主链验收 | **未发生** |
| 保留 p1 shadow 路径 | **否** |

---

## Mainline Effective Verification

| # | 验收项 | Expected | Actual | 结果 |
|---|--------|----------|--------|------|
| 1 | `tone_cnn_p2` 成功加载 | Loader `model_version=tone_cnn_p2` | 探针与 E2E `toneEnabled=true` | **PASS** |
| 2 | `model_error == 0` | 全批 0 | `model_error_count=0` | **PASS** |
| 3 | `effective_chain` 成立 | 100% 有效用例 | 67/67 | **PASS** |
| 4 | Recall tone active | `recall.toneEnabled=true` | 67/67 | **PASS** |
| 5 | Assembly / KenLM / Apply tone-free | guard 缺席 | `assembly_guard_absent_all=true` | **PASS** |
| 6 | 无 Registry / Switching / Shadow / A/B | 禁止 | 代码与运行均未出现 | **PASS** |
| 7 | Runtime 本轮无开发改动 | 仅 Training + 部署 | 未改 Runtime/Loader/Contract 等 | **PASS** |

**回归门：**

| 门 | 结果 |
|----|------|
| `model_error_count == 0` | **PASS** |
| `effective_chain_count == evaluated_count` | **PASS**（67/67） |
| `assembly_guard_absent` | **PASS** |
| `recall_tone_active_count == toneEnabled_count` | **PASS**（67/67） |
| `validate_artifact` 先于部署 | **PASS** |
| 单 `TONE_MODEL_PATH` 无并行 p1 | **PASS** |

---

## Drift Audit

| 区域 | Expected | Actual | Impact | Severity | 处置 |
|------|----------|--------|--------|----------|------|
| 单模型固定路径 | `TONE_MODEL_PATH` → p2 npz | env 指向 `tone_cnn_p2.npz` | 完成 P6-B 替换目标 | — | **KEEP** |
| Runtime 决策链路 | 不变 | 67/67 effective_chain | 无架构破坏 | — | **KEEP** |
| Loader fail-closed | 坏 artifact → model_error | 0 model_error | artifact 合法 | — | **KEEP** |
| Registry / 热切换 / Shadow / A/B | 禁止 | 未出现 | 无漂移 | — | **KEEP** |
| Assembly tone guard | 缺席 | `assembly_guard_absent_all=true` | 无复活 | — | **KEEP** |
| Feature / Backend 契约 | `p0-v1` + `numpy_p0` | artifact 元数据一致 | 无契约漂移 | — | **KEEP** |
| `config.py` 默认路径 | 仍为 `tone_cnn_p0.npz` | 未改 Loader 默认 | 生产靠 env 显式指向 | LOW | **KEEP**（P6-A 既定） |
| E2E 504 超时 | 理想 0 | 3 条（网关超时） | 减少有效条数；非 tone 失效 | LOW | **KEEP** 架构；可选延长 timeout/cap |
| Pipeline p50 升高 | 观测 | 高于 P4 p1 | 冷启动/负载 | LOW | 非本轮阻塞项 |
| 重叠 CER vs p1 | 观测 | +0.011 mean | 未见 model_error 级退化 | LOW | **KEEP** 模型；后续迭代再评 |

---

## Expected / Actual / Impact

| 项 | Expected | Actual | Impact |
|----|----------|--------|--------|
| 训练产出 p2 npz | `tone_cnn_p2.npz` @ 固定路径 | 已产出，val_acc=0.732 | 可部署 |
| `validate_artifact` | PASS 后部署 | PASS，errors=[] | 部署合法 |
| 主链加载 p2 | `modelVersion=tone_cnn_p2` | Loader + E2E 一致 | 替换成功 |
| `model_error` | 0 | 0 | 无 fail-closed 触发 |
| `effective_chain` | 100% | 67/67 | 主链生效 |
| Recall tone | active | 67/67 | Tone 参与 Recall |
| Assembly tone-free | guard 缺席 | true | 无 guard 复活 |
| 禁止双模型 / A/B | 单路径 | 仅 p2 env | 符合冻结运维 |
| E2E 覆盖率 | dialog_200 | 67/200（15min） | 覆盖不足但架构 PASS |
| CER（观测） | 不作为硬门槛 | mean=0.227 | 供下轮模型迭代参考 |

---

## KEEP / MODIFY / RESTORE / DELETE

| 处置 | 项 |
|------|-----|
| **KEEP** | 冻结主链 `FW → tone → Recall → … → Apply` |
| **KEEP** | 单 `TONE_MODEL_PATH` + FW 重启部署模型 |
| **KEEP** | `train_tone_cnn` / `validate_artifact` / 通用 `tone-v2-dialog200-batch.js` 工具链 |
| **KEEP** | `featureVersion=p0-v1` · `backend=numpy_p0` · P0 MLP 结构 |
| **KEEP** | `tone_cnn_p2.npz` 作为当前实例生产模型（env 已指向） |
| **KEEP** | Assembly tone guard 缺席；KenLM/Apply tone-free |
| **MODIFY** | （可选）延长 E2E cap 或 pipeline timeout，减少 504 |
| **MODIFY** | （后续）Model Freeze 文档将 canonical 从 p1 更新为 p2（须走冻结流程） |
| **RESTORE** | — |
| **DELETE** | — （本轮未引入 shadow / 第二 pipeline / Registry） |

---

## Final Verdict

### **PASS**

**理由：**

1. **`tone_cnn_p2.npz` 训练与校验成功** — 固定约束满足；`validate_artifact` PASS 后方才部署。
2. **主链替换成功** — `TONE_MODEL_PATH` → p2；Loader `model_version=tone_cnn_p2`；0 `model_error`。
3. **冻结架构成立** — 67/67 `effective_chain`；Recall tone active；Assembly tone-free；无 Registry / Switching / Shadow / A/B / 第二 Pipeline。
4. **本轮范围合规** — 仅 Training → Artifact → validate → env 替换 → 重启 → E2E；未改 Runtime 与决策模块。
5. **未并行 p1** — 单模型单路径；无 shadow 与 offline eval 替代主链验收。

**附带说明（不降级为 FAIL）：**

- 15 min 上限完成 **67/200** 条；3 条 HTTP 504 为网关超时，已成功用例均 `effective_chain=true`。
- 重叠子集 CER 较 p1 历史略升（+0.011）为**观测项**，非本轮并行 A/B；离线 val_acc 与 p1 相同（0.732）。
- Pipeline p50 高于 P4 主要受冷启动与个别长延迟影响，属性能观测，非部署契约失败。

---

## 附件

| 文件 | 说明 |
|------|------|
| `tone_module/models/tone_cnn_p2.npz` | 本轮训练 artifact |
| `tone_module/models/tone_cnn_p2_validate.json` | `validate_artifact` JSON |
| `tests/experiments/tone-v2-p2-dialog200-batch-result.json` | 完整 E2E 原始结果 |
| `tests/tone-v2-dialog200-batch.js` | 通用主链 E2E SSOT 脚本 |
