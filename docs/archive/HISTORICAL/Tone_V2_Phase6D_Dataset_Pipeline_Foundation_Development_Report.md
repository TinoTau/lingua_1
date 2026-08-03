<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase6D_Dataset_Pipeline_Foundation_Development_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 Phase 6-D — Dataset Pipeline Foundation 开发报告

**Date:** 2026-06-29  
**Task:** Dataset Pipeline Foundation — `DatasetAdapter` + `AlignmentProvider` + `CacheLayout`  
**Scope:** Training Foundation only（**非训练 p3** · **非 Runtime 开发**）  
**Status:** **FROZEN**（Phase 7-A）— [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)  
**依据:** [Tone_V2_Phase6D_Dataset_Pipeline_Foundation_PreDev_Audit_Report.md](./Tone_V2_Phase6D_Dataset_Pipeline_Foundation_PreDev_Audit_Report.md)  
**Final Verdict:** **PASS**

---

## Executive Summary

本轮将 `train_tone_cnn.py` 中写死的数据接入逻辑抽取为 **Training Foundation 内部扩展点**，冻结训练主链不变：

```text
DatasetAdapter → AlignmentProvider → SyllableSample[]
→ split_val_holdout_samples → extract_mel_features → MLP → npz
→ validate_artifact → offline_tone_eval
```

| 交付 | 状态 |
|------|------|
| `tone_module/dataset/` 契约与默认实现 | ✅ |
| `train_tone_cnn.py` 瘦身为编排器 | ✅ |
| `CacheLayout` 多 dataset/version 槽位 | ✅ |
| `data_mini` 行为回归（11820 音节 · split · 类别分布） | ✅ |
| `_train_mlp` metrics `dataset` 修复 | ✅ |
| Dataset metadata → artifact `notes` / `metrics` | ✅ |
| 单元测试 30/30 PASS | ✅ |
| `validate_artifact` / `offline_tone_eval` Unit Test gate | ✅ |
| Runtime / Loader / `contract.py` 未修改 | ✅ |

**未执行（按约束）：** AISHELL-3 全量下载 · Baker · 企业数据 · `tone_cnn_p3` 训练。

---

## Modified Files

| 文件 | 变更 |
|------|------|
| `tone_module/dataset/dataset_contract.py` | **新增** — `SyllableSample` · `DatasetManifest` · `DatasetMetadata` · 协议 |
| `tone_module/dataset/cache_layout.py` | **新增** — 版本化缓存槽 + manifest 读写 |
| `tone_module/dataset/alignment_textgrid.py` | **新增** — `TextGridPinyinAlignmentProvider`（默认实现） |
| `tone_module/dataset/adapter_hf_zip.py` | **新增** — `HuggingFaceZipDatasetAdapter`（data_mini） |
| `tone_module/dataset/pipeline.py` | **新增** — `load_syllable_samples` · `default_data_mini_pipeline` |
| `tone_module/dataset/__init__.py` | **新增** — 公共导出 |
| `tone_module/train_tone_cnn.py` | **MODIFY** — 移除 TextGrid/AISHELL/HF 硬编码；编排器 |
| `tone_module/test_phase6d_dataset.py` | **新增** — P6-D 回归门 |
| `tone_module/test_phase3_contracts.py` | **MODIFY** — `P0_MIN_SLICE_SEC` 检查迁至 alignment 模块 |
| `docs/tone-v2/README.md` | **MODIFY** — Phase 6-D Dataset Pipeline 索引 |

**未修改：** `contract.py` · `loader.py` · `mel.py` · `inference.py` · `classifier.py` · `numpy_p0.py` · `validate_artifact.py`（逻辑）· FW/Node Recall 链。

---

## Dataset Contract

```python
@dataclass(frozen=True)
class SyllableSample:
    wav_path: str
    start: float
    end: float
    label: int  # 0..4 => t1..t5

@dataclass
class DatasetMetadata:
    dataset_version: str
    source: str
    license: str
    alignment_provider: str
    speaker_count / utterance_count / syllable_count  # optional

@dataclass
class DatasetManifest:
    dataset_id: str
    version: str
    materialized_root: str
    metadata: DatasetMetadata
    alignment_source: str
```

**冻结的是 `SyllableSample` + P0 mel + 5-class label**；**不是** TextGrid 或 AISHELL 目录结构。

---

## DatasetAdapter / AlignmentProvider Design

| 组件 | 实现 | 职责 |
|------|------|------|
| **DatasetAdapter** | `HuggingFaceZipDatasetAdapter` | HF zip 下载/解压 · manifest 写入 · legacy 缓存回退 |
| **AlignmentProvider** | `TextGridPinyinAlignmentProvider` | wav+TextGrid basename 匹配 · pinyin+tone → label |
| **Pipeline** | `default_data_mini_pipeline()` | `adapter.materialize()` → `provider.collect_samples()` → `enrich_manifest_counts()` |

**后续扩展（本轮未实现）：**

- `OpenSlrAishell3DatasetAdapter` — AISHELL-3 全量
- `BakerDatasetAdapter` — 标贝
- `EnterpriseDatasetAdapter` — 企业真实数据
- 可选 `CtmAlignmentProvider` / `JsonAlignmentProvider`

---

## CacheLayout

```text
{cache_dir}/
  datasets/
    {dataset_id}/
      {version}/
        manifest.json
        materialized/     # 新解压根
        archives/         # zip 副本
  extracted/dataset/      # 仅 legacy 回退（data_mini）；非永久 SSOT
```

- **dataset_id:** `dataset_repo` → `CS5647Team3_data_mini`
- **version:** `v1`（默认）
- **命中逻辑:** 读 `manifest.json` + 校验 materialized_root 含 wav+TextGrid；否则 legacy 回退或重新 materialize
- **多源共存:** 不同 `dataset_id`/`version` 槽位路径隔离

---

## Migration Summary

| 原 `train_tone_cnn.py` 逻辑 | 迁移目标 |
|----------------------------|----------|
| `_parse_textgrid_intervals` | `alignment_textgrid.parse_textgrid_intervals` |
| `_tone_label_from_pinyin` | `alignment_textgrid.tone_label_from_pinyin` |
| `_index_wavs` + `_collect_samples` | `TextGridPinyinAlignmentProvider.collect_samples` |
| `_ensure_dataset` (HF + AISHELL marker) | `HuggingFaceZipDatasetAdapter.materialize` + `CacheLayout` |
| `SyllableSample` dataclass | `dataset_contract.SyllableSample`（经 `train_tone_cnn` 重导出） |

`train_tone_cnn.py` **不再包含:** `.TextGrid` · `AISHELL-3` · `huggingface_hub` · `_parse_textgrid_intervals`。

---

## Behavior Compatibility Result

| 指标 | P6-C 基线 | P6-D 实测 | 结果 |
|------|-----------|-----------|------|
| 总音节数 | 11,820 | **11,820** | **PASS** |
| train / val (seed=42, 15%) | 10,012 / 1,808 | **10,012 / 1,808** | **PASS** |
| 类别分布 t1–t5 | 2570/2702/1716/4314/518 | **一致** | **PASS** |
| utteranceCount | 466 | **466** | **PASS** |
| speakerCount | 2 | **2** | **PASS** |
| `featureVersion` | `p0-v1` | `p0-v1`（fixture training artifact） | **PASS** |
| `validate_artifact` | PASS | PASS（p1 + fixture train） | **PASS** |
| `offline_tone_eval` holdout | 1,808 samples | **1,808** mel rows | **PASS** |

---

## Regression Result

```text
python -m unittest tone_module.test_phase3_contracts tone_module.test_phase6d_dataset tone_module.test_loader -q
→ Ran 30 tests in ~12s — OK
```

| 门 | 结果 |
|----|------|
| Phase 3 contract gates | **PASS**（16） |
| Phase 6-D dataset gates | **PASS**（11） |
| Loader fail-closed | **PASS**（5） |
| `train_tone_cnn` 1-epoch fixture train + `validate_artifact` | **PASS** |
| `offline_tone_eval` on `tone_cnn_p1.npz` | **PASS** — acc=0.7323 · n=1808 |
| `validate_artifact` on `tone_cnn_p1.npz` | **PASS** |

---

## Frozen Architecture Verification

### 训练主链（未变）

```text
DatasetAdapter / AlignmentProvider → SyllableSample[]
→ split → mel → MLP → npz → validate_artifact → offline → (deploy) → E2E
```

### Runtime 边界

| 检查 | 结果 |
|------|------|
| `contract.py` 未改 | ✅ |
| `loader.py` Required schema 未改 | ✅ |
| `mel.py` / `numpy_p0.py` 未改 | ✅ |
| `inference.py` / `classifier.py` 未改 | ✅ |
| dataset 模块无 Decision import | ✅ 测试覆盖 |
| `datasetVersion` / `notes` 仅 diagnostics | ✅ Loader 不用于决策 |
| 第二训练链路 | ✅ 无 |
| Registry / Switching / Shadow | ✅ 无 |

---

## Architecture Drift Audit

| 区域 | Expected | Actual | Impact | Action |
|------|----------|--------|--------|--------|
| 单训练入口 | `train_tone_cnn` | 仍为唯一入口 | 无 | **KEEP** |
| TextGrid 作为架构 SSOT | 禁止 | 降为默认 Provider | 正确解耦 | **KEEP** |
| Adapter 可插拔 | P6-D 目标 | 协议 + 默认实现 | 达成 | **KEEP** |
| legacy 缓存兼容 | data_mini 不回归 | legacy `extracted/dataset` 回退 | 无重下载 | **KEEP** |
| Artifact Required Schema | 不变 | Unit Test 验证 w1..b2 + featureVersion | 无 | **KEEP** |
| 训练 metadata 扩展 | optional only | `notes` JSON + `metrics` 字段 | 不进 Runtime | **KEEP** |

**Material Drift：无**

---

## KEEP / MODIFY / RESTORE / DELETE

| 处置 | 项 |
|------|-----|
| **KEEP** | 训练主链 · `split_val_holdout_samples` · `validate_artifact` 门禁 · Runtime 全栈 |
| **KEEP** | `TextGridPinyinAlignmentProvider` 为 **默认** 对齐实现（非架构） |
| **KEEP** | `data_mini` legacy 缓存回退 |
| **MODIFY** | 新增 `tone_module/dataset/*` · 瘦身 `train_tone_cnn.py` |
| **MODIFY** | `CacheLayout` 多槽 · manifest · dataset metadata |
| **MODIFY** | `test_phase3_contracts` · 新增 `test_phase6d_dataset` · README |
| **RESTORE** | — |
| **DELETE** | `train_tone_cnn` 内 AISHELL marker / TextGrid walk / HF 下载硬编码 |

---

## Remaining Risks

| 风险 | 等级 | 缓解 |
|------|------|------|
| AISHELL-3 全量需新 `OpenSlrAishell3DatasetAdapter` | MED | P6-C 已规划；不阻塞 P6-D |
| 全量数据训练内存/耗时 | MED | 后续 feature shard 缓存（非本轮） |
| legacy `extracted/dataset` 与新槽并存 | LOW | manifest 优先；文档注明迁移路径 |
| 企业数据对齐格式多样 | MED | 新 Provider；不改主链 |

---

## Final Verdict

# **PASS**

Phase 6-D Dataset Pipeline Foundation **已落地**：后续 AISHELL-3 / Baker / 企业数据可通过 **新增 Adapter +（必要时）AlignmentProvider** 接入，**无需再修改** `train_tone_cnn` 训练主链、Artifact Required Schema、Validation Pipeline 或 Runtime。

**明确不在本轮范围：** 全量数据下载与 `tone_cnn_p3` 训练 — 属后续 Phase 任务。
