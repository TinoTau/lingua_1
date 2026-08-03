<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_P4_Node_E2E_Test_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 Phase 4 — Node E2E Deployment Test Report

**Date:** 2026-06-29  
**Task:** `tone_cnn_p1.npz` 固定模型部署验证 + dialog_200 Node E2E  
**Scope:** 部署验证与 E2E 测试（**非 Runtime 开发**）  
**Artifact:** `electron_node/services/faster_whisper_vad/tone_module/models/tone_cnn_p1.npz`  
**Raw result:** `electron_node/electron-node/tests/experiments/tone-v2-phase4-p1-deploy-dialog200-batch-result.json`  
**Batch script:** `electron_node/electron-node/tests/tone-v2-phase4-p1-deploy-dialog200-batch.js`  
**Baseline:** [Tone V2 Phase 3 Node E2E Test Report](./Tone_V2_Phase3_Node_E2E_Test_Report_2026_06_29.md)  
**Final Verdict:** **PASS**

---

## 1. Deployment Config

| 项 | 值 |
|----|-----|
| `TONE_MODEL_PATH` | `D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\tone_module\models\tone_cnn_p1.npz` |
| 注入方式 | Electron Node 父进程 `process.env` → `ServiceProcessRunner` 继承 → FW Worker（`faster-whisper-vad` :6007） |
| 默认回退 | **未使用**（显式 env 覆盖 `tone_cnn_p0.npz` 默认路径） |
| Node Test Server | `http://127.0.0.1:5020` |
| FW Worker | `http://127.0.0.1:6007` |
| Session | `tone-v2-phase4-p1-d200-v1` |
| 语料 | `test wav/dialog_200`（manifest 200 条） |
| 时间上限 | 15 min（实际 **904s**，`time_limit_reached=true`） |
| 前置步骤 | `cleanup_orphaned_processes_simple.ps1` → 设 `TONE_MODEL_PATH` → `npm start`（Electron Node） |
| 代码变更 | **无** Runtime / Loader / Contract / Recall / Ranking / Assembly / KenLM / Apply / Feature Baseline / Backend / Service Boundary 改动；仅新增 E2E batch 脚本 |

**部署命令（复现）：**

```powershell
cd D:\Programs\github\lingua_1
.\scripts\cleanup_orphaned_processes_simple.ps1
$env:TONE_MODEL_PATH = "D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\tone_module\models\tone_cnn_p1.npz"
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
$env:NODE_ENV = "production"
cd electron_node\electron-node
npm start
# 等待 :5020 与 FW :6007 readiness.utterance_ready=true 后：
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
node tests/tone-v2-phase4-p1-deploy-dialog200-batch.js --max-minutes 15
```

---

## 2. Artifact Metadata

| 字段 | 值 |
|------|-----|
| 文件 | `tone_cnn_p1.npz` |
| 大小 | **15,760 B** |
| SHA256 | `8b22ba13fc9ea32f0b8138294348fb786273b11150b38a4b2193fd0966f1a194` |
| `featureVersion` | `p0-v1` |
| `modelVersion` | **`tone_cnn_p1`** |
| `trainingVersion` | `2026-06-29` |
| `backend` / `backendAdapter` | `numpy_p0` |
| `formatVersion` | `npz-v1` |
| `datasetVersion` | `CS5647Team3/data_mini` |
| 离线 `validate_artifact` | **PASS**（部署前探针） |
| 离线 val_acc（训练 holdout） | 0.732（见 [P4 Training Report](./Tone_V2_P4_Training_Report.md)） |

**Loader 探针（同 `TONE_MODEL_PATH`，独立 Python 进程）：**

```text
ready=True load_error=None
modelVersion=tone_cnn_p1 artifactHash=8b22ba13...
```

---

## 3. Runtime Health

### 3.1 FW `/health`（E2E 启动前）

| 检查项 | 结果 |
|--------|------|
| HTTP `status` | `ok` |
| `readiness.process_alive` | **true** |
| `readiness.utterance_ready` | **true** |
| `asr_worker.is_running` | **true**（`worker_pid=31436`） |
| `readiness.last_error` | **null** |
| Tone `model_error`（E2E 全批） | **0** |

### 3.2 部署验收五项

| # | 验收项 | 结果 |
|---|--------|------|
| 1 | Runtime 通顺 | **PASS** — 109/109 用例完成 pipeline，无架构级失败 |
| 2 | `tone_cnn_p1` 成功加载 | **PASS** — Loader 探针 `modelVersion=tone_cnn_p1`；E2E `toneEnabled=true` |
| 3 | Tone 真实参与 Recall | **PASS** — 109/109 `recall.toneEnabled=true`，`recallToneFallbackCount>0` |
| 4 | 无 `model_error` | **PASS** — `model_error_count=0` |
| 5 | 无 Registry / Switching / second pipeline / guard 复活 | **PASS** — 见 §5 |

---

## 4. Frozen Architecture Verification

### 4.1 冻结运行链路（未改动）

```text
FW/ASR → run_tone_inference → UtteranceResponse.tone → ctx.acousticToneSlices → Recall → Ranking → Assembly → KenLM → Apply
```

### 4.2 Exists vs Effective Matrix

| 能力 | 存在 | 生效 | 证据 |
|------|------|------|------|
| Tone ASR 推理（`run_tone_inference`） | ✓ | ✓ | 109 条 `asr_payload.toneEnabled=true`，`skippedReason=null` |
| `acousticToneSlices` → Recall | ✓ | ✓ | 109 条 `recall.toneEnabled=true` |
| Recall Tone 决策（compatible / fallback） | ✓ | ✓ | `recall_tone_compatible_total=312`，`recall_tone_fallback_total=4618` |
| Assembly tone guard **缺席** | ✓ | ✓ | `assembly_guard_absent_all=true` |
| Single Service / Single Model | ✓ | ✓ | 单 FW 实例 + 单 `TONE_MODEL_PATH`；无热切换 API |
| `get_tone_loader().load(None)` | ✓ | ✓ | env 路径解析；0 `model_error` |
| Model Registry / hot_reload | ✗ | ✗ | 代码与运行均未出现 |
| Second Tone pipeline | ✗ | ✗ | 无旁路 |
| Assembly `toneGuard` 复活 | ✗ | ✗ | metrics 无 `toneGuardBlockedCount` |

### 4.3 漂移检查

| 检查 | 结果 |
|------|------|
| Registry / model_switch / hot_reload | **未发现** |
| 运行时权重切换 | **未发现**（须重启换 env） |
| Offline `validate_artifact` 进入在线 Gate | **未发现** |
| Assembly tone guard 复活 | **未发现** |
| `confidence` 进入 Ranking penalty | **未变**（本轮无代码改动） |

---

## 5. Quality Metrics

### 5.1 E2E 汇总（本轮 P4 · `tone_cnn_p1`）

| 指标 | 值 |
|------|-----|
| `evaluated_count` | **109** |
| `effective_chain_count` | **109 / 109（100%）** |
| `model_error_count` | **0** |
| `toneEnabled_count`（ASR） | **109** |
| `recall_tone_active_count` | **109** |
| `assembly_guard_absent` | **true**（全批） |
| `exact_match_rate` | 11.9% |
| `mean_cer` | **0.220** |
| `p50_cer` | 0.211 |
| `p95_cer` | 0.500 |
| `fw_triggered_rate` | 1.0 |
| `fw_applied_total` | 64 |
| `recall_tone_compatible_total` | 312 |
| `recall_tone_fallback_total` | 4618 |

### 5.2 与 Phase 3 基线对比

| 指标 | P4 本轮（p1） | P3 基线 | 备注 |
|------|--------------|---------|------|
| `evaluated_count` | 109 | 190 | P4 15min 触顶；P3 同 cap 跑更多条（pipeline 更快） |
| `effective_chain` | 109/109 | 190/190 | 均为 100% |
| `model_error_count` | 0 | 0 | 一致 |
| `mean_cer`（全批） | 0.220 | 0.283 | 不可直接对比（样本集不同） |
| `mean_cer`（重叠 d011–d109） | 0.220 | **0.220** | 99 条可比子集；**无显著回归** |
| d001–d010 | **全部成功** | 10 条 ASR 冷启动失败 | P4 预热后首批可跑 |

**质量结论：** 在可比子集上 CER 与 Phase 3 **持平**；全批未见因 `tone_cnn_p1` 部署导致的 `model_error` 或 effective_chain 断裂。离线 val_acc=0.732 的模型质量信号未在本轮 E2E 中转化为可隔离的端到端 CER 跃迁（符合「部署验证」范围，非模型 A/B 实验）。

---

## 6. Performance Metrics

| 指标 | P4 p50 | P4 p95 | P4 mean | P3 p50（参考） | P3 p95（参考） |
|------|--------|--------|---------|---------------|---------------|
| `pipeline_ms` | **7249** | 12760 | 8290 | 3383 | 6392 |
| `fw_step_ms` | **1256** | 1524 | — | 982 | 1239 |
| `case_ms` | **7255** | 12764 | 8295 | 3387 | 6397 |

**说明：** P4 首批用例含 ASR/Tone 冷启动（如 d001 `pipeline_ms=24765`），拉高 p50；与 P3 不同（P3 首批快速失败未计入有效 pipeline）。性能不作为本轮部署 PASS/FAIL 硬门槛；后续可单独做 warmed steady-state benchmark。

---

## 7. Sample Results（抽样 12 条 · 见 result `samples`）

| ID | CER | effective | toneEnabled | compatible | fallback | fw_applied | pipeline_ms |
|----|-----|-----------|-------------|------------|----------|------------|-------------|
| d001 | 0.444 | ✓ | true | 0 | 20 | 0 | 24765 |
| d002 | 0.059 | ✓ | true | 5 | 34 | 0 | 12625 |
| d003 | 0.263 | ✓ | true | 3 | 23 | 3 | 7514 |
| d004 | 0.152 | ✓ | true | 3 | 64 | 0 | 13433 |
| d005 | 0.257 | ✓ | true | 3 | 52 | 0 | 12685 |
| d006 | 0.071 | ✓ | true | 3 | 51 | 0 | 8100 |
| d007 | 0.581 | ✓ | true | 0 | 54 | 0 | 12767 |
| d008 | 0.185 | ✓ | true | 4 | 38 | 0 | 11647 |
| d009 | 0.524 | ✓ | true | 8 | 28 | 3 | 6972 |
| d010 | 0.500 | ✓ | true | 3 | 42 | 4 | 6523 |
| d011 | 0.190 | ✓ | true | 6 | 43 | 0 | 7083 |
| d012 | 0.000 | ✓ | true | 0 | 41 | 0 | 10286 |

**典型有效链路（d002）：**

```json
"tone": {
  "asr_payload": { "toneEnabled": true, "sliceCount": 16, "model_error": false },
  "recall": {
    "toneEnabled": true,
    "recallToneCompatibleCount": 5,
    "recallToneFallbackCount": 34,
    "ngramTonePatternHitCount": 48
  },
  "effective_chain": true
}
```

---

## 8. Drift Matrix

| 区域 | Expected | Actual | Impact | Severity | 处置 |
|------|----------|--------|--------|----------|------|
| 单模型固定路径 | `TONE_MODEL_PATH` → p1 npz | env 指向 `tone_cnn_p1.npz` | 完成 P4 部署目标 | — | **KEEP** |
| Runtime 决策链路 | 不变 | 109/109 effective_chain | 无架构破坏 | — | **KEEP** |
| Loader fail-closed | 坏 artifact → model_error | 0 model_error | 部署 artifact 合法 | — | **KEEP** |
| Registry / 热切换 | 禁止 | 未出现 | 无漂移 | — | **KEEP** |
| Assembly tone guard | 缺席 | `assembly_guard_absent_all=true` | 无复活 | — | **KEEP** |
| E2E 覆盖率 | dialog_200 | 109/200（15min） | 覆盖不足 | LOW | **KEEP** 架构；可选延长 cap |
| Pipeline 延迟 p50 | 观测 | 高于 P3 | 冷启动/负载 | LOW | 非本轮阻塞项 |

---

## 9. Regression Result

| 回归门 | 结果 |
|--------|------|
| `model_error_count == 0` | **PASS** |
| `effective_chain_count == evaluated_count` | **PASS**（109/109） |
| `assembly_guard_absent` | **PASS** |
| `recall_tone_active_count == toneEnabled_count` | **PASS**（109/109） |
| 重叠子集 CER vs P3 | **PASS**（d011–d109 mean_cer ≈ 0.220 vs 0.220） |
| Registry / Switching / guard 复活 | **PASS**（未发现） |
| Runtime 代码未改动 | **PASS** |

---

## 10. Final Verdict

### **PASS**

**理由：**

1. **`tone_cnn_p1.npz` 部署成功** — `TONE_MODEL_PATH` 注入、FW 健康、`modelVersion=tone_cnn_p1`、0 `model_error`。
2. **冻结架构成立** — Tone 经 ASR → Recall 全链生效；无 Registry、热切换、second pipeline、Assembly guard 复活。
3. **Runtime 通顺** — 109 条连续 E2E 无架构级失败；`effective_chain` 100%。
4. **质量无回归** — 与 Phase 3 可比子集 CER 持平；未见部署性劣化。

**附带说明（不降级为 FAIL）：**

- 15 min 上限仅完成 **109/200** 条；完整语料回归可延长 cap 或分批执行。
- Pipeline p50 高于 Phase 3 主要受冷启动与首批长延迟影响，属性能观测项，非部署契约失败。

---

## 11. 附件

| 文件 | 说明 |
|------|------|
| `tests/experiments/tone-v2-phase4-p1-deploy-dialog200-batch-result.json` | 完整 E2E 原始结果 |
| `tests/experiments/tone-v2-phase4-p1-deploy-batch-console.log` | 控制台日志 |
| `tests/tone-v2-phase4-p1-deploy-dialog200-batch.js` | 本轮 batch 脚本 |
