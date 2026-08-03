<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase2_Deployment_Runbook.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 Phase 2 — Deployment Runbook

**Status:** Phase 2 operational guide (Single Service / Single Model)  
**SSOT:** [Tone V2 Phase 2 Restart Supplement](./Tone%20V2%20Phase%202%20Restart%20Supplement%20%E2%80%94%20Single%20Service%20Single%20Model.md) · [Addendum](./Tone%20V2%20Phase%202%20Restart%20Supplement%20Addendum.md)

---

## 1. Weight upgrade (same service instance)

同一 FW Worker 实例内仅允许绑定**一个**模型 artifact。

### 1.1 Canonical vs candidate models

| 角色 | `modelVersion` | 说明 |
|------|----------------|------|
| **Canonical（生产冻结）** | `tone_cnn_p1` | 当前 Tone V2 冻结生产模型；SHA256 `8b22ba13fc9ea32f0b8138294348fb786273b11150b38a4b2193fd0966f1a194` |
| **Candidate（候选）** | `tone_cnn_p2` · `tone_cnn_p3` · … | 同 P0 MLP schema（`featureVersion=p0-v1` · `backend=numpy_p0`）；须完整走 validate → offline → E2E → Model Freeze 后方可切换 canonical |

**禁止：** Registry · Switching · Hot Reload · 同 Worker 多模型 · **Historical Issue（已关闭）：** 第二声学 Pipeline · 按 `modelVersion` 路由 Runtime。

### 1.2 换权重步骤（candidate → 部署验证）

1. 准备新 `.npz`，满足：
   - Required keys: `w1`, `b1`, `w2`, `b2`
   - `featureVersion` ∈ `P0_COMPATIBLE_FEATURE_VERSIONS`（`p0-v1` 或 legacy `mel_mean_80_v1`）
   - 形状与 P0 baseline 一致（80 mels · hidden 32 · 5 classes）
2. 离线验收：
   ```powershell
   cd electron_node\services\faster_whisper_vad
   python -m tone_module.validate_artifact --artifact tone_module/models/tone_cnn_p2.npz --json-out tone_module/models/tone_cnn_p2_validate.json
   python -m tone_module.offline_tone_eval --artifact tone_module/models/tone_cnn_p2.npz --json-out tone_module/models/tone_cnn_p2_offline_eval.json
   ```
3. 设置进程环境变量 `TONE_MODEL_PATH` 指向新 artifact。**代码默认路径仍为 `tone_cnn_p0.npz`（Loader 未改）；生产须显式 env。**
4. **重启** Electron Node + FW Worker（禁止热切换、禁止 runtime reload）。
5. Node E2E（通用脚本）：
   ```powershell
   $env:TONE_MODEL_PATH = "...\tone_cnn_p2.npz"   # 须在启动 Node 前设置
   $env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
   node electron-node/tests/tone-v2-dialog200-batch.js --session tone-v2-p2-d200 --out experiments/tone-v2-p2-dialog200-batch-result.json --wait-fw
   ```
6. 回归：
   - `python -m unittest tone_module.test_loader tone_module.test_classifier_fail_closed tone_module.test_phase2_contracts tone_module.test_phase3_contracts`
   - E2E 架构门：`effective_chain_count == evaluated_count`，`model_error_count == 0`

**禁止：** Registry、active model、`load(path)` 进入生产主链、保留旧模型 ready=true。

---

## 2. New model via new service instance

新模型**不得**在同一 FW Worker 内切换。

1. 复制或新增 FW 服务目录 / `service.json` 条目：
   - 独立 `port`
   - 独立进程 `env`（含 `TONE_MODEL_PATH`）
   - 如需不同 backend，使用独立 `tone_module/backends/<adapter>.py`（**无** registry / routing）
2. Node 侧配置新 endpoint（**非**进程内模型选择）：
   - 当前默认 ASR 路由：`FW_ASR_SERVICE_ID = 'faster-whisper-vad'`（`fw-mode.ts`）
   - 第二实例需：新 `service.json` id、ServiceDiscovery 注册、调度/路由策略指向新 endpoint
3. 验收：对新实例单独跑 dialog_200 或子集 E2E。

**禁止：** 同一 Worker 多模型、按请求/metadata/backend 字段切换推理。

---

## 3. Environment variables

| Variable | Scope | Notes |
|----------|-------|-------|
| `TONE_MODEL_PATH` | FW Worker 进程 | 启动前确定；变更须重启 |
| `ASR_MODEL` | FW `service.json` | ASR 权重，与 Tone artifact 独立 |

`TONE_MODEL_PATH` 通过进程 env 注入；当前 `service.json` 可能仅含 `ASR_MODEL`，运维须在启动脚本或 supervisor env 中设置 Tone 路径。

---

## 4. Diagnostics (observability only)

Optional 字段位于 `diagnostics.toneModule`：

- `tone_inference_ms`（Phase 1，保留）
- `loadMs`、`artifactPath`、`backendAdapter`（Phase 2 optional）
- `modelVersion`、`trainingVersion`、`datasetVersion`、`modelHash` 等

**不得**进入 Recall / Ranking / Assembly / KenLM / Apply 决策。

---

## 5. Test-only APIs

`reset_tone_loader_singleton` / `reset_tone_classifier_singleton`：**仅测试**调用。生产 Runtime 禁止 import 或 invoke。
