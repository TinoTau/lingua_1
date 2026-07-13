# Tone V2 Phase 4 — Fixed-Config Training Report

**Date:** 2026-06-29  
**Task:** 固定配置训练 · 生成 `tone_cnn_p1.npz`  
**Scope:** Model Quality Development（**非 Runtime 开发**）  
**Final Verdict:** **PASS**

---

## 1. Training Config（固定 · 禁止调参）

| 参数 | 固定值 |
|------|--------|
| `featureVersion` | `p0-v1` |
| `modelVersion` | `tone_cnn_p1` |
| `trainingVersion` | `2026-06-29`（UTC 训练日） |
| `backend` | `numpy_p0` |
| `formatVersion` | `npz-v1` |
| **output** | `electron_node/services/faster_whisper_vad/tone_module/models/tone_cnn_p1.npz` |
| `epochs` | 80（默认） |
| `batch_size` | 128（默认） |
| `learning_rate` | 0.05（默认） |
| `val_ratio` | 0.15（默认） |
| `seed` | 42（默认） |
| 网络结构 | P0 MLP：80 → 32 ReLU → 5 softmax（`contract.P0_*`） |
| 特征 | `extract_mel_features`（`contract.py` SSOT） |
| 开源权重 | **未使用**（无 ToneNet / Mandarin-Tone-Classification 转换） |

**执行命令：**

```powershell
cd D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad
python -m tone_module.train_tone_cnn `
  --output tone_module/models/tone_cnn_p1.npz `
  --model-version tone_cnn_p1
```

---

## 2. Dataset Source

| 项 | 值 |
|----|-----|
| 仓库 | HuggingFace `CS5647Team3/data_mini` |
| 内容 | AISHELL-3 wav + TextGrid（拼音+声调） |
| 本地缓存 | `tone_module/_data_cache/` |
| 音节样本 | **11,820** total |
| 训练 / 验证 | **10,012** / **1,808**（utterance 级 15% holdout） |

---

## 3. Training Metrics

| 指标 | 值 |
|------|-----|
| `train_acc` | **0.780** |
| `val_acc` | **0.732** |
| `adapter_acc`（`infer_batch` on val raw mel） | **0.7323** |
| `offline_acc` | **0.732**（1,808 samples） |
| `confidence_mean`（offline val） | **0.763** |
| 训练耗时 | ~42 s（80 epochs） |
| Epoch 日志 | 1→0.455 · 40→0.707 · 80→0.732 val |

> `val_acc` 仅作训练观测；**部署门禁以 `validate_artifact.passed` 为准**（Addendum II §5）。

---

## 4. Artifact

| 项 | 值 |
|----|-----|
| **Path** | `D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\tone_module\models\tone_cnn_p1.npz` |
| **Size** | 15,760 bytes |
| **SHA256** | `8b22ba13fc9ea32f0b8138294348fb786273b11150b38a4b2193fd0966f1a194` |

### Artifact Metadata（npz 内）

| 字段 | 值 |
|------|-----|
| `featureVersion` | `p0-v1` |
| `modelVersion` | `tone_cnn_p1` |
| `trainingVersion` | `2026-06-29` |
| `backend` | `numpy_p0` |
| `formatVersion` | `npz-v1` |
| `buildTime` | `2026-06-29T10:32:34Z` |
| `datasetVersion` | `CS5647Team3/data_mini` |

### Required Weights

| 张量 | Shape |
|------|-------|
| `w1` | (80, 32) |
| `b1` | (32,) |
| `w2` | (32, 5) |
| `b2` | (5,) |
| `mel_mean` / `mel_std` | (80,) each |

**TonePosterior：** 5 类 softmax，经 `numpy_p0.infer_batch` 输出 `(N, 5)`。

---

## 5. validate_artifact Result

**训练结束自动执行 + 报告复核：**

```text
validation=PASS | schema=True | shape=True | loader=True | adapter=True | adapter_acc=0.7323
```

| 阶段 | 结果 |
|------|------|
| Schema Validation | **PASS** |
| Shape Validation | **PASS** |
| Loader.load(path) | **PASS** |
| Runtime Adapter (`infer_batch`) | **PASS** |
| **Artifact Acceptance** | **PASS** |

**部署判定：** `validate_artifact` **通过** — artifact **允许**进入后续 `TONE_MODEL_PATH` 部署流程（须重启 FW · 非本轮执行）。

---

## 6. Expected / Actual / Impact

| ID | Expected | Actual | Impact | 处置 |
|----|----------|--------|--------|------|
| P4-TRAIN-01 | 固定默认结构训练 p1 | 80 epoch P0 MLP 完成 | 无 | **KEEP** |
| P4-META-01 | `modelVersion=tone_cnn_p1` | npz 内 `tone_cnn_p1` | 无 | **KEEP** |
| P4-META-02 | `trainingVersion=当前日期` | `2026-06-29` | 无 | **KEEP** |
| P4-VAL-01 | 训练后自动 `validate_artifact` | PASS | 无 | **KEEP** |
| P4-CLI-01 | 使用现有 `train_tone_cnn.py` | 增加 `--model-version` / `--training-version` 仅 metadata | 元数据 CLI；**未改训练结构** | **MODIFY**（训练脚本 metadata 参数） |
| Runtime | 不修改 | 未触碰 | 无 | **KEEP** |
| 开源权重 | 不引入 | 未引入 | 无 | **KEEP** |

**RESTORE：** 无  
**DELETE：** 无

---

## 7. Frozen Boundary Confirmation

| 禁止修改项 | 本轮状态 |
|-----------|----------|
| Runtime / Loader / Contract / Feature Baseline | **未修改** |
| Recall / Ranking / Assembly / KenLM / Apply | **未修改** |
| `numpy_p0` Backend Adapter | **未修改** |
| Registry / Switching / Multi-Model | **未引入** |

---

## 8. Final Verdict

# **PASS**

- `tone_cnn_p1.npz` 已生成并通过 **Artifact Validation**  
- 固定配置与 Phase 3 Training Foundation 一致  
- **未部署**至 Runtime（部署属运维 Runbook · 需 `TONE_MODEL_PATH` + FW 重启）

### 建议后续（非本轮训练阻塞）

1. 按 [Tone_V2_Phase2_Deployment_Runbook.md](./Tone_V2_Phase2_Deployment_Runbook.md) 部署 `tone_cnn_p1.npz`  
2. Node E2E Runtime Validation（验证 Runtime 未回归）  
3. Offline / dialog_200 模型质量观测（**非** Foundation 阻塞项）

---

**训练日志摘要：** exit_code=0 · elapsed ~42s · `offline_acc=0.732 samples=1808 conf_mean=0.763`
