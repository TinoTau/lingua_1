# Tone V2 Phase 7 — AISHELL-3 Integration & Model Quality Improvement 开发前代码审计报告

**Date:** 2026-06-29  
**Audit Type:** Read-only Pre-Development Code Audit（**非训练** · **非 Runtime 开发**）  
**Scope:** 确认当前平台是否已具备 **AISHELL-3 全量数据接入** 与 **`tone_cnn_p3` 真正模型训练** 能力  
**禁止项（本轮）：** 训练 `tone_cnn_p3` · 生成权重 · 修改 Runtime / Loader / Contract / Feature Baseline / Validation Pipeline / Artifact Contract / Node E2E

**依据 SSOT：**

- [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)
- [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md)
- [Tone_V2_Phase6C_Training_Data_Expansion_PreDev_Audit_Report.md](./Tone_V2_Phase6C_Training_Data_Expansion_PreDev_Audit_Report.md)
- [Tone_V2_Phase6D_Dataset_Pipeline_Foundation_Development_Report.md](./Tone_V2_Phase6D_Dataset_Pipeline_Foundation_Development_Report.md)
- [Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Development_Report.md](./Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Development_Report.md)
- **代码锚点：** `tone_module/dataset/*` · `train_tone_cnn.py` · `mel.py` · `contract.py` · `validate_artifact.py`

---

## Executive Summary

| 审计问题 | 结论 |
|----------|------|
| AISHELL-3 下载 / materialize 能力是否具备？ | **是（代码已交付）** — `OpenSlrAishell3DatasetAdapter` + 本地路径 / `urlretrieve` |
| Dataset Probe（Join / Statistics）是否具备？ | **是** — `probe_aishell3` + Fixture Test；**全量未实测** |
| Alignment / `SyllableSample` 契约是否满足？ | **是** — 复用 `TextGridPinyinAlignmentProvider` |
| `train_tone_cnn` 能否处理 ~200 万音节？ | **否** — 内存与一次性特征矩阵 **不可行** |
| Feature Cache / Streaming / Shard 是否存在？ | **否** — 代码库 **无** |
| Speaker-stratified holdout / class balance？ | **否** — 仅 utterance 级 15% 随机划分 |
| `tone_cnn_p3` 是否可直接开训？ | **否** — 须先 **MODIFY 训练侧工程**（非 Runtime） |
| 是否需要「新 Training Engine」？ | **否（第二链路）** · **是（训练编排增强）** — 仍在单 `train_tone_cnn` 内扩展 |
| GPU 训练？ | **否** — P0 MLP 为 **纯 NumPy CPU** |
| Runtime / 冻结层是否需改？ | **否** — Phase 7 训练数据扩展 **不触碰** 冻结层 |

### Final Verdict: **CONDITIONAL PASS**

**含义：**

- **AISHELL-3 全量接入（Level 2 Dataset Probe + materialize）** — **可以开始**（需磁盘 ~25–30 GB、下载带宽、全量 Join Audit 验收）。
- **`tone_cnn_p3` 全量真正训练** — **尚不可开始**；须 Phase 7 先交付 **Feature Shard / 流式 mel / speaker holdout / train↔aishell3 接线** 后，再开训。

---

## 最终问题答复

| # | 问题 | 答案 |
|---|------|------|
| 1 | 是否已经可以开始 **AISHELL-3 全量接入**？ | **CONDITIONAL YES** — Adapter + Probe 已就绪；须完成全量 materialize + Join Audit ≥99% + 全量 Dataset Statistics Probe（**不训练**）。 |
| 2 | 是否已经可以真正开始 **`tone_cnn_p3` 训练**？ | **NO（全量）** — `train_tone_cnn` 当前架构无法承载 ~2M 音节。 |
| 3 | 是否需要新 Training Engine？ | **需要训练侧增强（MODIFY）**，**禁止**第二训练入口 / 第二链路；扩展 **同一** `train_tone_cnn.py` 编排层。 |

---

## Frozen Architecture Verification

### 训练 vs Runtime 边界（审计日代码）

```text
[已就绪 — Training Foundation 数据层]
OpenSlrAishell3DatasetAdapter → TextGridPinyinAlignmentProvider → SyllableSample[]
→ probe_aishell3（Level 2 Dataset Probe）

[瓶颈 — Training 编排层 · 未扩展]
SyllableSample[] → _build_feature_matrix（全量 RAM）→ _train_mlp → npz
→ validate_artifact → offline_tone_eval

[冻结 — 不得为 Phase 7 修改]
contract.py · mel.py（Feature Baseline）· loader.py · inference.py · validate_artifact 门禁 · Node E2E
```

| 检查项 | Expected | Actual | Action |
|--------|----------|--------|--------|
| 单训练入口 | 仅 `train_tone_cnn.py` | 符合 | **KEEP** |
| Dataset 可插拔 | Adapter + Provider | P6-D/E 已落地 | **KEEP** |
| AISHELL Adapter | `OpenSlrAishell3DatasetAdapter` | 已实现 | **KEEP** |
| train 默认数据源 | `data_mini` | `default_data_mini_pipeline` 硬编码 | **KEEP**（p3 前 MODIFY 接线） |
| 全量特征工程 | 分片 / 缓存 | **不存在** | **MODIFY** |
| 第二训练链路 | 禁止 | 未发现 | **KEEP** |
| Runtime 隔离 | dataset 不 import Decision | 测试覆盖 | **KEEP** |

**Material Runtime Drift：无**

---

## 分项审计（20 项）

### 1. AISHELL-3 下载流程

| 项 | 审计结论 |
|----|----------|
| **实现** | `adapter_openslr_aishell3.py` — `urlretrieve` 下载 OpenSLR `data_aishell3.tgz`；lars76 `aishell3_textgrid_files.zip` |
| **本地跳过** | `OPENSRL_AISHELL3_TGZ` · `AISHELL3_TEXTGRID_ZIP` · `--openslr-tgz` · `--local-audio-root` · `--skip-download` |
| **规模** | ~19 GB tgz + TextGrid zip；解压后磁盘 ~25–30 GB |
| **风险** | 无断点续传 · 无 checksum 校验 · Windows 大文件解压耗时 |
| **Action** | **KEEP** 主路径；**MODIFY** 可选 checksum / 进度（P7 运维增强） |

### 2. Materialize

| 项 | 审计结论 |
|----|----------|
| **布局** | `{cache}/datasets/openslr_aishell3/v1/materialized/{audio,alignment}` |
| **幂等** | manifest 命中 + `is_materialized_root_valid`；`.extracted` marker |
| **链接策略** | `symlink` 失败则 `copytree`（大集慎用 copy） |
| **Action** | **KEEP** |

### 3. Dataset Adapter

| 项 | 审计结论 |
|----|----------|
| **类** | `OpenSlrAishell3DatasetAdapter` — 仅 materialize + manifest |
| **契约** | 实现 `DatasetAdapter` 协议；不产 `SyllableSample` |
| **Action** | **KEEP** |

### 4. Alignment Provider

| 项 | 审计结论 |
|----|----------|
| **实现** | `TextGridPinyinAlignmentProvider` — basename join · pinyin+tone → label 0..4 |
| **全量** | `collect_samples()` 全树 `os.walk` — **无** 流式 / 分片 |
| **Action** | **KEEP** Provider；全量 walk **耗时可接受**（元数据）；与训练特征提取 **解耦** |

### 5. Dataset Probe

| 项 | 审计结论 |
|----|----------|
| **CLI** | `python -m tone_module.dataset.probe_aishell3` — materialize / join-audit / stats |
| **限流** | `--max-utterances` · `--max-speakers` · `--speaker-ids` |
| **全量** | **未在仓库内实测** 88k utt / ~2M syllable |
| **Action** | **KEEP**；P7 首步须跑 **全量 Join Audit**（Level 2，非训练） |

### 6. Cache

| 项 | 审计结论 |
|----|----------|
| **实现** | `CacheLayout` — `datasets/{id}/{version}/` 多槽 |
| **共存** | `openslr_aishell3/v1` 与 `CS5647Team3_data_mini/v1` 隔离 |
| **特征缓存槽** | **无** `features/` shard 目录约定 |
| **Action** | **KEEP** 数据槽；**MODIFY** 新增 feature shard 槽（P7） |

### 7. Manifest

| 项 | 审计结论 |
|----|----------|
| **字段** | `dataset_id` · `version` · `materialized_root` · `alignment_source` · metadata |
| **计数** | `enrich_manifest_counts` — speaker / utterance / syllable（需完整 `collect_samples` 后） |
| **Action** | **KEEP**；全量 probe 后写入计数 |

### 8. Dataset Metadata

| 项 | 审计结论 |
|----|----------|
| **写入** | `DatasetMetadata` → manifest → artifact `notes` / `metrics`（训练时） |
| **许可** | Apache 2.0 + lars76 LICENSE 附注 |
| **p3 期望** | `datasetVersion=openslr_slr93_full` · `speakerCount=218` 等 |
| **Action** | **KEEP** |

### 9. Feature Engineering

| 项 | 审计结论 |
|----|----------|
| **SSOT** | `mel.extract_mel_features` — 80-d time-avg log-mel · `p0-v1` |
| **重采样** | 44.1→16 kHz 线性 `np.interp`（与 Runtime 防御性策略一致） |
| **切片** | `_slice_audio` + `P0_MIN_SLICE_SEC` 在 Provider 侧过滤 |
| **批量** | 逐样本同步提取；**无**并行 · **无**预计算缓存 |
| **Action** | **KEEP** `mel.py` / contract；**MODIFY** 训练侧 **调用方式**（分片 / 惰性） |

### 10. `train_tone_cnn` 能否处理 ~200 万 syllables？

| 阶段 | 11,820（data_mini） | ~2,000,000（AISHELL 粗估） | 可行性 |
|------|---------------------|---------------------------|--------|
| `collect_samples` | ~秒级 | 分钟–十分钟级 walk | **勉强** |
| `List[SyllableSample]` RAM | ~MB 级 | ~0.5–2 GB 元数据 | **可** |
| `_build_feature_matrix` + `audio_cache` | 全 wav 缓存小集 | **~88k 文件 × 全文件 `sf.read`** → **数十 GB RAM** | **FAIL** |
| `np.stack` 特征矩阵 | ~3.8 MB | **~640 MB**（2M×80×f32） | **可** |
| `_train_mlp` 全矩阵驻留 | ~31 s / 80 epoch | 粗估 **数十–百+ CPU 小时** | **慢但可**（若特征已就绪） |

**裁决：** 当前 `train_and_save` **不能**安全处理全量 AISHELL-3。

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
```

| **Action** | **MODIFY** `_build_feature_matrix` 路径或替换为 shard 读取 |

### 11. Memory Risk

| 风险源 | 粗估峰值 | 严重度 |
|--------|----------|--------|
| `audio_cache` 全文件加载 | **~50–60 GB**（85 h · 44.1 kHz · f32） | **CRITICAL** |
| 训练 + 验证特征矩阵 | **~700 MB** | LOW |
| `collect_samples` 列表 | **~1–2 GB** | MED |
| MLP 梯度临时张量 | **< 1 GB** | LOW |
| 磁盘 materialize | **~25–30 GB** | MED（非 RAM） |

**Action：** **MODIFY** — 禁止全量 `audio_cache`；utterance 级按需读盘或预计算 shard。

### 12. Feature Cache

| 项 | 状态 |
|----|------|
| 代码 | **不存在** |
| 建议布局 | `{cache}/datasets/openslr_aishell3/v1/features/shard_{000..}.npz` 或 memmap |
| 内容 | `mel (N,80)` · `labels` · optional `utt_id` |
| **Action** | **MODIFY**（P7 必交付项） |

### 13. Streaming

| 项 | 状态 |
|----|------|
| 代码 | **不存在** — epoch 循环假定 `x_train` 全量在 RAM |
| 需要 | mini-batch **惰性**从 shard 读取 · 或 generator |
| **Action** | **MODIFY** |

### 14. Shard

| 项 | 状态 |
|----|------|
| 代码 | **不存在** |
| 建议 | 按 speaker 或固定 syllable 数（如 50k/shard）切分 |
| **Action** | **MODIFY** |

### 15. Speaker Holdout

| 项 | 状态 |
|----|------|
| 现状 | `split_val_holdout_samples` — **utterance 级** 15% 随机 |
| 问题 | 218 说话人下 utterance 随机 **可能** 泄漏同一 speaker 到 train/val |
| P6-C 建议 | **speaker-stratified** utterance holdout |
| **Action** | **MODIFY** `split_val_holdout_samples` 或新增 `split_speaker_holdout` |

### 16. Train Holdout

| 项 | 状态 |
|----|------|
| 现状 | 单次 15% val · seed=42 · 与 train 同 pipeline |
| `load_val_holdout_features` | **仅** `default_data_mini_pipeline` |
| **Action** | **MODIFY** — 与 AISHELL manifest 同源 · speaker holdout 一致 |

### 17. Class Balance

| 项 | 状态 |
|----|------|
| 现状 | 均匀 mini-batch · **无** class weight · **无** focal loss |
| data_mini | t5 **4.4%**（518/11820） |
| AISHELL 预期 | t5 绝对量增加但占比仍可能 **~4–6%** |
| P6-C | 可选 class weight（**仅训练脚本**） |
| **Action** | **MODIFY**（推荐 P7 可选 `--class-weight`） |

### 18. 训练时间预估（粗算）

**基线：** data_mini 11,820 syllables · 80 epochs · **~31 s**（P6-D smoke）。

| 假设 | 全量 ~2M syllables |
|------|-------------------|
| 特征提取（若逐 syllable 同步、无 cache 复用） | **数小时–数十小时**（I/O 主导） |
| MLP 每 epoch batch 数 | ~15,600（batch=128）vs mini ~92 → **~170×** |
| 80 epoch MLP only（特征已在 RAM） | 31s × 170 ≈ **1.5 h**（理想下界） |
| **端到端冷启动（当前代码路径）** | **不可完成** 或 OOM |

**Action：** 先 **feature shard 预计算**（一次性），再训练；P7 须定义 SLA。

### 19. GPU 占用

| 项 | 结论 |
|----|------|
| `train_tone_cnn` | **纯 NumPy CPU** — **0 GPU** |
| `mel.py` | scipy STFT on CPU |
| 项目 GPU | ASR（faster-whisper / CTranslate2）与 Tone 训练 **无关** |
| **Action** | **KEEP** CPU 训练（符合 P0 冻结）；**不**为 P7 引入 GPU 依赖除非单独立项 |

### 20. `tone_cnn_p3` 是否需要新 Training Engine？

| 维度 | 裁决 |
|------|------|
| **第二训练链路** | **禁止** — Constitution + Contract Freeze |
| **新入口脚本** | **禁止** `train_tone_p3.py` 旁路 |
| **同一引擎内扩展** | **必须** — 在 `train_tone_cnn.py` + `tone_module/dataset/` 内： |
| | · `--dataset-adapter openslr_aishell3` 或等价 |
| | · feature shard build 子命令 |
| | · streaming / memmap epoch |
| | · speaker holdout · optional class weight |
| **Artifact / validate** | **KEEP** — 仍 `tone_cnn_p3.npz` + 同 schema |
| **Runtime** | **KEEP** — `TONE_MODEL_PATH` 替换 + Runtime Validation |

**结论：** 需要 **Training Orchestration 增强**，**不是**新模型 Runtime Engine。

---

## Capability Matrix

| 能力 | 现状 | 全量 AISHELL | p3 训练 | Action |
|------|------|--------------|---------|--------|
| 下载 / materialize | ✅ | ✅ | — | **KEEP** |
| Dataset Probe | ✅ | ⚠️ 待全量跑 | — | **KEEP** + 验收 |
| Adapter / Provider | ✅ | ✅ | ✅ | **KEEP** |
| `aishell3_pipeline()` | ✅ | ✅ | ⚠️ 未接入 train | **MODIFY** 接线 |
| `train_tone_cnn` 默认 | data_mini | ❌ | ❌ 全量 | **MODIFY** |
| Feature cache / shard | ❌ | ❌ | ❌ | **MODIFY** |
| Streaming epoch | ❌ | ❌ | ❌ | **MODIFY** |
| Speaker holdout | ❌ | ❌ | ❌ | **MODIFY** |
| Class balance | ❌ | 可选 | 推荐 | **MODIFY** |
| `validate_artifact` | ✅ | ✅ | ✅ | **KEEP** |
| Runtime Validation | ✅ | — | p3 后 | **KEEP** |

---

## Required Development Matrix（Phase 7 建议）

| ID | 开发项 | 目的 | 触达 | 改 Runtime？ | 优先级 | Action |
|----|--------|------|------|--------------|--------|--------|
| RD-P7-01 | 全量 materialize + Join Audit 验收 | 确认数据就绪 | 运维 + probe | 否 | **P0** | **EXEC** |
| RD-P7-02 | 全量 Dataset Statistics Probe | syllable/类分布基线 | probe | 否 | **P0** | **EXEC** |
| RD-P7-03 | Feature shard 构建 | 避免 `audio_cache` OOM | 新模块或 train 子命令 | 否 | **P0** | **MODIFY** |
| RD-P7-04 | Streaming / memmap epoch | 2M 样本可训练 | `train_tone_cnn` | 否 | **P0** | **MODIFY** |
| RD-P7-05 | `train_and_save` 接 `aishell3_pipeline` | p3 数据源 | CLI / 编排 | 否 | **P0** | **MODIFY** |
| RD-P7-06 | Speaker-stratified holdout | 泛化评估 | `split_*` | 否 | **P1** | **MODIFY** |
| RD-P7-07 | Optional class weights | t5/t3 改善 | `_train_mlp` | 否 | **P1** | **MODIFY** |
| RD-P7-08 | `load_val_holdout_features` AISHELL 同源 | offline eval 一致 | train CLI | 否 | **P1** | **MODIFY** |
| RD-P7-09 | 大子集 pilot 训练（非全量） | 工程验证 | 10k–100k syll | 否 | **P1** | **EXEC** |
| RD-P7-10 | p3 全量训练 + validate + Runtime Validation | 交付 | 冻结主链 | 否 | **P2** | 依赖 P0 |

**明确 KEEP（不得改）：** `contract.py` · `mel.py` 特征定义 · `loader.py` · `validate_artifact` 门禁 · `inference.py` · Node E2E 语义。

---

## KEEP / MODIFY / RESTORE / DELETE

| 处置 | 项 |
|------|-----|
| **KEEP** | 单 `train_tone_cnn` 入口 · P0 MLP 结构 · Artifact schema · validate/offline 链 |
| **KEEP** | `OpenSlrAishell3DatasetAdapter` · `TextGridPinyinAlignmentProvider` · `CacheLayout` · `probe_aishell3` |
| **KEEP** | `default_data_mini_pipeline` 回归基线 |
| **KEEP** | CPU NumPy 训练 · 无 GPU 依赖 |
| **MODIFY** | `_build_feature_matrix` / 特征路径 — shard + 无全文件 audio_cache |
| **MODIFY** | `_train_mlp` 输入 — streaming 或 memmap |
| **MODIFY** | `split_val_holdout_samples` — speaker-stratified |
| **MODIFY** | `train_and_save` / CLI — aishell3 adapter 选择 |
| **MODIFY** | 可选 class weight / 训练 metadata |
| **RESTORE** | — |
| **DELETE** | — （**禁止**第二训练脚本） |

---

## Phase 7 推荐执行顺序

```text
1. 全量 materialize（本地 tgz + TextGrid）
2. probe join-audit（全量）+ stats → 基线分布
3. RD-P7-03 Feature shard 预计算（一次性）
4. RD-P7-04/05 训练编排接入 + 大子集 pilot（如 50k–200k syllables）
5. Speaker holdout + class weight 调参
6. 全量 tone_cnn_p3 训练 → validate_artifact → offline_tone_eval
7. TONE_MODEL_PATH + Runtime Validation（Level 3）— 非 Phase 7 训练轮若仅审计
```

---

## Architecture Drift Audit

| 区域 | Expected | Actual | Drift | Action |
|------|----------|--------|-------|--------|
| 单训练主链 | 一条 | 一条 | 无 | **KEEP** |
| Dataset 插件化 | Adapter+Provider | 已落地 | 无 | **KEEP** |
| 全量训练工程 | P6-C 已预警 | **未实现** shard/stream | 计划内缺口 | **MODIFY** |
| 第二 Pipeline | 禁止 | 无 | 无 | **KEEP** |
| Feature Baseline | `p0-v1` | 未改 | 无 | **KEEP** |
| Terminology | Level 2 ≠ Level 3 | 文档已冻结 | 无 | **KEEP** |

**Material Drift：无**（能力缺口为 **已知技术债**，非架构偏离）

---

## Remaining Risks

| 风险 | 等级 | 缓解 |
|------|------|------|
| 全量 `collect_samples` + 训练 OOM | **CRITICAL** | RD-P7-03/04 |
| lars76 TextGrid 版本漂移 | MED | Join Audit |
| 44.1 线性重采样质量 | LOW | 监控 offline vs mini；不改 contract 前提下可选更好离线 resampler |
| 训练耗时过长 | MED | shard 复用 · 减 epoch pilot |
| utterance holdout speaker 泄漏 | MED | RD-P7-06 |
| t5 仍稀缺（占比） | MED | class weight + 更多绝对样本 |
| 误将 Dataset Probe 当 p3 完成 | MED | Terminology Level 2/3 分离 |

---

## Final Verdict

# **CONDITIONAL PASS**

| 维度 | 裁决 |
|------|------|
| **AISHELL-3 全量接入** | **可以开始**（Level 2：materialize · Join Audit · Statistics） |
| **`tone_cnn_p3` 全量训练** | **尚不可开始** — 须先完成 Feature Shard / Streaming / train 接线 |
| **平台整体** | 数据层 **READY**；训练编排层 **NOT READY** |

Phase 7 开发应拆为：**7-A 数据全量验收（Probe）** + **7-B 训练工程化（MODIFY 单引擎）** + **7-C p3 训练与 Runtime Validation**。不得跳过 7-B 直接全量开训。

---

*Audit only — no `tone_cnn_p3` training · no Runtime changes · no second training pipeline.*
