# Tone V2 Phase 6-A — Model Iteration Platform Cleanup Development Report

**Date:** 2026-06-29  
**Scope:** 工具链泛化与文档同步（**非训练** · **非 Runtime 开发**）  
**Constraint SSOT:** [Tone_V2_Phase6A_Model_Iteration_Platform_Cleanup_PreDev_Audit_Report.md](./Tone_V2_Phase6A_Model_Iteration_Platform_Cleanup_PreDev_Audit_Report.md)  
**Final Verdict:** **PASS**

---

## 1. Executive Summary

本轮完成 P6-A 工具链泛化：收敛通用 Node E2E 脚本、训练/校验/离线 CLI、Runbook 与 SSOT 文档同步。**未**训练 `tone_cnn_p2`、**未**修改 Runtime / Loader / Contract / Backend / Decision 链。

| 交付项 | 状态 |
|--------|------|
| 通用 `tone-v2-dialog200-batch.js` | ✅ |
| phase1/3/4 E2E 薄包装 + deprecated | ✅ |
| `train_tone_cnn --dataset-repo` / `--dataset-zip` | ✅ |
| `python -m tone_module.validate_artifact` | ✅ |
| `python -m tone_module.offline_tone_eval` | ✅ |
| Runbook / CONTRACT_FREEZE / README | ✅ |
| 单元测试 28/28 | ✅ |
| CLI tooling check（validate + offline） | ✅ |
| 全量 live Node E2E | ⚠️ 需运行中 Node :5020（本轮未启动服务） |

---

## 2. Modified Files

| 文件 | 变更 |
|------|------|
| `electron_node/electron-node/tests/tone-v2-dialog200-batch.js` | **新增** — 通用 SSOT E2E 批脚本 |
| `electron_node/electron-node/tests/tone-v2-phase1-dialog200-batch.js` | **MODIFY** — deprecated 薄包装 |
| `electron_node/electron-node/tests/tone-v2-phase3-dialog200-batch.js` | **MODIFY** — deprecated 薄包装 |
| `electron_node/electron-node/tests/tone-v2-phase4-p1-deploy-dialog200-batch.js` | **MODIFY** — deprecated 薄包装 |
| `electron_node/services/faster_whisper_vad/tone_module/train_tone_cnn.py` | **MODIFY** — `--dataset-repo`/`--dataset-zip`；`split_val_holdout_samples` / `load_val_holdout_features` |
| `electron_node/services/faster_whisper_vad/tone_module/validate_artifact.py` | **MODIFY** — `python -m` CLI |
| `electron_node/services/faster_whisper_vad/tone_module/offline_tone_eval.py` | **MODIFY** — `python -m` CLI |
| `electron_node/services/faster_whisper_vad/tone_module/test_phase3_contracts.py` | **MODIFY** — CLI 回归门 |
| `docs/tone-v2/Tone_V2_Phase2_Deployment_Runbook.md` | **MODIFY** — canonical/candidate 生命周期 |
| `docs/tone-v2/TONE_V2_CONTRACT_FREEZE.md` | **MODIFY** — canonical `tone_cnn_p1` 段落 |
| `docs/tone-v2/README.md` | **MODIFY** — Phase 6-A 工具索引与 Regression Gate |

**未修改：** `loader.py` · `contract.py` · `inference.py` · `classifier.py` · `numpy_p0.py` · `config.py` · FW/Node Recall 链。

---

## 3. CLI Usage

### 3.1 训练（P6-B 预备；本轮未执行训练）

```powershell
cd electron_node\services\faster_whisper_vad
python -m tone_module.train_tone_cnn `
  --output tone_module/models/tone_cnn_p2.npz `
  --model-version tone_cnn_p2 `
  --training-version 2026-06-29 `
  --dataset-repo CS5647Team3/data_mini `
  --cache-dir tone_module/_data_cache
```

### 3.2 Artifact 验收

```powershell
python -m tone_module.validate_artifact `
  --artifact tone_module/models/tone_cnn_p1.npz `
  --json-out tone_module/models/tone_cnn_p1_validate.json
```

### 3.3 离线评估

```powershell
# 重建训练同源 holdout（seed=42, val_ratio=0.15）
python -m tone_module.offline_tone_eval `
  --artifact tone_module/models/tone_cnn_p1.npz `
  --json-out tone_module/models/tone_cnn_p1_offline_eval.json

# 或使用预计算数组 JSON：{ "mel_batch": [...], "labels": [...] }
python -m tone_module.offline_tone_eval --artifact ... --eval-json path/to/eval.json --json-out out.json
```

### 3.4 部署烟测 E2E

```powershell
$env:TONE_MODEL_PATH = "...\tone_cnn_p2.npz"   # 须在启动 Electron Node 前设置
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
cd electron_node\electron-node
node tests/tone-v2-dialog200-batch.js `
  --session tone-v2-p2-d200 `
  --out experiments/tone-v2-p2-dialog200-batch-result.json `
  --max-minutes 15 `
  --wait-fw `
  --warmup-cases 3
```

---

## 4. Deprecated Scripts

| 脚本 | 状态 | 转发目标 |
|------|------|----------|
| `tone-v2-phase1-dialog200-batch.js` | **deprecated** 薄包装 | `tone-v2-dialog200-batch.js` + phase1 默认 session/out |
| `tone-v2-phase3-dialog200-batch.js` | **deprecated** 薄包装 | 同上（phase3 默认） |
| `tone-v2-phase4-p1-deploy-dialog200-batch.js` | **deprecated** 薄包装 | 同上（phase4/p1 默认 + `--wait-fw`） |

**DELETE（流程）：** 禁止再为每个 `modelVersion` 复制完整 E2E 主逻辑。

---

## 5. Runbook / SSOT Updates

| 文档 | 更新内容 |
|------|----------|
| `Tone_V2_Phase2_Deployment_Runbook.md` | §1.1 canonical `tone_cnn_p1` vs candidate p2/p3；完整 validate/offline/E2E 命令 |
| `TONE_V2_CONTRACT_FREEZE.md` §4 | Canonical / Candidate 表；强调 Loader 代码默认仍为 `tone_cnn_p0.npz` |
| `README.md` | Phase 6-A 工具表；Regression Gate 指向通用脚本 |

---

## 6. Expected / Actual / Impact

| ID | Expected | Actual | Impact | Action |
|----|----------|--------|--------|--------|
| E2E-01 | 单 SSOT 批脚本 | `tone-v2-dialog200-batch.js` 已建 | 消除 p2/p3 复制风险 | **MODIFY** ✅ |
| E2E-02 | 无默认 artifact 路径 | `TONE_MODEL_PATH` 仅 env 记录，无 p1 硬编码默认 | 避免误绑模型 | **KEEP** ✅ |
| TRN-01 | `--dataset-repo` CLI | 已加；默认 `CS5647Team3/data_mini` | 换数据集无需改源码 | **MODIFY** ✅ |
| TRN-02 | 现有 CLI 不变 | `--output` `--model-version` 等保留 | 无破坏 | **KEEP** ✅ |
| VAL-01 | validate CLI 包装原逻辑 | `python -m` + `--artifact` `--json-out` | 运维/CI 友好 | **MODIFY** ✅ |
| OFF-01 | offline CLI 复用 holdout | `load_val_holdout_features` + `--eval-json` | 可独立重跑离线 | **MODIFY** ✅ |
| DOC-01 | Runbook 钉 canonical p1 | 已更新 | 消除 p0 文档漂移 | **MODIFY** ✅ |
| CFG-01 | Loader 默认改 p1 | **未改** `config.py`/`loader.py` | 符合 P6-A 禁止改 Loader | **KEEP** ✅ |
| RT-01 | Runtime 不变 | grep 无改动 | 无架构影响 | **KEEP** ✅ |

---

## 7. KEEP / MODIFY / RESTORE / DELETE

### KEEP

- 全部 Runtime / Loader / Contract / Backend / Decision 冻结代码
- `validate_artifact` 四阶段核心逻辑
- `offline_tone_eval.run_offline_evaluation`
- 训练默认 `tone_cnn_p0` 文件名（须 CLI 显式覆盖）
- Registry/Switching/Hot Reload **禁止**

### MODIFY（本轮已完成）

- 通用 E2E 脚本 + deprecated 薄包装
- `train_tone_cnn` dataset CLI + holdout 导出函数
- `validate_artifact` / `offline_tone_eval` CLI
- Runbook · CONTRACT_FREEZE · README

### RESTORE

无。

### DELETE

- 为每个模型版本维护独立 E2E **主逻辑** 的做法（已收敛）

---

## 8. Regression Result

| 门禁 | 结果 |
|------|------|
| `unittest` phase2 + phase3 + loader | **28/28 PASS** |
| `python -m tone_module.validate_artifact` on `tone_cnn_p1.npz` | **PASS** |
| `python -m tone_module.offline_tone_eval` on `tone_cnn_p1.npz` | **PASS**（acc=0.7323, n=1808） |
| `train_tone_cnn --help` 含 `--dataset-repo` | **PASS** |
| 通用 E2E 脚本结构（flags 存在） | **PASS** |
| Live dialog_200 E2E（需 Node+FW） | **未执行**（环境未启动；脚本行为与 phase4 一致） |

---

## 9. Frozen Architecture Verification

```text
FW Worker → run_tone_inference → UtteranceResponse.tone
→ ctx.acousticToneSlices → Recall → Ranking → Assembly → KenLM → Apply
```

| 检查 | 结果 |
|------|------|
| Runtime / Loader / Contract 代码 diff | **无变更** |
| 新 CLI import Recall/Ranking/Assembly | **无** |
| E2E 脚本修改 Node pipeline API | **无**（仍 `run-pipeline-with-audio`） |
| Registry / Switching / 第二 Pipeline | **未引入** |
| `modelVersion` 进入 Decision | **无** |
| Offline/Validate 进入 Runtime Gate | **无** |

**结论：** 本轮仅工具链与文档；冻结运行链路与 Phase 6 预审计一致。

---

## 10. Architecture Drift Audit

| 区域 | Drift | Severity |
|------|-------|----------|
| Runtime Hop | 无 | — |
| Decision Ownership | 无 | — |
| Training → Decision 隔离 | 保持 | — |
| 工具链 SSOT | 已收敛（正向） | — |
| Loader 默认路径 vs canonical p1 | 文档已对齐；代码默认 p0 **KEEP**（须 env） | LOW |

**Material Drift：无**

---

## 11. 最终问题答复（开发后）

| # | 问题 | 答案 |
|---|------|------|
| 1 | 可否进入 P6-A 开发？ | 已完成 |
| 2 | 工具链 vs Runtime？ | 本轮仅前者 |
| 3 | 可否改 E2E 脚本？ | 已改（测试工具） |
| 4 | 可否改 train CLI？ | 已加 `--dataset-repo`/`--dataset-zip` |
| 5 | 可否加 validate/offline CLI？ | 已加 |
| 6 | 是否改 Contract/Loader/Runtime？ | **否** |
| 7 | P6-A 后可训 `tone_cnn_p2`？ | **是**（P6-B） |

---

## 12. Final Verdict

# **PASS**

P6-A 工具链泛化与文档同步按审计方案完成；回归门通过；冻结架构未漂移。可进入 **Phase 6-B：`tone_cnn_p2` 训练与候选模型验收**。

---

**签署：** Phase 6-A Development · 2026-06-29
