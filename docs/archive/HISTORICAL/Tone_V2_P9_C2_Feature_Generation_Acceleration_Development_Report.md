<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_P9_C2_Feature_Generation_Acceleration_Development_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 P9-C2 — Feature Generation Acceleration Development Report

**Date:** 2026-07-07  
**Phase:** P9-C2 Feature Generation Acceleration Development  
**Type:** 开发 + 验证（非审计）

**目标：** 减少 AISHELL-3 全量训练前的 Feature 生成时间，保持冻结主链不变。

```text
TextGrid → SyllableSample → WordInfo Adapter → WordInfo
→ CPU reference extract_feature(audio, sampleRate, WordInfo)
→ Feature Tensor (64,83) → materialized training cache
→ 后续 GPU CNN training
```

---

## Executive Summary

| 维度 | 结果 |
|------|------|
| 主链 | ✅ WordInfo → `feature_v2.extract_feature` 不变 |
| CPU reference | ✅ 唯一 extractor，无第二套逻辑 |
| Utterance audio reuse | ✅ 每个 wav 只读一次 |
| 并行 feature generation | ✅ `ProcessPoolExecutor` + `--num-workers` |
| 1k 加速比（4 workers） | **2.60×** |
| Cache 定位 | ✅ 训练性能优化，非架构目标 |
| p0 fallback | ✅ 无 |
| Runtime 影响 | ✅ 无 |
| 回归测试 | ✅ 14/14 P9-C2 + 24/24 相关回归 PASS |

### Final Verdict: **PASS**

---

## Development Scope

### 新增

| 文件 | 说明 |
|------|------|
| `training_io/feature_cache_v2_parallel.py` | 并行 cache builder、benchmark、cache 加载 helper |
| `test_phase9c2_parallel_cache_contract.py` | Parity / anti-drift / integration gates |

### 修改

| 文件 | 说明 |
|------|------|
| `training_io/feature_shard_v2.py` | 共享 `write_shards_from_row_buffers` / `write_shard_manifest_files`；checkpoint 常量 |
| `training_io/__init__.py` | 导出 parallel API |
| `train_tone_cnn.py` | CLI：`build-feature-cache-v2-parallel`、`benchmark-feature-cache-v2` |
| `train_tone_v2_model.py` | 可选 `--feature-cache-dir` 从 Shard V2 读特征 |

### 未改

- `feature_v2.extract_feature` 数值语义
- `contract.P1_*`
- Runtime / `inference.py` / `mel.py` / `numpy_p0` / p0 loader
- P8-D `v2_training_path.py` 在线主链

---

## Parallel Builder Design

**模块：** `tone_module/training_io/feature_cache_v2_parallel.py`

| 能力 | 实现 |
|------|------|
| 并行 | `ProcessPoolExecutor`，`--num-workers`（默认 `cpu_count-1`） |
| Utterance 分组 | `_build_utterance_groups` — 按 `wav_path` 分组 |
| Worker 入口 | `_extract_utterance_group` — 单次 `sf.read` + 多 syllable `extract_feature` |
| 断点 | `checkpoints/chunk_*.npz` + `build_state.json`，`--resume` |
| 失败记录 | `build_failures.jsonl` + state 内 `failures` |
| Manifest | 复用 Feature Shard V2 schema（`training_feature_shard_v2`） |
| 进度 | `progress_interval` 日志（默认每 100 syllables） |

**CLI：**

```bash
python -m tone_module.train_tone_cnn build-feature-cache-v2-parallel \
  --dataset aishell3 --max-syllables 1000 --num-workers 4 --skip-download

python -m tone_module.train_tone_cnn benchmark-feature-cache-v2 \
  --dataset aishell3 --max-syllables 1000 --num-workers 4 --skip-download
```

---

## Utterance-level Audio Reuse

与 P8-D / sequential shard builder 一致：

1. 按 `wav_path` 分组 `SyllableSample`
2. 每个 utterance **只** `sf.read` 一次
3. 组内依次 `syllable_sample_to_word_info` → `extract_feature`
4. 输出仍为 sample-level `(64,83)` + label 一一对应
5. `timestamp_start/end` 来自 `SyllableSample`（WordInfo 边界对齐）

测试 `test_one_wav_multiple_syllables_single_group` 验证单 wav 3 syllable 与 online batch 一致。

---

## Cache Schema

复用 **Feature Shard V2**（非新 Contract）：

| 字段 | 值 |
|------|-----|
| schemaVersion | `training_feature_shard_v2` |
| featureVersion | `p1-frame-mel-f0-v1` |
| featureShape | `[64, 83]` |
| labels | `(N,)` int64 |
| buildBackend | `parallel_v2_cpu_extract` |
| boundaryProvider | diagnostics only |

NPZ 每 shard：`features`, `labels`, `global_index`, `timestamp_start`, `timestamp_end`

**Cache 不定义 Feature Contract** — 仅为物化训练张量。

---

## Parity Result

| Gate | 结果 |
|------|------|
| shape 一致 | ✅ `(N, 64, 83)` |
| labels 一致 | ✅ |
| WordInfo start/end | ✅ |
| max_abs_diff | ✅ `0.0` ~ `≤ 1e-5` |
| featureVersion | ✅ `p1-frame-mel-f0-v1` |

**1k AISHELL-3 benchmark（4 workers，热 OS cache）：**

```json
{
  "sampleCount": 1000,
  "utteranceCount": 222,
  "numWorkers": 4,
  "sequentialSec": 6.771,
  "parallelSec": 2.606,
  "speedup": 2.598,
  "sequentialMsPerSyllable": 6.771,
  "parallelMsPerSyllable": 2.606,
  "maxAbsDiff": 0.0,
  "parityPass": true,
  "labelsMatch": true
}
```

---

## Performance Benchmark

| 指标 | Sequential (1k) | Parallel 4w (1k) |
|------|-----------------|------------------|
| Wall time | 6.77 s | 2.61 s |
| ms / syllable | 6.77 | 2.61 |
| Speedup | 1.0× | **2.60×** |
| Parity | — | PASS |

**200-sample parallel cache build（含 manifest 写入）：**

| 指标 | 值 |
|------|-----|
| elapsedSec | 1.99 |
| avgMsPerSyllable | 9.94 |
| numWorkers | 4 |
| failureCount | 0 |

**瓶颈说明（Windows）：**

- `spawn` 进程启动开销在极小 batch 上稀释加速比
- 热 OS page cache 下 I/O 占比低，加速主要来自多核 `extract_feature`
- 冷盘 / 网络盘场景 I/O 仍可能是瓶颈；utterance reuse 已消除重复 wav 读取

---

## Estimated Full AISHELL-3 Feature Generation Time

假设 **~950,000 syllables**：

| 场景 | 估算 |
|------|------|
| 热 cache + 4w parallel（2.6 ms/syl） | **~41 min** |
| Parallel build 实测外推（9.9 ms/syl，200 样本） | **~2.6 h** |
| P9-C 在线 sequential 外推（~1.3 s/syl 含冷 I/O） | **~15 days** |

**建议全量路径：**

```bash
python -m tone_module.train_tone_cnn build-feature-cache-v2-parallel \
  --dataset aishell3 --num-workers 8 --skip-download
```

使用 `--resume` 支持中断续建；完成后：

```bash
python -m tone_module.train_tone_v2_model train \
  --dataset aishell3 --feature-cache-dir <training_features_v2_root> \
  --training-backend torch   # P9-C1 完成后
```

---

## Integration with GPU Training

`train_tone_v2_model.py` 新增 **`--feature-cache-dir`**：

- Cache 仅为**可选输入来源**
- 默认仍为 online `build_v2_training_batch`（P8-D 主链）
- Cache 读取经 `load_v2_training_features_from_cache` → `ShardReaderV2`
- 校验 holdout 样本数与 cache `split_meta` 一致
- **不允许**回落 p0

---

## Anti-drift Verification

| 检查 | 结果 |
|------|------|
| 无双 Feature Contract | ✅ |
| 无 FeatureTimestampRecord | ✅ |
| 无 GPU feature path | ✅ |
| 无 registry / switch / shadow | ✅ |
| `v2_training_path.py` 无 parallel 依赖 | ✅ |
| `inference.py` 未改 | ✅ |
| Cache = training cache 定位 | ✅ docstring + tests |

---

## Regression Test Result

```text
tone_module.test_phase9c2_parallel_cache_contract  14/14 PASS
tone_module.test_phase9a_v2_cnn_training          9/9  PASS
tone_module.test_phase8d_v2_training_path          11/11 PASS
tone_module.test_phase8_shard_contract              2/2  PASS
```

---

## KEEP / MODIFY / RESTORE / DELETE / RECLASSIFY

| 动作 | 项 |
|------|-----|
| **KEEP** | WordInfo Contract · SyllableSample Adapter · `extract_feature` · P8-D path · P9-A artifact · p0 Runtime · Shard V2 optional cache 定位 |
| **MODIFY** | 新增 parallel builder · shared shard write helpers · train CLI · `train_tone_v2_model --feature-cache-dir` |
| **RESTORE** | 训练目标 = 加速 feature 物化，不是建平台 |
| **DELETE** | 无 p0 fallback · 无第二 extractor |
| **RECLASSIFY** | Parallel cache = **training performance optimization** |

---

## 十问终答

| # | 问题 | 答案 |
|---|------|------|
| 1 | 是否保持 WordInfo → extract_feature 主链？ | **是** |
| 2 | 是否仍使用 CPU reference extractor？ | **是** — 仅 `feature_v2.extract_feature` |
| 3 | 是否避免重复 wav 读取？ | **是** — utterance-level reuse |
| 4 | 是否实现并行 feature generation？ | **是** — ProcessPoolExecutor |
| 5 | 1k 加速比？ | **2.60×**（4 workers，AISHELL-3 热 cache） |
| 6 | 全量 AISHELL-3 预计 feature 时间？ | **~41 min – 2.6 h**（热 cache）；冷 I/O 显著更长 |
| 7 | cache 是否仍只是训练缓存？ | **是** |
| 8 | 是否存在 p0 fallback？ | **否** |
| 9 | 可否进入 GPU training + full cache build？ | **是** — cache build 就绪；GPU training 待 P9-C1 torch |
| 10 | 可否开始 AISHELL-3 full training？ | **条件性可以** — 先 full parallel cache build，再 GPU train |

---

## Final Verdict

### **PASS**

P9-C2 在 lingua_1 内部交付并行 Feature Cache 构建能力，保持 Feature Contract 与 V2 Training Path 不变；parity gate 通过；1k 级别 **2.6×** 加速；可支撑全量 cache 物化后接 P9-C1 GPU CNN 训练。
