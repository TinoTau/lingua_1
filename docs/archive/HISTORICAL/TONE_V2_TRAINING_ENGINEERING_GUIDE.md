<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/TONE_V2_TRAINING_ENGINEERING_GUIDE.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 — Training Engineering Guide（运维）

**Scope:** Training Foundation IO only — **非 Runtime** · **非 Dataset Foundation 修改**  
**SSOT：** [TONE_V2_TRAINING_ENGINEERING_FREEZE.md](./TONE_V2_TRAINING_ENGINEERING_FREEZE.md)  
**上游数据层：** [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md) · [Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Runbook.md](./Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Runbook.md)  
**术语：** [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md)

---

## 1. Training IO 主链（必读）

```text
SyllableSample[]          ← Dataset Foundation（probe_aishell3 accept）
    ↓
Feature Shard             ← build-feature-shards
    ↓
Shard Reader
    ↓
Sequential Feature Reader
    ↓
Mini-batch Reader
    ↓
train_tone_cnn train
```

**禁止术语：** Streaming Feature · Streaming Training — 使用 **Sequential Feature Reader** · **Mini-batch Reader**。

---

## 2. 前置条件

1. **Dataset Level 2 已通过：** `python -m tone_module.dataset.probe_aishell3 accept --skip-download`
2. 工作目录：`electron_node/services/faster_whisper_vad`
3. Canonical cache 槽：`tone_module/_data_cache/datasets/openslr_aishell3/v1/`

---

## 3. 构建 Canonical Feature Shard

**推荐（探针封装）：**

```powershell
cd electron_node/services/faster_whisper_vad
python -m tone_module.training_io.probe_feature_shard build `
  --cache-dir tone_module/_data_cache `
  --build-report-json tone_module/_data_cache/datasets/openslr_aishell3/v1/phase7b2_build_report.json
```

**等效底层：**

```powershell
python -m tone_module.train_tone_cnn build-feature-shards `
  --dataset aishell3 --holdout speaker --skip-download
```

**产出：** `training_features/shard_manifest.json` + `shard_000.npz` … `shard_020.npz`  
**规模参考（P7-B2）：** 997,992 样本 · 21 shard · ~332 MB · ~36 min（本机 CPU）

---

## 4. Training IO Validation（accept）

```powershell
python -m tone_module.training_io.probe_feature_shard accept `
  --cache-dir tone_module/_data_cache `
  --acceptance-json tone_module/_data_cache/datasets/openslr_aishell3/v1/phase7b2_acceptance.json
```

**验收内容：** manifest 完整性 · speaker holdout 计数 · Mini-batch 完整 epoch · 无 `audio_cache` 反模式。

---

## 5. 训练入口

### Regression Fixture（默认 · CI）

```powershell
python -m tone_module.train_tone_cnn train --help
# 默认 data_mini · 不经 Canonical shard
```

### Canonical（显式）

```powershell
python -m tone_module.train_tone_cnn train `
  --dataset aishell3 --holdout speaker --skip-download --skip-shard-build
```

> 首次训练若无 shard，须先 `build-feature-shards` 或省略 `--skip-shard-build`。

### Pilot（B1 证据）

小规模 shard + `_pilot_phase7b1_io.npz` — 见 B1 Development Report；**非**生产 Canonical。

---

## 6. 回归门（开发 / CI）

```powershell
python -m unittest tone_module.test_phase7b1_training_io tone_module.test_phase7b2_canonical_feature_shard tone_module.test_phase6d_dataset tone_module.test_phase6e_aishell3 -q
```

---

## 7. 与 Runtime Validation 边界

| 类型 | 入口 | 用途 |
|------|------|------|
| **Dataset Probe**（L2） | `probe_aishell3` | SyllableSample · join · 统计 |
| **Training IO Validation** | `probe_feature_shard accept` | Feature Shard · Reader · holdout |
| **Runtime Validation**（L3） | `TONE_MODEL_PATH` → FW → Node E2E | 部署主链 |

**不得混用：** Training IO Validation **不**证明 Recall · Decision · `effective_chain`。

---

## 8. 故障排查

| 现象 | 检查 |
|------|------|
| build OOM / 极慢 | 确认未走全量 `audio_cache`；应走 Feature Shard 构建 |
| accept 计数不符 | 重跑 `probe_aishell3 accept`；比对 `phase7a_acceptance.json` |
| digest 变化 | 语料或 mel contract 变更；须 Dataset / Contract 再冻结后重建 |
| 默认训练变成 aishell3 | **违规** — 默认须保持 `data_mini` |

---

*Training Engineering Guide — operational only; schema changes require Training Engineering refreeze.*
