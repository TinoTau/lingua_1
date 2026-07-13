# Tone V2 Phase 7-B — Training Engineering 开发前代码审计报告

**Date:** 2026-06-29  
**Audit Type:** Read-only Pre-Development Code Audit（**非训练** · **非 Runtime 开发**）  
**Scope:** 确认当前训练系统是否已具备 **AISHELL-3 Canonical Dataset** 全量训练能力；分析 Training Pipeline 性能 / 内存 / 工程缺陷  
**禁止项（本轮）：** 训练 `tone_cnn_p3` · 生成权重 · 修改 Runtime / Loader / Contract / Feature Baseline / Dataset Foundation / Validation / Artifact / Node E2E

**依据 SSOT：**

- [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)
- [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)
- [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md)
- [Tone_V2_Phase7A_AISHELL3_Full_Dataset_Acceptance_Report.md](./Tone_V2_Phase7A_AISHELL3_Full_Dataset_Acceptance_Report.md)
- [Tone_V2_Phase7A_Dataset_Foundation_Freeze_Report.md](./Tone_V2_Phase7A_Dataset_Foundation_Freeze_Report.md)
- **代码锚点：** `train_tone_cnn.py` · `mel.py` · `dataset/pipeline.py` · `validate_artifact.py` · `offline_tone_eval.py`

---

## Executive Summary

| 审计问题 | 结论 |
|----------|------|
| AISHELL-3 **数据层**是否就绪？ | **是** — P7-A Level 2 全量验收 **PASS**（997,992 音节 · join 100%） |
| `train_tone_cnn` 能否**安全**全量训练 Canonical？ | **否** — `_build_feature_matrix` 全文件 `audio_cache` 导致 **OOM** |
| 是否一次加载全部 Feature？ | **是** — train/val 各构建完整 `np.ndarray` 驻留 RAM |
| Feature Shard / Streaming / Memmap | **不存在** |
| Speaker-stratified Holdout | **不存在** — 仅 utterance 级 15% 随机 |
| `aishell3_pipeline` 是否接入 `train_and_save`？ | **否** — 硬编码 `default_data_mini_pipeline` |
| GPU 训练 | **否** — 纯 NumPy CPU |
| 修改 Dataset Foundation 是否必要？ | **否** |
| 修改 Runtime / Validation / Artifact 是否必要？ | **否**（7-B 仅训练编排层） |

### Final Verdict: **CONDITIONAL PASS**

**含义：**

- **Dataset / Canonical 语料条件已满足**（P7-A 冻结验收完成）。
- **Training Engineering 尚未满足全量开训条件**；须 Phase 7-B 在 **单一** `train_tone_cnn.py` 编排层交付 Feature Shard + 惰性特征路径 + AISHELL 接线 +（建议）Speaker Holdout 后，方可启动 `tone_cnn_p3` 全量训练。

---

## Training Pipeline Audit

### 当前主链（审计日代码）

```text
[FROZEN — Dataset Foundation]
aishell3_pipeline() / default_data_mini_pipeline()
    → List[SyllableSample] + DatasetManifest

[BOTTLENECK — Training Orchestration · 未工程化]
split_val_holdout_samples (utterance 随机 15%)
    → _build_feature_matrix (全量 audio_cache + 全量 np.stack)
    → normalize (train mean/std)
    → _train_mlp (全矩阵驻留 · 随机 mini-batch 索引)
    → np.savez
    → validate_artifact (acceptance_mel = 全量 val 特征)
    → offline_tone_eval (val 特征)

[FROZEN — 不得为 7-B 修改语义]
contract.py · mel.py · loader.py · validate_artifact 门禁 · inference.py
```

### 关键代码事实

**1. 默认数据源硬编码为 Regression Fixture**

```217:219:electron_node/services/faster_whisper_vad/tone_module/train_tone_cnn.py
    samples, manifest = default_data_mini_pipeline(
        cache_dir, dataset_repo=dataset_repo, dataset_zip=dataset_zip
    )
```

`aishell3_pipeline` 已在 `dataset/pipeline.py` 导出，**未**进入 `train_and_save` / CLI。

**2. 特征矩阵一次性全量构建**

```92:108:electron_node/services/faster_whisper_vad/tone_module/train_tone_cnn.py
def _build_feature_matrix(samples: Sequence[SyllableSample]) -> Tuple[np.ndarray, np.ndarray]:
    xs: List[np.ndarray] = []
    ys: List[int] = []
    audio_cache: dict[str, Tuple[np.ndarray, int]] = {}

    for sample in samples:
        if sample.wav_path not in audio_cache:
            audio, sr = sf.read(sample.wav_path, dtype="float32")
            ...
        clip = _slice_audio(audio, sr, sample.start, sample.end)
        xs.append(extract_mel_features(clip, sr))
        ys.append(sample.label)

    return np.stack(xs, axis=0).astype(np.float32), np.array(ys, dtype=np.int64)
```

**3. 训练循环假定 `x_train` / `x_val` 全量在 RAM**

```133:138:electron_node/services/faster_whisper_vad/tone_module/train_tone_cnn.py
    for epoch in range(1, epochs + 1):
        order = rng.permutation(n)
        for start in range(0, n, batch_size):
            idx = order[start : start + batch_size]
            xb = x_train[idx]
```

**4. Holdout 为 utterance 级随机，非 speaker-stratified**

```57:71:electron_node/services/faster_whisper_vad/tone_module/train_tone_cnn.py
def split_val_holdout_samples(
    samples: Sequence[SyllableSample],
    *,
    val_ratio: float = 0.15,
    seed: int = 42,
) -> Tuple[List[SyllableSample], List[SyllableSample]]:
    """Utterance-level holdout split (same logic as train_and_save)."""
    ...
    utterances = sorted({os.path.basename(s.wav_path) for s in samples})
    rng.shuffle(utterances)
```

**5. 单训练入口** — 仓库内仅 `train_tone_cnn.py`（**KEEP**）

**6. `offline_tone_eval` / `load_val_holdout_features`** — 仅重建 **data_mini** holdout，与 Canonical 不同源。

---

## Memory Analysis

**Canonical 规模（P7-A 实测）：** 218 speakers · 88,035 utterances · **997,992** syllables

| 阶段 | data_mini（11,820） | AISHELL Canonical（~998k） | 判定 |
|------|---------------------|---------------------------|------|
| `collect_samples` 元数据列表 | ~MB | **~0.5–2 GB**（Python 对象） | 勉强可 |
| **`audio_cache` 全 wav `sf.read`** | 小集可承受 | **~50–60 GB**（≈85 h · 44.1 kHz · f32） | **CRITICAL OOM** |
| `np.stack` 特征矩阵（未归一化） | ~3.8 MB | **~305 MB**（998k×80×f32） | 可 |
| 归一化后 train+val 驻留 | ~8 MB | **~610 MB** | 可 |
| `_train_mlp` 梯度临时量 | <100 MB | **<1 GB** | 可 |
| `validate_artifact` acceptance 批 | ~1 MB | **~46 MB**（val ~150k×80） | 可 |

### OOM 风险裁决

| 风险 | 严重度 | 触发路径 |
|------|--------|----------|
| `audio_cache` 缓存整文件 wav | **CRITICAL** | 对 Canonical 直接调用现有 `_build_feature_matrix` |
| 双遍特征构建（train + val 各一次） | **HIGH** | 现有 `train_and_save` L226–227；无 cache 时重复 I/O |
| 全量 `List[SyllableSample]` | **MED** | `aishell3_pipeline` 一次加载 ~1M 条 |

**结论：** 瓶颈 **不是** MLP 权重或最终特征矩阵体积，而是 **按 utterance 全文件读入 audio_cache** 的设计。

---

## Feature Engineering Analysis

| 项 | 现状 | Canonical 全量影响 |
|----|------|-------------------|
| Feature SSOT | `mel.extract_mel_features` ← `contract.P0_*` | **KEEP** — 不得改 `mel.py` |
| 提取粒度 | 逐 syllable 同步 STFT | ~998k 次；CPU 密集 |
| 批量 / 并行 | **无** | 冷启动特征阶段 **数小时** 级（若按需读切片、无全文件 cache） |
| Feature Cache | **无** | 每次训练重复 mel |
| Shard | **无** | 无法增量 / 断点 |
| Memmap | **无** | epoch 必须全矩阵 |
| Streaming mel | **无** | 与 Shard 二选一或组合 |

### Feature Matrix 是否需要 Shard？

**是（必须）。** 理由：

1. 消除 `audio_cache` 路径 — 改为 **预计算 mel shard** 或 **utterance 级按需读切片**（不缓存整 wav）。
2. 一次性特征构建可 **断点续跑**（88k utterances · 运维可恢复）。
3. 建议布局（不修改 Dataset Foundation 槽语义，仅新增子目录）：

```text
{cache}/datasets/openslr_aishell3/v1/features/
  shard_000.npz   # mel (N,80) · labels · optional index
  shard_001.npz
  manifest_features.json
```

预估磁盘：**~320–400 MB**（仅 mel+labels f32），远低于 materialized **~25–30 GB**。

### Mel Feature 是否需要 Streaming？

**是（必须，可与 Shard 组合）。** 至少满足其一：

| 方案 | 说明 |
|------|------|
| **A. Shard + 训练时索引切片** | 预计算落盘；`_train_mlp` 按 batch 从 shard/memmap 取行 |
| **B. Epoch Generator** | 每 batch 从 `SyllableSample` 读 wav 切片 → mel（**禁止** audio_cache 全文件） |

仅 B 无缓存则每 epoch 重复 **数小时** mel；**推荐 A+B**：build-shard 一次，训练读 shard。

---

## Dataset Cache Analysis

| 层级 | 现状 | Shard 需求 |
|------|------|------------|
| Dataset materialized | P7-A 已验收 · `CacheLayout` 冻结 | **KEEP** |
| Feature 层 | **无** | **MODIFY**（训练编排新增 `features/`，不改 `cache_layout.py` 契约） |
| Dataset Cache Shard | **无** | 与 Feature Shard 同义（本审计指 **Feature Shard**） |

**Feature Cache 是否还能扩展？** — 当前代码 **无槽位**；可在 **不修改** `CacheLayout` / Adapter 前提下，于 `train_tone_cnn` 或邻接模块新增 `features/` 读写（7-B 范围）。

---

## Training Throughput Analysis

**基线（Regression Fixture · P6-D smoke）：** 11,820 syllables · 80 epochs · **~31 s** 端到端（含特征+MLP+validate）。

### Canonical 粗算（998k syllables · 15% utterance val）

| 阶段 | 粗估 | 说明 |
|------|------|------|
| `collect_samples` walk | **10–25 min** | P7-A `accept` 双遍 TextGrid 约 ~20 min 参考 |
| 特征提取（冷启动 · 无 shard · 按需切片） | **2–8 h** | I/O + scipy STFT × 998k |
| 特征提取（现有 audio_cache 路径） | **不可完成** | OOM |
| MLP 80 epoch（特征已在 RAM） | **~40–90 min** | batch 数 ≈ mini 的 **~71×**（848k/12k） |
| **端到端（现有代码路径）** | **FAIL** | OOM 于特征阶段 |

### Mini-batch Streaming

| 项 | 支持？ |
|----|--------|
| 训练循环按 batch 索引 | **是** — 但索引对象须全量在 RAM |
| 特征惰性供给 | **否** |
| 跨 epoch 无重复 mel | **否**（无 shard） |

---

## GPU / CPU Resource Analysis

| 资源 | 现状 | AISHELL Canonical |
|------|------|-------------------|
| **GPU** | **未使用** — `train_tone_cnn` 纯 NumPy | **0 GPU**；与 Tone Runtime 一致 |
| **CPU** | scipy STFT + 矩阵乘 | 特征阶段 **多核未利用**；MLP 单线程 NumPy |
| **RAM 下限（安全路径）** | data_mini <1 GB | 特征 shard 后 **~2–4 GB** 可训 |
| **RAM（现状路径）** | — | **>50 GB 峰值 → OOM** |
| **磁盘** | materialized ~25–30 GB 已有 | +feature shard **<0.5 GB** |

**裁决：** CPU / 磁盘 **满足**；**RAM 工程路径不满足**（须 7-B）。

---

## Training Engineering Matrix

| # | 能力 | 现状 | Canonical 全量 | 改 Runtime？ | 改 Dataset Foundation？ | Action |
|---|------|------|----------------|-------------|-------------------------|--------|
| 1 | Canonical 语料接入 | P7-A PASS | ✅ | 否 | 否 | **KEEP** |
| 2 | `aishell3_pipeline` → train | 未接线 | ❌ | 否 | 否 | **MODIFY** |
| 3 | 全文件 `audio_cache` | 存在 | ❌ OOM | 否 | 否 | **MODIFY** |
| 4 | 全量特征矩阵 RAM | 存在 | ⚠️ ~600 MB 可承受 | 否 | 否 | **MODIFY**（shard/memmap） |
| 5 | Feature Shard 构建 | 无 | ❌ | 否 | 否 | **MODIFY** |
| 6 | Streaming / memmap epoch | 无 | ❌ | 否 | 否 | **MODIFY** |
| 7 | Speaker Holdout | 无 | ⚠️ 泄漏风险 | 否 | 否 | **MODIFY**（P1） |
| 8 | Class weight / focal | 无 | 可选 | 否 | 否 | **DEFER**（P2） |
| 9 | `load_val_holdout_features` Canonical | data_mini only | ❌ | 否 | 否 | **MODIFY** |
| 10 | `validate_artifact` 门禁 | 可用 | ✅（val 批变大仍可行） | **KEEP** | 否 | **KEEP** |
| 11 | 第二训练入口 | 无 | — | — | — | **KEEP** |
| 12 | `mel.py` / `contract.py` | 冻结 | — | **KEEP** | **KEEP** | **KEEP** |

---

## Architecture Drift Audit

| 检查项 | Expected | Actual | Action |
|--------|----------|--------|--------|
| 单训练入口 | 仅 `train_tone_cnn.py` | ✅ | **KEEP** |
| Dataset Foundation 冻结 | P7-A SSOT | 本轮未改代码 | **KEEP** |
| Feature Baseline | `mel.py` + `contract.P0_*` | 未改 | **KEEP** |
| Artifact schema | Phase 3 冻结 | 未改 | **KEEP** |
| 第二 Training Pipeline | 禁止 | 未发现 | **KEEP** |
| train 默认 Regression Fixture | `data_mini` | 符合 | **KEEP**（7-B 增 CLI 选 Canonical） |

**Material Drift：** 无（本轮零代码变更）。

---

## Required Development Matrix（Phase 7-B 建议）

| ID | 开发项 | 目的 | 触达 | 优先级 | Action |
|----|--------|------|------|--------|--------|
| RD-P7B-01 | 移除/旁路 `audio_cache` 全文件策略 | 消除 OOM | `train_tone_cnn` 特征路径 | **P0** | **MODIFY** |
| RD-P7B-02 | Feature Shard 构建子命令或函数 | 一次 mel · 可恢复 | 新模块或 `train_tone_cnn` 子命令 | **P0** | **ADD** |
| RD-P7B-03 | Epoch 从 shard/memmap 读 batch | 不全量驻留特征 | `_train_mlp` 输入 | **P0** | **MODIFY** |
| RD-P7B-04 | `train_and_save` 接 `aishell3_pipeline` / CLI `--dataset` | Canonical 接线 | CLI + `train_and_save` | **P0** | **MODIFY** |
| RD-P7B-05 | `split_speaker_holdout` | 泛化评估 | `split_*` 新函数 | **P1** | **ADD** |
| RD-P7B-06 | `load_val_holdout_features` Canonical 同源 | offline eval 一致 | `train_tone_cnn` / `offline_tone_eval` | **P1** | **MODIFY** |
| RD-P7B-07 | 可选 `--class-weight` | t5 改善 | `_train_mlp` | **P2** | **DEFER** |
| RD-P7B-08 | 特征构建并行（multiprocessing） | 缩短冷启动 | shard builder | **P2** | **OPTIONAL** |
| RD-P7B-09 | Pilot 子集训练（10k–100k syll） | 工程验证 | CLI `--max-syllables` | **P1** | **ADD** |
| RD-P7B-10 | p3 全量训练 + validate | 交付 | 7-B 完成后 | **P2** | 依赖 P0 |

**明确 KEEP：** `dataset/*` 冻结体 · `mel.py` · `contract.py` · `validate_artifact` 语义 · `loader` · Runtime · Node E2E。

---

## Hardcode Audit（§14）

| 类型 | 位置 | 内容 | 7-B 处置 |
|------|------|------|----------|
| **Dataset Hardcode** | `train_and_save` L217 | `default_data_mini_pipeline` | **MODIFY** — CLI 选择 Canonical |
| **Dataset Hardcode** | `load_val_holdout_features` | 仅 data_mini | **MODIFY** |
| **Path Hardcode** | `CACHE_DIR` · `DEFAULT_OUT` | `_data_cache` · `models/tone_cnn_p0.npz` | **KEEP** 默认；CLI 已可覆盖 output |
| **Batch Hardcode** | `main()` | `batch_size=128` | **KEEP** 默认；CLI 已有 `--batch-size` |
| **Memory Hardcode** | `_build_feature_matrix` | 无界 `audio_cache` | **MODIFY** — 核心 |
| **Training Hardcode** | `epochs=80` · `lr=0.05` · `val_ratio=0.15` · `seed=42` | CLI 可覆盖 | **KEEP** 默认 |

---

## KEEP / MODIFY / RESTORE / DELETE

| 处置 | 项 |
|------|-----|
| **KEEP** | 单 `train_tone_cnn` · P0 MLP 结构 · `mel.py` / `contract.py` · Artifact / validate 链 · Dataset Foundation 全部冻结组件 |
| **KEEP** | `aishell3_pipeline`（已存在）· `default_data_mini_pipeline` 回归默认 |
| **MODIFY** | `_build_feature_matrix` / 特征供给路径 |
| **MODIFY** | `_train_mlp` 输入 — shard/memmap/generator |
| **MODIFY** | `train_and_save` / CLI — Canonical 接线 · holdout 策略 |
| **MODIFY** | `load_val_holdout_features` — 与训练同源 |
| **ADD** | Feature Shard 构建与 `features/` 布局 |
| **ADD** | `split_speaker_holdout`（建议） |
| **RESTORE** | — |
| **DELETE** | — （**禁止**第二训练脚本） |

---

## Remaining Risks

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| 7-B 误触 Dataset Foundation | MED | Code Review 对照 `TONE_V2_DATASET_FOUNDATION_FREEZE.md` §7 |
| Shard 与 train 归一化一致性 | MED | mean/std 仅 fit train shard；写入 artifact |
| Speaker 泄漏（ utterance holdout） | MED | RD-P7B-05 |
| 特征冷启动耗时 | MED | Shard 一次构建 · 可选并行 |
| 7-B 范围膨胀（class weight / GPU） | LOW | 严格 P0/P1 门槛 |
| p3 质量未保证 | — | 7-B 后单独训练轮次 + offline + E2E |

---

## 终局问题答复

| # | 问题 | 答案 |
|---|------|------|
| 1 | AISHELL-3 **是否已经具备训练条件**？ | **数据层：是**（P7-A PASS）。**训练工程：否** — 现有 `train_tone_cnn` 全量路径 **OOM**。 |
| 2 | **当前最大的训练瓶颈**？ | **`_build_feature_matrix` 的 `audio_cache` 全 wav 加载**（~50 GB+ 峰值 RAM）。 |
| 3 | **是否必须实现 Feature Shard**？ | **是（P0）** — 消除重复 mel + 避免全文件 cache + 支持断点。 |
| 4 | **是否必须实现 Streaming Feature**？ | **是（P0）** — 至少 epoch 级惰性读 shard/memmap；禁止全矩阵 + 全 audio_cache 组合。 |
| 5 | **是否必须实现 Speaker Holdout**？ | **强烈建议（P1）** — 非绝对阻塞 shard 构建，但 **p3 全量训练前应交付** 以免 speaker 泄漏。 |
| 6 | **是否需要修改 Dataset Foundation**？ | **否。** 仅调用既有 `aishell3_pipeline` / manifest。 |
| 7 | **是否需要修改 Runtime**？ | **否。** |
| 8 | **完成 Training Engineering 后即可开训 p3？** | **是（条件性）** — 7-B P0 交付 + 回归门 PASS + **不修改** validate/artifact 语义后，可启动 `tone_cnn_p3` 全量训练。 |

### 训练工程完成后无需修改的冻结层

| 层 | 7-B 后 |
|----|--------|
| Dataset Foundation | **无需修改** |
| Runtime / Loader / Contract / Feature Baseline | **无需修改** |
| Validation Pipeline / Artifact Contract | **无需修改**（仍用现有 `validate_artifact` + acceptance 批） |
| Node E2E | **无需修改**（p3 训练后单独 Runtime Validation） |

---

## Final Verdict

### **CONDITIONAL PASS**

**审计结论：** Phase 7-B **可以且应当开始** Training Engineering 开发；**不得**在当前代码状态下启动 Canonical 全量 `tone_cnn_p3` 训练。

| 维度 | 状态 |
|------|------|
| Canonical Dataset（Level 2） | ✅ READY |
| Training Pipeline（全量） | ❌ NOT READY |
| 冻结架构合规 | ✅ 7-B 可在 `train_tone_cnn` 编排层 MODIFY |
| 阻塞项清晰度 | ✅ P0 三项：去 audio_cache · Feature Shard · Streaming/memmap epoch |

**下一步：** 执行 RD-P7B-01～04（P0）→ Pilot 子集训练验证 → Speaker Holdout（P1）→ `tone_cnn_p3` 全量训练（Phase 7-C）。

---

*Phase 7-B Pre-Development Audit — read-only · no code / weights / training executed.*
