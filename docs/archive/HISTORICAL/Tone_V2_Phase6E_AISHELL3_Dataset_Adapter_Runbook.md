<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Runbook.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 Phase 6-E / 7-A — AISHELL-3 Dataset Runbook

**Scope:** Training Foundation only — **非 Runtime** · **非 `tone_cnn_p3` 训练**  
**Dataset Foundation SSOT（FROZEN）：** [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)  
**P7-A 全量验收：** [Tone_V2_Phase7A_AISHELL3_Full_Dataset_Acceptance_Report.md](./Tone_V2_Phase7A_AISHELL3_Full_Dataset_Acceptance_Report.md)

**术语：** AISHELL-3 = **Current Canonical Training Dataset**（**非**「唯一训练数据源」措辞）。

---

## 术语说明（必读）

### Runtime Validation（运行时验收）

仅指部署后主链验收，**与 Dataset Probe 不得混用**：

```text
TONE_MODEL_PATH
    ↓
FW Restart
    ↓
Node E2E（dialog_200 等）
```

用于：Runtime 未回归 · `effective_chain` · 无 `model_error`。  
**不得**用 Dataset Probe 替代 Runtime Validation。

### Dataset Probe（数据集探针）

仅指 Training Foundation 数据层验证，**不参与 Runtime / Decision**：

```text
Dataset Adapter
    ↓
Alignment Provider
    ↓
SyllableSample[]
    ↓
Statistics / Join Audit
```

**参与：** materialize · manifest · wav/TextGrid join · 音节统计 · `SyllableSample` 契约。  
**不参与：** Runtime · Recall · Ranking · Assembly · KenLM · Apply · Node Decision。

**不得用于：** Runtime 验收 · 模型质量验收 · 主链（FW → Node E2E）验收。

| 子类型 | 含义 |
|--------|------|
| **Dataset Probe** | `probe_aishell3` 通用探针（materialize / stats / join-audit） |
| **Limited Dataset Probe** | 带 `--max-utterances` / `--max-speakers` 限流的 probe |
| **Local Dataset Probe** | 使用 `AISHELL3_LOCAL_*` 或本地路径的 probe |
| **Join Audit** | `join-audit` 子命令 — basename 匹配率与缺失样例 |
| **Dataset Statistics Probe** | `stats` 子命令 — 音节数与 t1–t5 分布 |
| **Fixture Test** | 合成 fixture 单测 — manifest 幂等与契约 |

---

## 数据源

| 资产 | 来源 | 许可 |
|------|------|------|
| **音频** | OpenSLR [SLR93](https://www.openslr.org/93) · `data_aishell3.tgz`（~19 GB） | Apache License 2.0 |
| **TextGrid** | [lars76/forced-alignment-chinese](https://github.com/lars76/forced-alignment-chinese/releases/latest/download/aishell3_textgrid_files.zip) | 见上游仓库 LICENSE |

官方 AISHELL-3 **不提供** syllable-level TextGrid；必须使用外接 MFA 对齐产物。

---

## Cache Layout

```text
{tone_module/_data_cache}/datasets/openslr_aishell3/v1/
  manifest.json
  archives/
    data_aishell3.tgz
    aishell3_textgrid_files.zip
  materialized/
    audio/          # OpenSLR 解压树（含 train/wav/SSB*/…）
    alignment/      # lars76 TextGrid 解压树
```

`materialized_root` 指向 `materialized/` 父目录；`TextGridPinyinAlignmentProvider` 在子树内按 **wav/TextGrid basename** join。

---

## 环境变量（可选）

| 变量 | 用途 |
|------|------|
| `OPENSRL_AISHELL3_TGZ` | 本地 `data_aishell3.tgz` 路径 |
| `AISHELL3_TEXTGRID_ZIP` | 本地 `aishell3_textgrid_files.zip` 路径 |
| `AISHELL3_LOCAL_AUDIO_ROOT` | Local Dataset Probe 用已解压音频根 |
| `AISHELL3_LOCAL_TEXTGRID_ROOT` | Local Dataset Probe 用已解压 TextGrid 根 |

---

## Probe CLI（P6-E Dataset Probe 入口）

在 `electron_node/services/faster_whisper_vad/` 下执行：

```bash
# 1) 仅 materialize（本地 tgz + zip，跳过下载）
python -m tone_module.dataset.probe_aishell3 materialize \
  --cache-dir tone_module/_data_cache \
  --openslr-tgz D:/data/data_aishell3.tgz \
  --textgrid-zip D:/data/aishell3_textgrid_files.zip \
  --skip-download

# 2) 已解压目录接入
python -m tone_module.dataset.probe_aishell3 materialize \
  --cache-dir tone_module/_data_cache \
  --local-audio-root D:/data/aishell3/audio \
  --local-textgrid-root D:/data/aishell3/textgrid \
  --skip-download

# 3) Join Audit（Limited Dataset Probe）
python -m tone_module.dataset.probe_aishell3 join-audit \
  --cache-dir tone_module/_data_cache \
  --local-audio-root ... \
  --local-textgrid-root ... \
  --skip-download \
  --max-utterances 500 \
  --json-out probe_join.json

# 4) Dataset Statistics Probe（限流，不训练）
python -m tone_module.dataset.probe_aishell3 stats \
  --cache-dir tone_module/_data_cache \
  --local-audio-root ... \
  --local-textgrid-root ... \
  --skip-download \
  --max-speakers 5 \
  --max-utterances 200 \
  --json-out probe_stats.json
```

### 子命令

| 命令 | 作用 |
|------|------|
| `materialize` | 下载/解压 · 写 `manifest.json` |
| `join-audit` | Join Audit — wav/TextGrid basename 匹配率 · 缺失样例 |
| `stats` | Dataset Statistics Probe — 音节数 · t1–t5 分布 · invalid token 计数 |
| `accept` | **Full Dataset Acceptance** — 一体化 Level 2 验收 + Gates + JSON |

### 全量验收（P7-A · Canonical）

```bash
python -m tone_module.dataset.probe_aishell3 accept \
  --cache-dir tone_module/_data_cache \
  --skip-download \
  --json-out tone_module/_data_cache/datasets/openslr_aishell3/v1/phase7a_acceptance.json
```

期望：`final_verdict` = **PASS** · wav_join_rate ≥ 0.99 · syllable_count ≥ 950,000。

---

## Pipeline 编程入口

```python
from tone_module.dataset import aishell3_pipeline

samples, manifest = aishell3_pipeline(
    cache_dir,
    local_audio_root="...",
    local_textgrid_root="...",
    skip_download=True,
)
```

数据层主链：`OpenSlrAishell3DatasetAdapter` → `TextGridPinyinAlignmentProvider` → `SyllableSample[]`。  
**注意：** 以上为 Dataset 层；完整训练主链在 `train_tone_cnn`（默认仍 `data_mini`）。

---

## P6-E 边界（必须遵守）

- **不得**训练 `tone_cnn_p3` 或生成 `tone_cnn_p3.npz`
- **不得**对全量语料跑 `_build_feature_matrix`
- **不得**修改 `contract.py` / `loader.py` / `validate_artifact.py` / Runtime
- **不得**将 Dataset Probe 当作 Runtime Validation 或模型质量验收
- `train_tone_cnn.py` **默认仍为** `data_mini`；全量训练属后续 p3 轮次

---

## p3 训练前必要工程化（非 P6-E）

全量 ~200 万音节在当前 `train_tone_cnn._build_feature_matrix`（全文件 `sf.read` + `audio_cache`）下 **内存不可接受**。p3 前须另行实现：

- feature shard / memmap 缓存，或
- utterance 级惰性 mel + mini-batch 生成，及
- （建议）speaker-stratified val holdout

---

## 回归测试

```bash
cd electron_node/services/faster_whisper_vad
python -m unittest tone_module.test_phase3_contracts tone_module.test_phase6d_dataset tone_module.test_phase6e_aishell3 -q
```

可选 Local Dataset Probe（需设置环境变量）：

```bash
set AISHELL3_LOCAL_AUDIO_ROOT=D:\data\aishell3\audio
set AISHELL3_LOCAL_TEXTGRID_ROOT=D:\data\aishell3\textgrid
python -m unittest tone_module.test_phase6e_aishell3.OptionalLocalAishellDatasetProbeTest -q
```

---

## Training Engineering（Phase 7-B · 下游 · FROZEN）

Dataset Probe（Level 2）通过后，训练 IO 由 **独立 SSOT** 管辖 — **不是** Dataset Probe：

```text
SyllableSample[]
    → Feature Shard
    → Shard Reader → Sequential Feature Reader → Mini-batch Reader
    → train_tone_cnn train
```

**SSOT / Runbook：** [TONE_V2_TRAINING_ENGINEERING_FREEZE.md](./TONE_V2_TRAINING_ENGINEERING_FREEZE.md) · [TONE_V2_TRAINING_ENGINEERING_GUIDE.md](./TONE_V2_TRAINING_ENGINEERING_GUIDE.md)

**快速命令：**

```powershell
python -m tone_module.training_io.probe_feature_shard build --cache-dir tone_module/_data_cache
python -m tone_module.training_io.probe_feature_shard accept --cache-dir tone_module/_data_cache
```

**术语：** **Training IO Validation**（`probe_feature_shard accept`）**不是** Runtime Validation（Level 3）。

---

## 相关文档

- [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)
- [TONE_V2_TRAINING_ENGINEERING_FREEZE.md](./TONE_V2_TRAINING_ENGINEERING_FREEZE.md)
- [Tone_V2_Phase7B_Training_Engineering_Freeze_Report.md](./Tone_V2_Phase7B_Training_Engineering_Freeze_Report.md)
- [Tone_V2_Phase7A_Dataset_Foundation_Freeze_Report.md](./Tone_V2_Phase7A_Dataset_Foundation_Freeze_Report.md)
- [Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_PreDev_Audit_Report.md](./Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_PreDev_Audit_Report.md)
- [Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Development_Report.md](./Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Development_Report.md)
- [Tone_V2_Phase6E_Documentation_Alignment_Report.md](./Tone_V2_Phase6E_Documentation_Alignment_Report.md)
