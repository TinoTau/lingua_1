<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase7B1_Training_IO_Engineering_Development_Plan.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT

# Tone V2 Phase 7-B1 — Training IO Engineering 开发方案

**Date:** 2026-06-29  
**Phase:** 7-B1（Training IO Engineering）  
**类型：** 开发方案（**非训练** · **非 Runtime** · **非 Dataset Foundation 修改**）  
**前置：** [Tone_V2_Phase7B_Training_Engineering_PreDev_Audit_Report.md](./Tone_V2_Phase7B_Training_Engineering_PreDev_Audit_Report.md) · [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)

**本轮禁令：** 不得训练 `tone_cnn_p3` · 不得生成正式模型权重 · 不得修改 Runtime / Loader / Contract / Feature Baseline / Dataset Foundation / Validation / Artifact / Node E2E

---

## Executive Summary

Phase 7-B1 在 **单一训练入口** `train_tone_cnn.py` 及新增 **Training Engineering** 模块内，解决 Canonical Dataset（997,992 `SyllableSample`）全量训练前的 **IO / Memory** 阻塞，核心是消除 `_build_feature_matrix` 中 **无界 `audio_cache` 全 wav 加载**（峰值 ~50 GB+ OOM）。

| 交付项 | 目的 |
|--------|------|
| **Feature Shard** | 一次顺序 mel 提取 · 落盘 · 可断点 |
| **Shard Reader** | 训练期按索引读特征 · 不全量驻留 |
| **Sequential Feature Reader** | Shard 构建期按 utterance 顺序读切片 · **无**全文件 cache |
| **Mini-batch Reader** | Epoch 期按 batch 从 Shard 聚合特征 |
| **Speaker Holdout** | 218 说话人级 val 划分 · 防泄漏 |
| **AISHELL-3 接线** | CLI 选择 Canonical · 默认仍为 Regression Fixture |
| **Pilot 路径** | 子集工程验证 · 证明无 OOM · 不产出 p3 权重 |

**术语边界：** Feature Shard / Shard Reader 属于 **Training Engineering**（`tone_module/training_io/`），**不属于** Dataset Foundation（`tone_module/dataset/`）。本文 **禁止**使用「Streaming Feature」「Streaming Training」；统一使用上表正名。

### Final Verdict: **PASS**

方案与冻结架构一致、触达面可控、可验收；**可进入 Phase 7-B1 实现**（实现轮仍不得训练 `tone_cnn_p3` 或修改冻结层）。

---

## Design Constraints

### 必须遵守

| 约束 | 说明 |
|------|------|
| 单训练入口 | 仅 `python -m tone_module.train_tone_cnn`；可增子命令，**禁止** `train_tone_p3.py` 等旁路 |
| Dataset Foundation 冻结 | **只读** `aishell3_pipeline()` / `SyllableSample`；**不修改** `dataset/*` |
| Feature Baseline 冻结 | mel 仅经 `mel.extract_mel_features`；**不修改** `mel.py` / `contract.P0_*` |
| Artifact / Validation 冻结 | `validate_artifact` 语义不变；仍 `acceptance_mel` + `acceptance_labels` |
| 默认回归行为 | 无新 flag 时行为与现网 **data_mini** 路径一致（`test_phase6d` 不破） |
| 本轮不交付 | `tone_cnn_p3` 全量训练 · 正式 p3 权重 · Runtime Validation |

### 触达范围（允许 MODIFY / ADD）

```text
tone_module/training_io/          # ADD — Training Engineering 专用包
  feature_shard.py                # Feature Shard 构建与 manifest
  shard_reader.py                 # Shard Reader · Sequential · Mini-batch
  speaker_holdout.py              # Speaker Holdout 划分
tone_module/train_tone_cnn.py     # MODIFY — 编排 · CLI · 双路径（mini 内存 / canonical shard）
tone_module/test_phase7b1_training_io.py   # ADD — 回归门
docs/tone-v2/…                    # 开发报告（实现轮）
```

### 禁止触达

`contract.py` · `mel.py` · `loader.py` · `inference.py` · `validate_artifact.py` · `dataset/**` · FW/Node 全链

---

## Feature Shard Design

### 定位

**Feature Shard** = 将 `SyllableSample` 经 **冻结 mel 路径** 预计算为 `(N, 80)` float32 + labels，分片写入磁盘，供训练期 **Shard Reader** 读取。

**不属于 Dataset Foundation：** 不写 `CacheLayout` API · 不改 `DatasetManifest` schema · 不进入 Adapter/Provider。

### 目录约定（Training Engineering 私有布局）

挂在已有 dataset 槽目录下，**仅约定路径**，不修改 `cache_layout.py`：

```text
{cache_dir}/datasets/{dataset_id}/{version}/training_features/
  shard_manifest.json
  shards/
    shard_000.npz
    shard_001.npz
    …
  holdout/
    split_meta.json          # speaker/utterance holdout 索引
```

**Canonical 示例：**

```text
tone_module/_data_cache/datasets/openslr_aishell3/v1/training_features/
```

预估磁盘：**~320–450 MB**（997,992 × 80 × 4 B + 元数据），相对 materialized ~25–30 GB 可忽略。

### `shard_manifest.json`（Training Engineering SSOT）

| 字段 | 类型 | 说明 |
|------|------|------|
| `schemaVersion` | string | `"training_feature_shard_v1"` |
| `datasetId` | string | 如 `openslr_aishell3` |
| `datasetSlotVersion` | string | 如 `v1` |
| `featureVersion` | string | **`p0-v1`**（与 `contract.P0_FEATURE_VERSION` 一致） |
| `nMels` | int | **80** |
| `sampleCount` | int | 总音节数 |
| `shardCount` | int | 分片数 |
| `shards` | array | `{ "path", "offset", "count" }` — `offset` 为全局行号起点 |
| `sourceManifestPath` | string | 可选 · 指向 dataset `manifest.json` |
| `buildTime` | string | ISO8601 UTC |
| `buildCommand` | string | 可选 · 审计 |

### 单片 `shard_XXX.npz`

| 数组 | shape | dtype |
|------|-------|-------|
| `mel` | `(count, 80)` | float32 |
| `labels` | `(count,)` | int64 |
| `global_index` | `(count,)` | int64 · 可选 · 映射回 holdout 元数据 |

**不得**写入 Artifact Required Keys；与 Runtime npz **无关**。

### Feature Shard 构建算法（Sequential Feature Reader）

构建阶段使用 **Sequential Feature Reader** — 顺序处理样本，**禁止** `audio_cache` 无界字典。

```text
1. samples, manifest ← aishell3_pipeline(cache_dir)   # 只读 Dataset Foundation
2. train_samples, val_samples ← split_speaker_holdout(...)  # 或 utterance（pilot 可指定）
3. 按 wav_path 分组 train_samples（及 val_samples 各建 holdout shard 集）
4. 对每个 wav_path（顺序）:
     audio, sr ← sf.read(wav_path) once
     对该 utterance 内各 SyllableSample:
         clip ← slice(audio, start, end)
         mel ← extract_mel_features(clip, sr)
         append to active shard buffer
     当 buffer ≥ SHARD_TARGET_ROWS（默认 50_000）:
         flush → shard_XXX.npz · 更新 manifest
5. 写入 shard_manifest.json · split_meta.json
```

| 参数 | 默认 | 说明 |
|------|------|------|
| `SHARD_TARGET_ROWS` | `50_000` | 约 16 MB/shard mel · 可调 |
| 断点续建 | `.build_progress.json` | 记录已完成 `wav_path` · **可选 P1** |

**内存峰值（构建）：** 单 utterance wav + 一个 shard buffer ≤ **~20–50 MB** 级（远小于 50 GB）。

**CPU 时间粗估：** 998k mel × STFT ≈ **2–6 h**（单进程）；并行构建 **defer** 至 7-B2。

### CLI 入口（构建）

```bash
python -m tone_module.train_tone_cnn build-feature-shards \
  --dataset aishell3 \
  --cache-dir tone_module/_data_cache \
  --holdout speaker \
  --shard-target-rows 50000
```

`build-feature-shards` 为 **子命令**（`argparse` subparsers），**不**新增第二脚本。

---

## Shard Reader Design

### 组件层次

```text
ShardReader          # 打开 manifest · 按 global_index 读 (mel, label) 行
    ↑
SequentialFeatureReader   # 顺序遍历 [0, sampleCount) 或 index 列表（用于统计 / 离线）
    ↑
MiniBatchReader      # 每 epoch permutation · 按 batch_size 产出 (xb, yb)
```

| 术语 | 职责 |
|------|------|
| **Shard Reader** | 封装 manifest + np.load/memmap；`__getitem__(i)` → `(80,)`, `label` |
| **Sequential Feature Reader** | 对索引序列顺序调用 Shard Reader（构建 val 统计 / 顺序扫描） |
| **Mini-batch Reader** | `for epoch: shuffle(indices); for batch: stack rows` |

**禁止**在文档与代码注释中使用 Streaming Feature / Streaming Training。

### Shard Reader 实现要点

```python
class ShardReader:
    """Read-only Training Engineering accessor for Feature Shard files."""

    def __init__(self, training_features_root: str): ...
    def __len__(self) -> int: ...
    def get_row(self, global_index: int) -> Tuple[np.ndarray, int]: ...
    def get_rows(self, indices: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """Batch fetch for Mini-batch Reader — 仅加载当前 batch 行."""
```

**读取策略：**

| 模式 | 场景 | 内存 |
|------|------|------|
| `np.load` 按需读行 | Pilot · 子集 | 低 |
| `np.memmap` 映射单片 | 单 shard 训练 | 低 · OS 页缓存 |
| Val 集一次性 `get_rows(all_val_idx)` | `validate_artifact` acceptance | **~46 MB** · 可接受 |

**训练期 RAM 目标：** 常驻 **< 2 GB**（batch + 当前 shard mmap + 元数据）；**不得** `np.stack` 全量 train 矩阵。

### Mini-batch Reader 与 `_train_mlp` 集成

新增 `_train_mlp_from_reader`（或扩展 `_train_mlp` 重载）：

```text
输入: MiniBatchReader(train_reader, batch_size, seed)
每 step:
  xb, yb ← reader.next_batch()   # (B, 80), (B,)
  与现网相同 NumPy 前向 / 反向
归一化:
  第一 epoch 前 — 两遍扫描 train：
    Pass 1: Sequential Feature Reader 累加 mean/std（Welford 或分块 sum）
    Pass 2: Mini-batch Reader 训练时使用 (x - mean) / std
```

**data_mini 路径：** 保留现有 `_train_mlp(x_train, y_train, ...)` 全矩阵路径（11,820 样本 · 回归用）。

---

## Speaker Holdout Design

### 问题

现网 `split_val_holdout_samples` 为 **utterance 级** 15% 随机；218 说话人下同一 speaker 的 utterance 可分布于 train/val → **speaker 泄漏**。

### 方案

新增 `tone_module/training_io/speaker_holdout.py`：

```python
SPEAKER_RE = re.compile(r"(SSB\d+)", re.IGNORECASE)

def split_speaker_holdout_samples(
    samples: Sequence[SyllableSample],
    *,
    val_ratio: float = 0.15,
    seed: int = 42,
) -> Tuple[List[SyllableSample], List[SyllableSample], dict]:
    """Speaker-stratified holdout: entire speakers to val or train."""
```

**算法：**

1. 按 `wav_path` 提取 `SSB\d+` → speaker_id  
2. 对 **唯一 speaker_id** 列表 shuffle(seed)  
3. `val_speaker_count = max(1, int(n_speakers * val_ratio))`  
4. val = 所有 speaker ∈ val_speakers 的样本；train = 其余  
5. `split_meta.json` 记录 `valSpeakers` · `trainSpeakers` · `seed` · `valRatio`

**Canonical 粗估（218 speakers · 15%）：** val ≈ **33 speakers** · ~150k syllables（与 utterance-holdout 规模接近）。

### 兼容性

| 模式 | CLI | 默认 |
|------|-----|------|
| `utterance` | `--holdout utterance` | **data_mini 默认**（保持 `test_phase6d` 基线） |
| `speaker` | `--holdout speaker` | **Canonical 推荐** |

`split_val_holdout_samples` **KEEP** 不删；Canonical / `--holdout speaker` 走新函数。

---

## train_tone_cnn Integration Plan

### 数据源选择

```python
def _load_samples_and_manifest(
    cache_dir: str,
    *,
    dataset: str,  # "data_mini" | "aishell3"
    dataset_repo: str,
    dataset_zip: str,
    max_syllables: Optional[int] = None,
) -> Tuple[List[SyllableSample], DatasetManifest]:
```

| `dataset` | Pipeline | 特征路径 |
|-----------|----------|----------|
| `data_mini`（默认） | `default_data_mini_pipeline` | 内存 `_build_feature_matrix`（**KEEP**） |
| `aishell3` | `aishell3_pipeline` | **Feature Shard 必须**（已构建或 `--build-shards` 先构建） |

`max_syllables`：Pilot 用 — 截断样本列表（**不修改** Dataset Foundation）。

### `train_and_save` 分支

```text
train_and_save(..., dataset="data_mini", ...):
  → 现网逻辑不变（回归门）

train_and_save(..., dataset="aishell3", ...):
  1. samples, manifest ← _load_samples_and_manifest
  2. holdout ← speaker | utterance
  3. 若 training_features/ 不存在或 manifest 过期:
       build_feature_shards(...)  # 或 raise 提示先 build
  4. train_reader ← ShardReader(train indices)
     val_reader   ← ShardReader(val indices)
  5. mean, std ← fit from train_reader (Sequential Feature Reader)
  6. _train_mlp_from_reader(MiniBatchReader(...), val_reader for metrics)
  7. x_val_raw ← val_reader.get_all_mel()  # ~150k 行 · 供 validate_artifact
  8. np.savez(...) · validate_artifact · offline_tone_eval  # 语义不变
```

### CLI 扩展（`main()` subparsers）

| 子命令 / 参数 | 说明 |
|---------------|------|
| `train`（默认） | 现网训练 |
| `build-feature-shards` | 仅构建 Feature Shard |
| `--dataset {data_mini,aishell3}` | 默认 `data_mini` |
| `--holdout {utterance,speaker}` | 默认 `utterance`；aishell3 文档推荐 `speaker` |
| `--max-syllables N` | Pilot 截断 |
| `--max-speakers N` | Pilot 截断（仅取前 N 个 speaker 的样本） |
| `--training-features-dir PATH` | 可选覆盖 shard 根 |
| `--skip-shard-build` | 要求已有 manifest |
| `--pilot` | 预设：`max-syllables=10000` · `epochs=5` · `model-version=tone_cnn_pilot` · 输出临时路径 |

**不得**修改 `validate_artifact` 签名；`acceptance_mel` 仍从 val Feature Shard 物化为 `ndarray`。

### `load_val_holdout_features` 扩展

增加 `dataset` · `holdout` 参数；Canonical 时从 **val Feature Shard** 或复用 `split_meta.json` 读 val 行 — 与训练同源。

---

## Pilot Training Plan

**目的：** 验证 IO 工程无 OOM · Shard 构建 · Mini-batch Reader · validate 链 — **非**模型质量 · **非** p3 交付。

### Pilot 配置（建议）

```bash
cd electron_node/services/faster_whisper_vad

# 1) 构建子集 shard（5 speakers · 10k syllables cap）
python -m tone_module.train_tone_cnn build-feature-shards \
  --dataset aishell3 \
  --cache-dir tone_module/_data_cache \
  --holdout speaker \
  --max-speakers 5 \
  --max-syllables 10000 \
  --skip-download

# 2) Pilot 训练（临时权重 · 非 p3）
python -m tone_module.train_tone_cnn train \
  --dataset aishell3 \
  --holdout speaker \
  --max-speakers 5 \
  --max-syllables 10000 \
  --epochs 5 \
  --model-version tone_cnn_pilot_io \
  --output tone_module/models/_pilot_phase7b1_io.npz \
  --skip-download
```

### Pilot 验收标准

| 门 | 标准 |
|----|------|
| 内存 | 进程峰值 **< 4 GB**（任务管理器 / 日志） |
| 构建 | `shard_manifest.json` 存在 · `featureVersion=p0-v1` |
| 训练 | 正常结束 · 无 OOM |
| Artifact | `validate_artifact` **PASS** |
| 回归 | `data_mini` 默认训练仍 **31s 级** smoke PASS |
| 权重 | **`_pilot_*.npz` 不入库** · 不替换 `tone_cnn_p1` |

**本轮禁止：** 全量 997k Pilot 当作完成条件（可作 **可选** 7-B1 尾声运维验证，不阻塞合并）。

---

## Regression Gate

### Unit Test（Level 1）

新增 `tone_module/test_phase7b1_training_io.py`：

| 测试 | 内容 |
|------|------|
| `test_speaker_holdout_no_overlap` | fixture 样本 speaker 不跨 train/val |
| `test_feature_shard_build_fixture` | 合成 wav + 少量 `SyllableSample` → 1 shard · manifest |
| `test_shard_reader_row_parity` | Shard 行与 `_build_feature_matrix` 单行一致（fixture） |
| `test_mini_batch_reader_covers_all` | 一个 epoch 索引覆盖 train 集 |
| `test_data_mini_regression_unchanged` | 默认 CLI 仍 11820 · split 基线 |

### 既有门（必须仍 PASS）

```powershell
cd electron_node/services/faster_whisper_vad
python -m unittest tone_module.test_phase3_contracts tone_module.test_phase6d_dataset tone_module.test_phase6e_aishell3 tone_module.test_phase7b1_training_io -q
```

| 门 | 期望 |
|----|------|
| `FrozenArchitectureTest` | 冻结层 SHA256 不变 |
| `test_phase6d_dataset` | 11,820 · 类分布 · split **不变**（utterance holdout） |
| Pilot 人工 | 上节命令 · 无 OOM |

---

## Frozen Architecture Verification

| 检查项 | 7-B1 方案 | 结论 |
|--------|-----------|------|
| 单训练入口 | `train_tone_cnn` + subcommands | ✅ |
| Dataset Foundation | 只读 pipeline | ✅ 不修改 |
| Feature Baseline | 仅调用 `extract_mel_features` | ✅ |
| Artifact schema | `np.savez` 字段不变 | ✅ |
| `validate_artifact` | 仍 acceptance 批 | ✅ |
| Runtime / Node E2E | 不触达 | ✅ |
| 第二 Training Pipeline | 无 | ✅ |
| 术语 | Feature Shard / Shard Reader / Sequential / Mini-batch | ✅ 不用 Streaming |

---

## Architecture Drift Audit

| 区域 | Expected | 7-B1 设计 | Action |
|------|----------|-----------|--------|
| `dataset/*` | FROZEN | 零修改 | **KEEP** |
| `training_io/*` | 不存在 → 新增 | Training Engineering 包 | **ADD** |
| `train_tone_cnn` | 编排器 | 双路径 + CLI | **MODIFY** |
| `_build_feature_matrix` | data_mini | 保留；Canonical 旁路 | **KEEP** + **旁路** |
| `audio_cache` | Canonical 禁用 | 构建改 utterance 单次读 | **MODIFY** |
| Feature Shard 位置 | — | `training_features/` 约定 | **ADD** |
| Speaker holdout | 无 | `speaker_holdout.py` | **ADD** |

**Material Drift：** 无（方案不触碰冻结层文件）。

---

## KEEP / MODIFY / RESTORE / DELETE

| 处置 | 项 |
|------|-----|
| **KEEP** | `dataset/*` 全部 · `mel.py` · `contract.py` · `loader` · `validate_artifact` · `inference` · 单 `train_tone_cnn` 入口 |
| **KEEP** | `default_data_mini_pipeline` 默认 · `split_val_holdout_samples` + data_mini 基线 |
| **KEEP** | `_train_mlp` 全矩阵路径（小集） |
| **ADD** | `tone_module/training_io/` · Feature Shard · Shard Reader · Speaker Holdout |
| **ADD** | `build-feature-shards` 子命令 · `test_phase7b1_training_io.py` |
| **MODIFY** | `train_tone_cnn.py` — AISHELL 接线 · Mini-batch Reader 训练路径 · CLI |
| **MODIFY** | `load_val_holdout_features` — Canonical 同源 |
| **RESTORE** | — |
| **DELETE** | — |

---

## Implementation Order（建议）

| 阶段 | ID | 内容 | 依赖 |
|------|-----|------|------|
| 1 | IO-01 | `speaker_holdout.py` + 单测 | — |
| 2 | IO-02 | `feature_shard.py` 构建 + Sequential Feature Reader | IO-01 |
| 3 | IO-03 | `shard_reader.py` + Mini-batch Reader | IO-02 |
| 4 | IO-04 | `train_tone_cnn` CLI `build-feature-shards` | IO-02 |
| 5 | IO-05 | `_train_mlp_from_reader` + mean/std 两遍 | IO-03 |
| 6 | IO-06 | `train` 路径 `--dataset aishell3` | IO-04, IO-05 |
| 7 | IO-07 | Pilot 预设 + `load_val_holdout_features` 扩展 | IO-06 |
| 8 | IO-08 | 全量回归 + Pilot 运维文档 | IO-07 |

**7-B1 完成定义：** IO-01～08 · 回归门 PASS · Pilot 无 OOM · **未**交付 p3 全量训练。

**7-B2（后续，非本方案）：** 全量 Canonical 训练 · `tone_cnn_p3` · 可选并行 shard 构建 · class weight。

---

## Remaining Risks

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| mean/std 两遍扫描全量 train 耗时 | MED | 分块累加 · 可缓存 `norm_stats.npz` |
| 实现误改 `dataset/` | MED | CODEOWNERS + `FrozenArchitectureTest` |
| Pilot 通过但全量边缘 OOM | LOW | 7-B1 尾声可选 100k shard 压测 |
| 术语回退使用 Streaming | LOW | Style Guide + CR checklist |
| val 集 150k 行 acceptance 变慢 | LOW | 仍 <100 MB · 可接受 |

---

## Final Verdict

### **PASS**

Phase 7-B1 开发方案 **完备且可执行**：

- 直接针对 P7-B 审计 **P0** 阻塞（`audio_cache` OOM）  
- Feature Shard / Shard Reader 明确归属 **Training Engineering**  
- 不修改 Dataset Foundation / Runtime / Artifact 冻结层  
- 保留 data_mini 回归 · 提供 Pilot 与 Speaker Holdout  
- 术语符合本轮要求（**无** Streaming Feature / Streaming Training）

**实现轮结束后**（非本方案文档轮），方可进入 **Phase 7-B2 / 7-C** 讨论 Canonical 全量 `tone_cnn_p3` 训练。

---

*Phase 7-B1 Development Plan — documentation only · no training · no code in this deliverable.*
