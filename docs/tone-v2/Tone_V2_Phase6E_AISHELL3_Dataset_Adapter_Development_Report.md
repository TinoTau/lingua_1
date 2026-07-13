# Tone V2 Phase 6-E — AISHELL-3 Dataset Adapter 开发报告

**Date:** 2026-06-29  
**Task:** AISHELL-3 Dataset Adapter 接入 — `OpenSlrAishell3DatasetAdapter` + `probe_aishell3`  
**Scope:** Training Foundation only（**非训练 p3** · **非 Runtime 开发**）  
**Status:** **FROZEN**（Phase 7-A）— [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)  
**依据:** [Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_PreDev_Audit_Report.md](./Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_PreDev_Audit_Report.md)  
**Runbook:** [Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Runbook.md](./Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Runbook.md)

---

## Executive Summary

本轮在不修改 Runtime、Loader、Contract、Feature Baseline、`validate_artifact` 门禁与训练主链的前提下，交付 AISHELL-3 数据接入能力：

| 交付 | 状态 |
|------|------|
| `OpenSlrAishell3DatasetAdapter` | ✅ |
| Cache 槽 `datasets/openslr_aishell3/v1/` + manifest | ✅ |
| 复用 `TextGridPinyinAlignmentProvider` | ✅ |
| `aishell3_pipeline()` 薄入口 | ✅ |
| `python -m tone_module.dataset.probe_aishell3` Probe CLI | ✅ |
| 合成 Fixture Test + manifest 幂等 + join/stats | ✅ |
| `data_mini` 回归（11,820 音节 · split · 类别） | ✅ |
| 冻结层文件本轮未修改 | ✅ |
| 单元测试 **37/37 PASS**（1 skipped 可选 Local Dataset Probe） | ✅ |

**未执行（按约束）：** `tone_cnn_p3` 训练 · 全量 `_build_feature_matrix` · 19 GB 全量下载 · Runtime / Node E2E 变更。

### Final Verdict: **PASS**

---

## 术语说明（必读）

### Runtime Validation（运行时验收）

```text
TONE_MODEL_PATH → FW Restart → Node E2E
```

用于部署后主链验收。**不得**与 Dataset Probe 混用。

### Dataset Probe（数据集探针）

```text
Dataset Adapter → Alignment Provider → SyllableSample[] → Statistics
```

| 参与 | 不参与 |
|------|--------|
| DatasetAdapter · AlignmentProvider · Materialize · Manifest · Join · Statistics | Runtime · Recall · Ranking · Assembly · KenLM · Apply · Node Decision |

**不得用于：** Runtime 验收 · 模型质量验收 · 主链（FW → Node E2E）验收。

二者术语与验收范围 **不得混用**（详见 Runbook）。

---

## Modified Files

| 文件 | 变更 |
|------|------|
| `tone_module/dataset/adapter_openslr_aishell3.py` | **新增** — `OpenSlrAishell3DatasetAdapter` |
| `tone_module/dataset/probe_aishell3.py` | **新增** — materialize / stats / join-audit Probe CLI |
| `tone_module/dataset/pipeline.py` | **MODIFY** — 新增 `aishell3_pipeline()` |
| `tone_module/dataset/__init__.py` | **MODIFY** — 导出 Adapter / pipeline |
| `tone_module/test_phase6e_aishell3.py` | **新增** — P6-E 回归门 |
| `docs/tone-v2/Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Runbook.md` | **新增** — 运维 Runbook |
| `docs/tone-v2/README.md` | **MODIFY** — Phase 6-E 索引 |

**未修改：** `contract.py` · `loader.py` · `mel.py` · `inference.py` · `classifier.py` · `numpy_p0.py` · `validate_artifact.py` · `train_tone_cnn.py`（默认仍 `default_data_mini_pipeline`）· FW/Node Runtime 链。

---

## OpenSlrAishell3DatasetAdapter Design

```text
OpenSlrAishell3DatasetAdapter.materialize(cache_dir)
  → 命中 manifest + is_materialized_root_valid → 直接返回
  → 否则：
      materialized/audio/     ← tgz 解压 或 --local-audio-root 链接/复制
      materialized/alignment/ ← zip 解压 或 --local-textgrid-root 链接/复制
  → write manifest.json
```

| 属性 | 值 |
|------|-----|
| `dataset_id` | `openslr_aishell3` |
| `version` | `v1` |
| `alignment_source` | `lars76_aishell3_textgrid` |
| `alignment_provider`（metadata） | `textgrid_pinyin_v1` |

**职责边界：** 仅 materialize · archives 缓存 · manifest/metadata；**不**解析 TextGrid · **不**生成 mel · **不**训练。

**本地路径：** `--openslr-tgz` / `OPENSRL_AISHELL3_TGZ` · `--textgrid-zip` / `AISHELL3_TEXTGRID_ZIP` · `--local-audio-root` · `--local-textgrid-root` · `--skip-download`。

---

## Cache / Manifest Layout

```text
{cache_dir}/datasets/openslr_aishell3/v1/
  manifest.json
  archives/
    data_aishell3.tgz
    aishell3_textgrid_files.zip
  materialized/              ← materialized_root
    audio/
    alignment/
```

`is_materialized_root_valid(materialized/)` 要求子树内同时存在 `.wav` 与 `.TextGrid`。

---

## TextGrid Provider Reuse

- **未新增**第二套 TextGrid Provider。
- `aishell3_pipeline()` 与 Probe `stats` 均通过 **`TextGridPinyinAlignmentProvider`**（pipeline）或 **`parse_textgrid_intervals` / `tone_label_from_pinyin`**（Limited Dataset Probe 配对路径，函数来自同一模块）产出 `SyllableSample`。
- basename join 语义与 `data_mini` 一致。

---

## Probe CLI Usage

```bash
cd electron_node/services/faster_whisper_vad

# materialize（本地目录，跳过下载）
python -m tone_module.dataset.probe_aishell3 materialize \
  --cache-dir tone_module/_data_cache \
  --local-audio-root /path/to/audio \
  --local-textgrid-root /path/to/textgrid \
  --skip-download

# Join Audit（Limited Dataset Probe）
python -m tone_module.dataset.probe_aishell3 join-audit \
  --cache-dir tone_module/_data_cache \
  --local-audio-root ... --local-textgrid-root ... \
  --skip-download --max-utterances 500 --json-out probe_join.json

# Dataset Statistics Probe（限流，不训练）
python -m tone_module.dataset.probe_aishell3 stats \
  --cache-dir tone_module/_data_cache \
  --local-audio-root ... --local-textgrid-root ... \
  --skip-download --max-speakers 5 --max-utterances 200 --json-out probe_stats.json
```

**输出字段：** `dataset_id` · `version` · `materialized_root` · `alignment_source` · speaker/utterance/syllable 计数 · t1–t5 分布 · wav/TextGrid join rate · missing 样例 · `invalid_token_count` · license/source metadata。

---

## Fixture Test / Dataset Probe Result

### 合成 AISHELL-3 fixture（Fixture Test）

| 检查 | 结果 |
|------|------|
| materialize 幂等 | **PASS** — 二次 `materialize` 同 `materialized_root` |
| manifest 槽位 | **PASS** — `openslr_aishell3/v1/manifest.json` |
| pipeline join | **PASS** — 1 utt · 3 syllables · labels ∈ [0,4] |
| Probe `stats` JSON | **PASS** — join rate 1.0 · invalid_token_count=1 |
| mel shape | **PASS** — `(80,)` = `P0_N_MELS` |

### 单元测试（Dataset Probe Test）

```text
python -m unittest tone_module.test_phase3_contracts tone_module.test_phase6d_dataset tone_module.test_phase6e_aishell3 -q
→ Ran 37 tests in ~13s — OK (skipped=1)
```

| 门 | 结果 |
|----|------|
| Phase 3 contract gates | **PASS**（16） |
| Phase 6-D data_mini 回归 | **PASS**（11） |
| Phase 6-E AISHELL Fixture Test / frozen hash | **PASS**（9） |
| 可选 Local Dataset Probe | **SKIP** — 未设置 `AISHELL3_LOCAL_*` 环境变量 |

### 本地全量资源 Limited Dataset Probe

本轮开发环境 **未挂载** 19 GB OpenSLR / lars76 全量树；`OptionalLocalAishellDatasetProbeTest` 在设置 `AISHELL3_LOCAL_AUDIO_ROOT` + `AISHELL3_LOCAL_TEXTGRID_ROOT` 后可执行 `--max-utterances 100` 限流 Dataset Probe。

---

## Dataset Statistics Result

### data_mini 回归（不变）

| 指标 | 基线 | 实测 |
|------|------|------|
| 总音节 | 11,820 | **11,820** |
| train / val (seed=42) | 10,012 / 1,808 | **10,012 / 1,808** |
| 类别 t1–t5 | 2570/2702/1716/4314/518 | **一致** |
| utteranceCount | 466 | **466** |

### AISHELL fixture Dataset Statistics Probe（`stats`）

| 指标 | 值 |
|------|-----|
| speaker_count | 1 |
| utterance_count | 1 |
| syllable_count | 3 |
| class_distribution | t3=2 · t5=1 |
| wav_join_rate | 1.0 |
| invalid_token_count | 1 |

### 全量预期（未本轮实测）

| 维度 | 官方 / P6-C 预期 |
|------|------------------|
| Speakers | 218 |
| Utterances | 88,035 |
| Syllables（粗估） | ~1.9M–2.5M |

---

## License / Source Metadata

写入 `manifest.metadata`：

| 字段 | 值 |
|------|-----|
| `dataset_version` | `openslr_slr93_full` |
| `source` | `https://www.openslr.org/93 + lars76 forced-alignment-chinese` |
| `license` | `AISHELL-3: Apache-2.0; TextGrid: see lars76 repo LICENSE` |
| `alignment_provider` | `textgrid_pinyin_v1` |

---

## Frozen Architecture Verification

### 训练主链（未变）

```text
DatasetAdapter → AlignmentProvider → SyllableSample[]
→ split_val_holdout_samples → extract_mel_features → MLP → npz
→ validate_artifact → offline_tone_eval → (deploy) → E2E
```

### Runtime 边界

| 检查 | 结果 |
|------|------|
| `contract.py` / `loader.py` / `mel.py` / `inference.py` / `classifier.py` / `numpy_p0.py` / `validate_artifact.py` 本轮未改 | ✅ SHA256 单测门 |
| `train_tone_cnn` 默认仍 `default_data_mini_pipeline` | ✅ |
| dataset 模块无 Decision / Runtime import | ✅ |
| 无 `tone_cnn_p3.npz` 生成 | ✅ |
| 无全量 `_build_feature_matrix` | ✅ |
| 无额外训练入口 | ✅ |

### Dataset Probe 与 Runtime Validation 分离

| 验收类型 | 入口 | 本轮 |
|----------|------|------|
| **Dataset Probe** | `probe_aishell3` | ✅ 已交付 |
| **Runtime Validation** | `TONE_MODEL_PATH` + FW + Node E2E | ❌ 非 P6-E 范围 |

---

## Architecture Drift Audit

| 区域 | Expected | Actual | Action |
|------|----------|--------|--------|
| Adapter 可插拔 | P6-D 协议 + P6-E AISHELL 实现 | `OpenSlrAishell3DatasetAdapter` 落地 | **KEEP** |
| TextGrid 单 Provider | 复用默认实现 | 未新增第二解析器 | **KEEP** |
| Cache 多槽 | `openslr_aishell3/v1` 隔离 | 与 `data_mini` 槽并存 | **KEEP** |
| 训练默认数据源 | `data_mini` | `train_tone_cnn` 未接 AISHELL 默认 | **KEEP** |
| Probe 与训练解耦 | P6-E Dataset Probe 入口 | 独立 Probe CLI | **KEEP** |
| Dataset Probe ≠ Runtime Validation | 术语与范围分离 | Runbook / 本报告已明示 | **KEEP** |
| Artifact / Validation | 不读 dataset | 未修改 | **KEEP** |

**Material Drift（P6-E 范围）：无**

> **Historical Issue（已关闭）：** 早期 Phase 文档曾讨论 Registry / 模型切换路线；现行架构为 Single Service / Single Model（Phase 2 Foundation Freeze）。**当前代码与运维不存在该能力。**

---

## KEEP / MODIFY / RESTORE / DELETE

| 处置 | 项 |
|------|-----|
| **KEEP** | 训练主链 · `SyllableSample` 契约 · `TextGridPinyinAlignmentProvider` · `validate_artifact` · Runtime |
| **KEEP** | `default_data_mini_pipeline` 为训练默认 |
| **KEEP** | Dataset Probe 与 Runtime Validation 术语分离 |
| **ADD** | `adapter_openslr_aishell3.py` · `probe_aishell3.py` · `aishell3_pipeline()` · P6-E 测试 · Runbook |
| **MODIFY** | `pipeline.py` · `dataset/__init__.py` · `docs/tone-v2/README.md` |
| **RESTORE** | — |
| **DELETE** | — |

---

## Remaining Risks

| 风险 | 等级 | 缓解 |
|------|------|------|
| 全量 19 GB 下载 / ~30 GB 磁盘 | MED | 本地路径 + archives 缓存；Runbook 说明 |
| lars76 TextGrid 与 OpenSLR 版本漂移 | MED | Join Audit + 抽样 join rate 门槛 |
| 全量训练内存（`_build_feature_matrix`） | **HIGH** | **p3 前** feature shard / streaming mel（非 P6-E） |
| Windows symlink 权限 | LOW | `_link_or_copy_tree` 回退 `copytree`（仅小 fixture；大集建议手动链接或解压到槽位） |
| Dataset Probe 被误当作 Runtime 验收 | MED | 术语对齐文档 · Runbook 明示边界 |
| 可选 `--dataset-adapter` 训练接线 | LOW | 推迟至 p3；当前仅 `aishell3_pipeline` + Probe CLI |

---

## Final Verdict

# **PASS**

Phase 6-E AISHELL-3 Dataset Adapter **已按审计矩阵交付**：可在不修改冻结层的前提下 materialize OpenSLR 音频 + lars76 TextGrid、写入 manifest、执行 Join Audit 与 Limited Dataset Statistics Probe，并产出与现有契约一致的 `SyllableSample[]`。`data_mini` 回归未受影响；**未训练 `tone_cnn_p3`**。

**后续（非 P6-E）：** 本地/全量 Limited Dataset Probe（需资源）→ p3 训练前特征分片工程化 → `tone_cnn_p3` 训练与 **Runtime Validation**（`TONE_MODEL_PATH` + FW + Node E2E）验收。

---

*No `tone_cnn_p3` weights · no Runtime changes · no additional training entry point.*
