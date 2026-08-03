<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Tone_V2_Production_Training_Readiness_Audit_2026_07_12.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Tone V2 Production Training Readiness Audit

**日期：** 2026-07-12  
**类型：** Production Training Readiness Audit（训练就绪性审计）  
**范围：** 只读 — 代码 / 训练脚本 / Feature Cache / Runtime / 训练报告  
**禁止项：** 未修改 Runtime、Loader、Feature、模型、训练代码、词库、Node、Recall、KenLM、Dataset

---

## Executive Summary

| 问题 | 结论 |
|------|------|
| 是否具备 Production Full Training 条件？ | **否** |
| Feature 是否 SSOT？ | **是**（Production 主链唯一入口 `feature_v2.extract_feature`） |
| Training 是否匹配 Runtime Audio Contract？ | **否** |
| Training 是否匹配 Node Audio Pipeline？ | **否** |
| Node 分割重组能否被 Production Model 正确学习？ | **否**（当前训练未体现） |
| 训练后 Runtime 是否无需改代码？ | **是**（仅换 Artifact / `TONE_MODEL_PATH`） |
| Feature Cache 是否需重建？ | **对齐 Node 前必须重建**；沿用当前错误音频域则可直接用 |
| 今天能否开始 Production Full Training？ | **不能**（对 Node 业务无意义） |

**Verdict：C — Training Blocked**

**唯一 Blocker：** Training Audio Pipeline 未对齐 Runtime `processed_audio` 音频域 — 训练读原始 AISHELL wav（`sf.read`），不经 `preprocess_pcm_f32`（peak normalize / silence trim），无 VAD 拼接，无 Node Opus/Aggregator 路径；WordInfo 时间戳来自 TextGrid 音节边界（原始 wav 时间轴），而非 ASR 字级时间戳（`processed_audio` 时间轴）。

**唯一正确下一步：** 冻结 Training Audio Domain 策略（至少接入 `preprocess_pcm_f32` + 明确 Word Boundary 合同），修改 Training 路径并 **重建 Feature Cache**，再执行 Production Full GPU Training。

---

## 三、Training Pipeline 审计 — 真实 Production 调用链

以下为 **当前代码** 中 Production V2 全量训练的真实调用链（非设计图）。

### 3.1 端到端总览

```text
AISHELL-3 原始 wav + Praat TextGrid
        ↓
tone_module.dataset.adapter_openslr_aishell3.OpenSlrAishell3DatasetAdapter.materialize()
        ↓
tone_module.dataset.alignment_textgrid.TextGridPinyinAlignmentProvider.collect_samples()
        → List[SyllableSample]
        ↓
[可选] tone_module.build_feature_cache_v2_parallel.main()
        → tone_module.train_tone_cnn.build_feature_cache_v2_parallel_for_dataset()
        → tone_module.training_io.feature_cache_v2_parallel.*
        → tone_module.training_io.feature_shard_v2.write_shards_from_samples()
        ↓
tone_module.train_tone_v2_model.main() → train_and_save_v2()
        ↓
extract_v2_features_for_training()  [cache 或 online]
        ↓
_train_weights_torch() / _train_weights_numpy()
        ↓
tone_module.loader_v1.save_artifact_v1()
        ↓
tone_module.validate_artifact_v1.validate_artifact_v1()
        ↓
.npz Artifact
        ↓
config.TONE_MODEL_PATH → tone_module.loader_v1.ToneModelLoaderV1
        ↓
tone_module.inference.run_tone_inference()
        ↓
Node → FW HTTP → api_routes.process_utterance()
```

### 3.2 逐步模块 / 函数 / 输入 / 输出

#### Phase A — Dataset 物化

| 步骤 | Python Module | Function | 输入 | 输出 |
|------|---------------|----------|------|------|
| A1 | `tone_module.dataset.adapter_openslr_aishell3` | `OpenSlrAishell3DatasetAdapter.materialize(cache_dir)` | `cache_dir`, 可选 tgz/textgrid zip | `DatasetManifest`（`dataset_id=openslr_aishell3`, `version=v1`） |
| A2 | `tone_module.dataset.alignment_textgrid` | `TextGridPinyinAlignmentProvider.collect_samples(dataset_root)` | 物化后的 wav + `.TextGrid` 目录树 | `List[SyllableSample]`：`wav_path, start, end, label(0..4)` |
| A3 | `tone_module.dataset.pipeline` | `aishell3_pipeline(cache_dir)` | 同上 | `(samples, manifest)` |
| A4 | `tone_module.train_tone_v2_model` | `load_samples_and_manifest(...)` | `dataset="aishell3"` | 同上 |

**音频来源：** OpenSLR AISHELL-3 原始 `.wav`（16k，磁盘文件）。  
**标签来源：** TextGrid interval 拼音 token → `tone_label_from_pinyin()` → t1..t5 (0..4)。  
**Split：** `holdout=speaker`（aishell3 默认），`val_ratio=0.15`，`seed=42`。

#### Phase B — Feature Cache 构建（可选，Production 全量已存在）

| 步骤 | Python Module | Function | 输入 | 输出 |
|------|---------------|----------|------|------|
| B1 | `tone_module.build_feature_cache_v2_parallel` | `main()` | CLI args | 调用 `build_feature_cache_v2_parallel_for_dataset` |
| B2 | `tone_module.train_tone_cnn` | `build_feature_cache_v2_parallel_for_dataset(...)` | `samples`, `manifest` | `shard_manifest.json` + `holdout/split_meta.json` |
| B3 | `tone_module.training_io.feature_cache_v2_parallel` | `_extract_worker_group(group)` | `sf.read(wav_path)` → `audio, sr` | 每组音节 features |
| B4 | `tone_module.training_io.syllable_to_wordinfo` | `syllable_sample_to_word_info(sample)` | `SyllableSample` | `WordInfo(word, start, end, probability=1.0)` |
| B5 | `tone_module.feature_v2` | `extract_feature(audio, sr, word_info)` | 原始 wav PCM + `WordInfo` | `np.ndarray (64, 83) float32` |
| B6 | `tone_module.training_io.feature_shard_v2` | `write_shards_from_samples(...)` / `_flush_shard(...)` | feature tensors + labels | `shards/shard_NNN.npz` |

**Cache 根路径（实测存在）：**  
`tone_module/_data_cache/datasets/openslr_aishell3/v1/training_features_v2/`

#### Phase C — Training

| 步骤 | Python Module | Function | 输入 | 输出 |
|------|---------------|----------|------|------|
| C1 | `tone_module.train_tone_v2_model` | `train_and_save_v2(...)` | CLI 参数 | `metrics` dict |
| C2 | `tone_module.train_tone_v2_model` | `extract_v2_features_for_training(...)` | cache dir 或 online samples | `x_train, y_train, x_val, y_val` |
| C2a (cache) | `tone_module.training_io.feature_shard_v2` | `load_v2_training_features_from_cache(dir)` | `shard_manifest.json` + npz shards | `(N, 64, 83)` tensors |
| C2b (online) | `tone_module.training_io.v2_training_path` | `build_v2_training_batch(samples)` | `SyllableSample[]` | `V2TrainingInputBatch` |
| C2b' | `tone_module.training_io.v2_training_path` | `extract_v2_training_row(...)` | `sf.read` + adapter | single `(64,83)` row |
| C3 | `tone_module.models.cnn_p1` | `fit_feature_norm` + `train_sgd_step` / torch loop | feature batches | `ToneModelWeightsV1` |
| C4 | `tone_module.loader_v1` | `save_artifact_v1(path, weights, ...)` | weights + metadata | `.npz` artifact |
| C5 | `tone_module.validate_artifact_v1` | `validate_artifact_v1(path, acceptance_features, acceptance_labels)` | npz + val features | `ValidationReportV1` |

#### Phase D — Runtime / Node

| 步骤 | Python Module | Function | 输入 | 输出 |
|------|---------------|----------|------|------|
| D1 | `utterance_audio` | `decode_and_preprocess_audio(...)` | base64 Opus/PCM | `audio` after `preprocess_pcm_f32` |
| D2 | `utterance_audio` | `prepare_audio_with_context(...)` | preprocessed audio | `processed_audio`（VAD 段拼接） |
| D3 | `utterance_asr` | `perform_asr(processed_audio, ...)` | `processed_audio` | `segments_info`（含 ASR `WordInfo`） |
| D4 | `tone_module.inference` | `run_tone_inference(processed_audio, sr, segments, ...)` | processed_audio + ASR words | `UtteranceAcousticTonePayload` |
| D5 | `tone_module.feature_v2` | `extract_feature(processed_audio, sr, word_info)` | **processed** PCM + ASR `WordInfo` | `(64, 83)` |
| D6 | `tone_module.classifier` | `ToneClassifier.predict_batch(...)` | feature batch | tone posteriors |

---

## 四、Feature 是否真正 SSOT

### 4.1 结论

**Production 训练主链：** 全部调用 `tone_module.feature_v2.extract_feature(...)`。  
**不存在** Production 主链上的第二份 Feature 实现。  
**Legacy Feature** 仍存在于仓库，但 **不在** `train_tone_v2_model` 调用链中 — **非 Production BLOCKER**。

### 4.2 Feature 来源表

| 文件 | Feature 来源 | 是否 Runtime 共用 | 是否 Legacy |
|------|-------------|------------------|------------|
| `tone_module/feature_v2.py` | `extract_feature`（SSOT） | **是** | 否 |
| `tone_module/inference.py` | `feature_v2.extract_feature` | **是** | 否 |
| `tone_module/training_io/v2_training_path.py` | `feature_v2.extract_feature` | 否（Training only） | 否 |
| `tone_module/training_io/feature_shard_v2.py` | `feature_v2.extract_feature` | 否 | 否 |
| `tone_module/training_io/feature_cache_v2_parallel.py` | `feature_v2.extract_feature` | 否 | 否 |
| `tone_module/train_tone_v2_model.py` | 经 v2_training_path / cache | 否 | 否 |
| `tone_module/probe_v2_inference.py` | 经 `extract_v2_features_via_wordinfo` | 否 | 否 |
| `tone_module/validate_artifact_v1.py` | 不提取 feature；验 weights | 否 | 否 |
| `tone_module/mel.py` | `extract_mel_features`（P0 mel 80） | **否** | **是** |
| `tone_module/training_io/feature_shard.py` | `mel.extract_mel_features` | 否 | **是** |
| `tone_module/train_tone_cnn.py` | `mel.extract_mel_features`（P0 训练 CLI） | 否 | **是** |
| `tone_module/test_phase6e_aishell3.py` | `mel.extract_mel_features` | 否 | **是（测试）** |

---

## 五、Training Audio Pipeline（重点）

### 5.1 真实 Pipeline

```text
AISHELL-3 原始 wav（磁盘 .wav）
        ↓
soundfile.sf.read(wav_path, dtype="float32")     # v2_training_path L82-84
                                                   # feature_shard_v2 L210
                                                   # feature_cache_v2_parallel L77
        ↓
[仅 stereo → mono mean]                            # 无其他预处理
        ↓
syllable_sample_to_word_info() → WordInfo(start/end from TextGrid)
        ↓
feature_v2.extract_feature(audio, sr, word_info)
        ↓
(64, 83) feature tensor → Cache / Training
```

### 5.2 逐项确认（必须基于代码）

| 项 | Training 是否存在 | 代码依据 |
|----|------------------|----------|
| `preprocess_pcm_f32` | **没有** | 全库 `tone_module/**` 无 import；仅 `sf.read` |
| Peak normalize (-3dBFS) | **没有** | 仅 `audio_preprocess.py`（Runtime） |
| Silence trim | **没有** | 同上 |
| VAD | **没有** | 仅 `utterance_audio.prepare_audio_with_context` |
| `processed_audio` 语义 | **没有** | Training 使用整句原始 wav |
| Node Opus 模拟 | **没有** | 无 `decode_audio` / Opus 路径 |
| Audio concat（VAD 段拼接） | **没有** | Runtime `np.concatenate(processed_audio_parts)` 未出现在 Training |

---

## 六、Runtime Audio Contract 对齐

| 项 | Training | Runtime |
|----|----------|---------|
| **Audio Source** | AISHELL-3 磁盘原始 wav | Node HTTP base64 → `decode_audio`（Opus/PCM） |
| **Audio Domain** | 原始 utterance wav | `processed_audio`（preprocess + 可选 VAD 拼接后） |
| **Sample Rate** | wav 文件原样（通常 16k）；`extract_feature` 内 `_resample_to_contract_sr` | 强制 16k（`preprocess_pcm_f32` + `CONTEXT_SAMPLE_RATE`） |
| **Normalize** | **无** | `_peak_normalize` → -3dBFS（`audio_preprocess.py` L19-40） |
| **Peak** | 原始峰值 | 归一化后 peak ≈ -3dBFS |
| **Silence Trim** | **无** | `_trim_leading_trailing_silence`（threshold -40dBFS, min 80ms） |
| **VAD** | **无** | `detect_speech` + `refine_vad_segments`；多段 concat |
| **Audio Concatenation** | **无** | VAD 段 `np.concatenate` → 时间轴压缩 |
| **Word Boundary** | TextGrid 音节 `[start,end]` on **原始 wav** | ASR FW `WordInfo` on **processed_audio** 时间轴 |
| **Timestamp** | 音节级（拼音+tone interval） | 字/词级（Whisper word timestamps） |
| **Feature** | `feature_v2.extract_feature` | **同一函数** |
| **Feature Shape** | `(64, 83)` | `(64, 83)` |
| **Feature Version** | `p1-frame-mel-f0-v1` | `p1-frame-mel-f0-v1` |

**关键代码引用：**

- Training 读音频：`v2_training_path.py` L81-87 — `sf.read` → 直接 `extract_feature`
- Runtime 预处理：`utterance_audio.py` L79 — `preprocess_pcm_f32`；L179 — VAD concat → `processed_audio`
- Runtime 推理：`inference.py` L88 — `extract_feature(processed_audio, sample_rate, w)`
- ASR 与 Tone 同轴：`api_routes.py` L282-286 — `run_tone_inference(processed_audio=..., segments=segments_info)`

---

## 七、WordInfo Contract

### 7.1 Training 传给 `feature_v2` 的类型

**类型：`shared_types.WordInfo`**（与 Runtime 相同 dataclass）。

### 7.2 Adapter 位置

`tone_module/training_io/syllable_to_wordinfo.py` → `syllable_sample_to_word_info()`:

```python
return WordInfo(
    word=f"syllable:{syllable_index}",
    start=float(sample.start),
    end=float(sample.end),
    probability=1.0,
)
```

### 7.3 与 Runtime 的差异（合同层面）

| 维度 | Training | Runtime |
|------|----------|---------|
| **Type** | `WordInfo` | `WordInfo` |
| **Boundary 来源** | `SyllableSample` ← TextGrid 音节 | ASR `SegmentInfo.words` |
| **Granularity** | 音节（带声调拼音） | 字/词（ASR token） |
| **时间轴基准** | 原始 wav 秒 | `processed_audio` 秒（trim/VAD 后） |
| **word 字段** | `"syllable:N"`（占位） | 实际 ASR 文本 |

**结论：** Type 合同一致，**语义合同不一致** — 这是 Audio/Boundary Domain 割裂的一部分，不是 Type adapter 缺失。

---

## 八、Feature Cache

### 8.1 Cache 缓存内容

**缓存的是 `feature_v2.extract_feature` 的最终输出张量**，不是 Mel 中间态，不是 Raw PCM。

### 8.2 Cache Schema（磁盘实测）

路径：`tone_module/_data_cache/datasets/openslr_aishell3/v1/training_features_v2/shard_manifest.json`

```json
{
  "schemaVersion": "training_feature_shard_v2",
  "featureVersion": "p1-frame-mel-f0-v1",
  "featureShape": [64, 83],
  "boundaryProvider": "textgrid_pinyin_v1",
  "sampleCount": 997992,
  "shardCount": 20,
  "resamplePolicy": "duration_normalized_linear_interp",
  "overflowPolicy": "center_crop_if_raw_frames_gt_fixed"
}
```

每个 shard npz 含：`features (N,64,83)`, `labels`, `global_indices`, `starts`, `ends`。

`holdout/split_meta.json`：`holdout=speaker`, `valRatio=0.15`, `seed=42`（已冻结）。

### 8.3 今天开始 Production Training，Cache 能否直接用？

| 场景 | 能否直接用 | 依据 |
|------|-----------|------|
| **沿用当前 Training 代码（原始 wav）** | **能** | Cache 由同一 `sf.read` + `extract_feature` 路径构建；manifest 有效 |
| **对齐 Runtime `processed_audio` 后** | **必须重建** | `preprocess_pcm_f32` 改变 PCM 幅值/长度；VAD concat 改变时间轴；同一 `WordInfo.start/end` 将切出不同 clip |

**代码依据：** Cache 构建与在线路径均 `sf.read` 无 `preprocess_pcm_f32`（`feature_shard_v2.py` L209-215 = `v2_training_path.py` L81-87）。Runtime 在 `extract_feature` 之前已完成 `preprocess_pcm_f32`（`utterance_audio.py` L79），输入 PCM 不同 → feature 不同。

---

## 九、Training Dataset

| 项 | 当前 Production 配置 |
|----|---------------------|
| **Dataset** | AISHELL-3（`dataset=aishell3`） |
| **Adapter** | `OpenSlrAishell3DatasetAdapter`（OpenSLR + lars76 TextGrid） |
| **Audio** | 原始 `.wav` |
| **Label** | TextGrid 拼音音节 → tone 1-5 |
| **Alignment** | `textgrid_pinyin_v1` |
| **Split** | Speaker holdout 15%（默认） |
| **冻结状态** | Dataset 文件静态；**Feature Cache split_meta 已冻结**；在线路径每次按相同 seed/holdout 可复现 |

**Tone Label：** `alignment_textgrid.tone_label_from_pinyin()` — 拼音尾数字 1-5 → label 0-4。

**动态生成：** 仅当未使用 cache 且重新 `collect_samples` 时重新扫描 TextGrid；非运行时随机标签。

---

## 十、Artifact Pipeline 生命周期

```text
train_tone_v2_model.train_and_save_v2()
        ↓
loader_v1.save_artifact_v1(output_path)          # 写入 .npz
        ↓
validate_artifact_v1.validate_artifact_v1()      # 训练末尾自动调用；失败则 raise
        ↓
[手动] probe_v2_inference.run_inference_probe()  # 独立 CLI，非 gate
        ↓
[手动] 复制 npz 或设置 TONE_MODEL_PATH          # 无 promotion CLI
        ↓
Runtime: loader_v1.ToneModelLoaderV1.load()
        ↓
inference.run_tone_inference()
        ↓
Node → FW HTTP
```

### 10.1 Promotion 机制

**没有正式 Promotion 机制。**  
训练输出路径由 `--output` 控制（默认 `tone_module/models/tone_cnn_p1_v1.npz`）。  
Runtime 通过 `config.TONE_MODEL_PATH` 环境变量或默认 `tone_cnn_p1_v1_full.npz` 加载。  
历史风险：P10 smoke 曾 **覆写** 同名 production 文件（见 `Tone_V2_P10_Artifact_Provenance_Training_Freeze_Audit_2026_07_11.md`）。

---

## 十一、Production Training 是否一键完成

### 11.1 技术上可执行的命令（当前代码，错误音频域）

**全量 GPU 训练（Cache 已存在，单命令）：**

```bash
cd electron_node/services/faster_whisper_vad

python -m tone_module.train_tone_v2_model train \
  --dataset aishell3 \
  --holdout speaker \
  --feature-cache-dir tone_module/_data_cache/datasets/openslr_aishell3/v1/training_features_v2 \
  --training-backend torch \
  --epochs 20 \
  --batch-size 128 \
  --output tone_module/models/tone_cnn_p1_v1_production_YYYYMMDD.npz \
  --training-version production_full_YYYYMMDD
```

### 11.2 实际 Production 步骤（含人工）

| # | 步骤 | 必须？ |
|---|------|--------|
| 1 | 确认 AISHELL-3 数据已物化在 `_data_cache` | 是（或 `--skip-download` 前提已下载） |
| 2 | Feature Cache 构建（若不存在） | 已完成；否则需 `python -m tone_module.build_feature_cache_v2_parallel --dataset aishell3` |
| 3 | `train_tone_v2_model train ...` | 是 |
| 4 | 检查 `validate_artifact_v1` 输出 PASS | 自动 |
| 5 | `python -m tone_module.probe_v2_inference <artifact>` | 建议（非硬 gate） |
| 6 | 设置 `TONE_MODEL_PATH` 或部署 npz + 重启 FW | **人工** |
| 7 | Node E2E 业务验收 | **人工** |

**不是严格单命令闭环** — 部署与验收需人工步骤；且无 promotion gate。

---

## 十二、Runtime 是否无需修改

**是 — 换 Artifact 即可，无需改 Runtime 代码。**

依据：
- `loader_v1.py` 从 `TONE_MODEL_PATH` 或默认路径加载任意合规 P1 npz
- `inference.py` 不硬编码权重；`feature_v2` / `classifier` 接口不变
- `contract.P1_FEATURE_VERSION` / `P1_FEATURE_SHAPE` 未变则 loader 通过

**前提：** 新 artifact 必须符合 `validate_artifact_v1` schema（`formatVersion`, weight keys, `(64,83)→5`）。

---

## 十三、Node 是否完全兼容

| 组件 | 新 Artifact 是否可直接消费 | 说明 |
|------|---------------------------|------|
| **FW Runtime** | **是** | 换 npz 即可 |
| **Node → FW HTTP** | **是** | 协议不变 |
| **FW / Recall / KenLM** | **是** | 不读 tone npz |
| **业务效果** | **不保证** | 模型训练域 ≠ Node 推理域 |

Node 不直接加载 tone 权重；兼容性指 **接口/协议**。模型质量取决于 Training Audio Domain 对齐。

---

## 十四、Node 分割重组是否影响训练（重点）

### 14.1 Node → Runtime 真实路径

```text
Node Opus/base64
        ↓
decode_audio()
        ↓
preprocess_pcm_f32()          # peak + trim
        ↓
[可选] context buffer 前置拼接
        ↓
Silero VAD → refine_vad_segments
        ↓
多段 concat → processed_audio    # 时间轴与原始 utterance 不同
        ↓
Whisper ASR → WordInfo on processed_audio
        ↓
run_tone_inference(processed_audio, segments)
```

### 14.2 Training 是否体现上述路径

**完全没有。**

### 14.3 影响分类

| 影响域 | 严重程度 | 说明 |
|--------|----------|------|
| **Runtime Domain** | 高 | 训练不含 `preprocess_pcm_f32` |
| **Audio Domain** | 高 | 原始 wav vs processed_audio |
| **Feature Domain** | 高 | 同函数、不同输入 → 分布偏移 |
| **Word Boundary** | 高 | 音节 TextGrid vs ASR 字级 |
| **Timestamp** | 高 | 原始时间轴 vs VAD-trim/concat 后时间轴 |
| **Node Opus** | 中-高 | 编解码损失未进入训练 |

### 14.4 核心问题回答

> **Production Training 完成后，模型能否正确适配 Node 分割与重组模式？**

**不能。** 当前训练从未见过 VAD 拼接后的 `processed_audio`，也未使用 ASR 字级边界。P10 Business Effect 审计已观测：`utterance_tone` 切片数 < FW 切片数、`toneExactHitCount=0` 等现象与 Domain 割裂一致。

> **是否会造成 Training 与 Runtime 的 wav/tone 语义割裂？**

**会。** 训练优化的是「原始 AISHELL 音节 + TextGrid」分布；Runtime 推理的是「Node 传输 + 预处理 + VAD + ASR 字级」分布。Feature 函数相同不能消除输入域差异。

---

## 十五、Training Readiness Checklist

| 项目 | Ready | Blocker | 说明 |
|------|-------|---------|------|
| Runtime Contract | ✅ | | inference 已接 `feature_v2` + `numpy_p1` |
| Feature Contract | ✅ | | Production 主链 SSOT 唯一 |
| Feature Cache | ⚠️ | **是*** | 现有 cache 有效但基于错误音频域；对齐后须重建 |
| Audio Pipeline | ❌ | **是** | 无 `preprocess_pcm_f32` / VAD / Opus |
| WordInfo | ⚠️ | **是*** | Type 一致；边界语义不一致 |
| Dataset | ✅ | | AISHELL-3 + TextGrid 已物化 |
| Label | ✅ | | 拼音 tone 1-5 冻结逻辑 |
| Artifact | ✅ | | `save_artifact_v1` + `validate_artifact_v1` 可用 |
| Validation | ✅ | | 训练内建 acceptance |
| Acceptance | ⚠️ | | 无自动 promotion；需人工 E2E |
| Runtime Compatibility | ✅ | | 换 artifact 即可 |
| Node Compatibility | ❌ | **是** | 协议兼容；音频/边界域不兼容 |

\* 随 Audio Pipeline Blocker 连带

---

## 十六、如果今天开始重训 — Training 真正 Blocker

（不含已修复的 Runtime 问题；仅 Training 维度）

| # | 事项 | 是否必须先完成 |
|---|------|----------------|
| 1 | Training 接入 Runtime 同级音频预处理（至少 `preprocess_pcm_f32`） | **是** |
| 2 | 明确 Word Boundary 策略（继续 TextGrid 音节 vs 迁移 ASR 字级）并冻结 | **是** |
| 3 | 按新音频域 **重建 Feature Cache** | **是**（若 #1 改动） |
| 4 | Production artifact 独立命名 + 部署规范（避免覆写 smoke） | 强烈建议（非训练算法 blocker） |
| 5 | Node Opus 域模拟 | 待策略冻结（可与 #1 分阶段） |

**若跳过 #1-3 直接全量训练：** 管线可跑通、可产出 npz，但对 Node 业务 **训练意义不足** — 等价于重复 P9-C3 域偏移实验。

---

## 十七、最终回答（10 问）

### 1. 当前是否已具备 Production Training 条件？

**否。** 管线代码齐全，但音频/边界域未对齐 Node Runtime，不满足 Production 语义条件。

### 2. Training 是否真正复用 Runtime Feature？

**是。** 同一 `tone_module.feature_v2.extract_feature`。

### 3. Training 是否真正匹配 Runtime Audio Contract？

**否。** 训练用原始 wav；Runtime 用 `processed_audio`（preprocess + VAD concat）。

### 4. Training 是否真正匹配 Node Audio Pipeline？

**否。** 无 Opus、无 Aggregator、无 `processed_audio` 路径。

### 5. Node 分割重组是否已能被 Production Model 正确学习？

**否。** 训练数据未体现该模式。

### 6. 训练结束后 Runtime 是否无需任何代码修改？

**是。** 仅需更新 Artifact / `TONE_MODEL_PATH`。

### 7. Feature Cache 是否需要重建？

| 条件 | 答案 |
|------|------|
| 维持当前（原始 wav）训练 | **不需要** — 997,992 样本 cache 可直接用 |
| 对齐 Runtime `processed_audio` | **必须重建** — 代码路径将改变 PCM 与切分基准 |

### 8. 今天是否可以开始 Production Full Training？

**不可以**（若「Production」指 Node 业务可用的模型）。

### 9. 如果不能，唯一 Blocker 是什么？

**Training Audio Pipeline 未对齐 Runtime `processed_audio` 域**（含 Word Boundary 时间轴与粒度差异）。

### 10. 下一步唯一正确动作

**冻结 Training Audio Domain 规范 → 在 `v2_training_path` / `feature_shard_v2` / `feature_cache_v2_parallel` 接入 `preprocess_pcm_f32`（及既定的边界策略）→ 重建 Feature Cache → 执行 Production Full GPU Training → 写入独立 Production 文件名 → 人工设置 `TONE_MODEL_PATH` → Node E2E 验收。**

---

## 十八、最终 Verdict

# C — Training Blocked

存在真正 Blocker，必须先修复 Training Audio Domain 对齐，否则 Production Full Training 对 Node 业务无意义。

---

## 附录 A — 关键文件索引

| 用途 | 路径 |
|------|------|
| Production 训练 CLI | `tone_module/train_tone_v2_model.py` |
| Feature SSOT | `tone_module/feature_v2.py` |
| Runtime 推理 | `tone_module/inference.py` |
| Runtime 音频预处理 | `audio_preprocess.py`, `utterance_audio.py` |
| WordInfo Adapter | `tone_module/training_io/syllable_to_wordinfo.py` |
| Cache 构建 | `tone_module/build_feature_cache_v2_parallel.py` |
| Artifact 保存/加载 | `tone_module/loader_v1.py` |
| Artifact 验收 | `tone_module/validate_artifact_v1.py` |
| Runtime 模型路径 | `config.py` → `TONE_MODEL_PATH` |
| P9-C3 全量训练记录 | `docs/tone-v2/Tone_V2_P9_C3_Full_Feature_Cache_GPU_CNN_Training_Report.md` |
| P10 Artifact 溯源 | `docs/tone-v2/Tone_V2_P10_Artifact_Provenance_Training_Freeze_Audit_2026_07_11.md` |

---

*本报告仅基于 2026-07-12 代码库只读审计，未执行训练或修改任何组件。*
