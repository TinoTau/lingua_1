# Tone V2 — Dataset Foundation Freeze（SSOT）

**状态：** FROZEN  
**生效：** 2026-06-29（Phase 7-A Close）  
**优先级：** Training Foundation 数据层 **唯一 SSOT**；与 [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)（Runtime · Artifact）并列。  
**术语：** [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md) · [TONE_V2_DOCUMENTATION_STYLE_GUIDE.md](./TONE_V2_DOCUMENTATION_STYLE_GUIDE.md)  
**证据：** [Tone_V2_Phase7A_AISHELL3_Full_Dataset_Acceptance_Report.md](./Tone_V2_Phase7A_AISHELL3_Full_Dataset_Acceptance_Report.md) · [Tone_V2_Phase7A_Dataset_Foundation_Freeze_Report.md](./Tone_V2_Phase7A_Dataset_Foundation_Freeze_Report.md)

> 修改本文档所列 **冻结组件** 须走 **Dataset Foundation 再冻结** 流程。  
> **不得**以训练工程化（Feature Shard / Reader / Speaker Holdout）为由修改 Dataset Foundation。

---

## 1. 冻结范围（Frozen Scope）

以下构成 Tone V2 **唯一 Dataset Foundation SSOT**，**禁止直接修改**（bugfix 除外须走再冻结）：

| 组件 | 代码锚点 | 职责 |
|------|----------|------|
| **Dataset Contract** | `tone_module/dataset/dataset_contract.py` | `SyllableSample` · `DatasetManifest` · `DatasetMetadata` · `DatasetAdapter` / `AlignmentProvider` 协议 · `enrich_manifest_counts` |
| **CacheLayout** | `tone_module/dataset/cache_layout.py` | `{cache}/datasets/{dataset_id}/{version}/` 槽位 · manifest 读写 · materialized 有效性 |
| **Materialize** | 各 `DatasetAdapter.materialize()` | 下载/解压/链接 · 幂等 marker · 写 manifest |
| **默认 AlignmentProvider** | `tone_module/dataset/alignment_textgrid.py` | `TextGridPinyinAlignmentProvider`（`textgrid_pinyin_v1`） |
| **data_mini Adapter** | `tone_module/dataset/adapter_hf_zip.py` | `HuggingFaceZipDatasetAdapter` |
| **AISHELL-3 Adapter** | `tone_module/dataset/adapter_openslr_aishell3.py` | `OpenSlrAishell3DatasetAdapter` |
| **Pipeline 编排** | `tone_module/dataset/pipeline.py` | `load_syllable_samples` · `default_data_mini_pipeline` · `aishell3_pipeline` |
| **Dataset Probe** | `tone_module/dataset/probe_aishell3.py` | `materialize` · `join-audit` · `stats` · **`accept`**（Level 2 一体化验收） |
| **Join Audit** | `probe_aishell3.audit_join` | wav/TextGrid basename 匹配率 |
| **Dataset Statistics Probe** | `probe_aishell3` `stats` / `accept` | 音节 · t1–t5 · invalid token |
| **Fixture / 回归门** | `test_phase6d_dataset.py` · `test_phase6e_aishell3.py` | data_mini 基线 · AISHELL fixture · 冻结层 SHA256 |

**不在 Dataset Foundation 冻结内（属 Training Engineering · Phase 7-B · FROZEN）：** Feature Shard · Shard Reader · Speaker Holdout · `train_tone_cnn` 编排 — 见 [TONE_V2_TRAINING_ENGINEERING_FREEZE.md](./TONE_V2_TRAINING_ENGINEERING_FREEZE.md)。

---

## 2. 数据集角色（统一定义）

| 角色 | 数据集 | `dataset_id` | 用途 |
|------|--------|--------------|------|
| **Current Canonical Training Dataset** | AISHELL-3 全量（OpenSLR SLR93 + lars76 TextGrid） | `openslr_aishell3` | **当前**正式大规模训练语料；经 P7-A Level 2 全量验收 |
| **Regression Fixture** | `CS5647Team3_data_mini` | `CS5647Team3_data_mini` | CI · Unit Test · 快速 Dataset Probe · 训练编排回归 |

### 禁止表述

| 禁止 | 正名 |
|------|------|
| 「AISHELL-3 是唯一训练数据源」 | **Current Canonical Training Dataset**（当前规范训练集；**可**被未来数据集替代或并列，须新 Adapter） |
| 「项目只有一个 Dataset」指唯一语料 | **一个 Dataset Foundation**（框架 SSOT）；语料槽可多个 |
| Shadow Dataset / 第二 Dataset Pipeline | **Historical Issue** — 仅允许 **新 Adapter + Provider** 扩展 |

### 未来扩展（冻结后允许）

新语料（**示例**：Baker · 企业数据 · 用户数据）**只能**：

```text
新增 DatasetAdapter（+ 必要时新增 AlignmentProvider）
→ 新 cache 槽 {datasets}/{new_id}/{version}/
→ Level 2 Dataset Probe 验收
```

**不得**修改：`dataset_contract.py` · `cache_layout.py` · 既有 Adapter/Provider 语义 · Probe 框架门禁逻辑（除非再冻结）。

---

## 3. 数据层主链（冻结）

```text
DatasetAdapter.materialize(cache_dir)
    → DatasetManifest（materialized_root + metadata）
AlignmentProvider.collect_samples(materialized_root)
    → List[SyllableSample]
enrich_manifest_counts(manifest, samples)
```

**下游（Training Engineering · 非本 SSOT 冻结体）：**

```text
SyllableSample[]
    → Feature Shard（见 TONE_V2_TRAINING_ENGINEERING_FREEZE.md）
    → Shard Reader → Sequential Feature Reader → Mini-batch Reader
    → train_tone_cnn train → npz → validate_artifact
```

Dataset Foundation **不** import Runtime · Decision · `inference` · `classifier`。

---

## 4. Current Canonical Training Dataset（AISHELL-3）

| 项 | 值（P7-A 全量实测） |
|----|---------------------|
| Cache 槽 | `{cache}/datasets/openslr_aishell3/v1/` |
| Speakers | **218** |
| Utterances | **88,035** |
| Syllables（pinyin+tone 过滤后） | **997,992** |
| wav join rate | **100%** |
| `dataset_version` | `openslr_slr93_full` |
| `alignment_source` | `lars76_aishell3_textgrid` |
| 验收 JSON | `tone_module/_data_cache/datasets/openslr_aishell3/v1/phase7a_acceptance.json` |

**音频：** [OpenSLR SLR93](https://www.openslr.org/93/) · **对齐：** [lars76 forced-alignment-chinese](https://github.com/lars76/forced-alignment-chinese) `releases/latest/download/aishell3_textgrid_files.zip`

---

## 5. Regression Fixture（data_mini）

| 项 | 冻结基线值 |
|----|------------|
| Cache 槽 | `{cache}/datasets/CS5647Team3_data_mini/v1/` |
| Syllables | **11,820** |
| Utterances | **466** |
| Train / Val（15% · seed=42） | **10,012 / 1,808** |
| 类分布（t1..t5 计数） | 2570 · 2702 · 1716 · 4314 · 518 |
| `train_tone_cnn` 默认 pipeline | `default_data_mini_pipeline`（**CI 默认不变**） |

**用途：** 证明 Dataset Foundation 变更未破坏契约；**不**代表生产全量训练规模。

---

## 6. Level 2 Dataset Probe（冻结入口）

**唯一 CLI SSOT：** `python -m tone_module.dataset.probe_aishell3`

| 子命令 | 职责 |
|--------|------|
| `materialize` | 下载/解压 · manifest |
| `join-audit` | Join Audit |
| `stats` | Dataset Statistics Probe |
| `accept` | 一体化验收：Materialize → Join → Statistics → Manifest/License/Contract → Gates |

**门禁（全量 `accept` · P7-A 校准）：**

| Gate | 阈值 |
|------|------|
| wav_join_rate | ≥ 0.99 |
| speaker_count | 218 ± 2 |
| utterance_count | 88,035 ± 200 |
| syllable_count | ≥ 950,000（pinyin 音节；非 MFA 音素 interval 总数） |

**不得**将 Dataset Probe 当作 Runtime Validation（Level 3）。

---

## 7. 允许 / 禁止修改（Freeze 后）

| 允许 | 禁止（须 Dataset Foundation 再冻结） |
|------|----------------------------------------|
| **新增** `DatasetAdapter` 实现 | 修改 `SyllableSample` / Manifest 必填字段语义 |
| **新增** `AlignmentProvider` 实现（若格式不同） | 修改 `CacheLayout` 槽路径约定 |
| 新语料 Level 2 Probe 验收报告 | 修改 `TextGridPinyinAlignmentProvider` 解析语义（除非证明与 Canonical 不兼容且走再冻结） |
| 运维：本地路径 env 覆盖下载 | 第二 Dataset Pipeline · 旁路 Probe 入口 |
| 训练编排接入 Training Engineering | 为训练便利修改 Contract / Materialize / Join 逻辑 |

---

## 8. Regression Gate（Dataset Foundation）

```powershell
cd electron_node/services/faster_whisper_vad
python -m unittest tone_module.test_phase3_contracts tone_module.test_phase6d_dataset tone_module.test_phase6e_aishell3 -q
```

| 门 | 期望 |
|----|------|
| `test_phase6d_dataset` | data_mini 11,820 · split · 类分布不变 |
| `test_phase6e_aishell3` | Fixture Test · `accept` fixture · 冻结层 SHA256 |
| 全量 Canonical（运维） | `probe_aishell3 accept --skip-download` → **PASS** |

---

## 9. 相关文档

| 文档 | 关系 |
|------|------|
| [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md) | Runtime · Artifact · Feature Baseline |
| [TONE_V2_TRAINING_ENGINEERING_FREEZE.md](./TONE_V2_TRAINING_ENGINEERING_FREEZE.md) | 下游 Training IO（正交） |
| [Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Runbook.md](./Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Runbook.md) | 运维 Runbook（已并入本 SSOT） |
| [README.md](./README.md) | 文档索引 |

---

*Dataset Foundation Freeze — no Runtime / Training Pipeline code changes in freeze round.*
