# Tone Module — 架构（Phase 2 Foundation FROZEN · Phase 7-A Dataset Foundation FROZEN · Phase 7-B Training Engineering FROZEN）

**版本：** ToneModule **P0** · **Phase 1 CLOSED** · **Phase 2 Foundation FROZEN** · **Phase 7-A Dataset Foundation FROZEN**（2026-06-29）· **Phase 7-B Training Engineering FROZEN**（2026-06-30）  
**Contract SSOT：** [../tone-v2/TONE_V2_CONTRACT_FREEZE.md](../tone-v2/TONE_V2_CONTRACT_FREEZE.md)  
**Dataset Foundation SSOT：** [../tone-v2/TONE_V2_DATASET_FOUNDATION_FREEZE.md](../tone-v2/TONE_V2_DATASET_FOUNDATION_FREEZE.md)  
**Training Engineering SSOT：** [../tone-v2/TONE_V2_TRAINING_ENGINEERING_FREEZE.md](../tone-v2/TONE_V2_TRAINING_ENGINEERING_FREEZE.md)  
**Terminology SSOT：** [../tone-v2/TONE_V2_TERMINOLOGY.md](../tone-v2/TONE_V2_TERMINOLOGY.md)  
**代码：** `electron_node/services/faster_whisper_vad/tone_module/`  
**FW 集成：** `main/src/fw-detector/tone-time-align.ts`、`tone-match-score.ts`、`lexicon/tone-recall-sort.ts`  
**运维：** [../tone-v2/Tone_V2_Phase2_Deployment_Runbook.md](../tone-v2/Tone_V2_Phase2_Deployment_Runbook.md)

---

## 1. 目标

| 做 | 不做 |
|----|------|
| 从**音频**估计声调概率 | 从汉字反查拼音声调 |
| 为 Recall 提供 **Ranking Signal** | 直接替换 ASR 文本 |
| 与 FW Word Timestamp 对齐 | 修改 IME / HintGate / KenLM pick 逻辑 |
| Single Service / Single Model | **Historical Issue（已关闭）：** Registry · Switching · Multi-Model 路线现行不存在 |

**设计原则：** Tone 来自音频；独立模块；仅排序加权；默认非 Hard Filter。决策权在 **Recall**。

---

## 2. 组件（Phase 2 Foundation）

| 组件 | 路径 | 职责 |
|------|------|------|
| Contract / Feature SSOT | `tone_module/contract.py` | **唯一** Feature baseline · metadata 契约 |
| Mel | `tone_module/mel.py` | Feature extraction；常量引用 `contract.py` |
| Inference | `tone_module/inference.py` | 切片 · 调 Mel · 调 classifier；`MIN_SLICE_SEC` ← contract |
| Backend adapter | `tone_module/backends/numpy_p0.py` | `mel_batch → ndarray[N,5]`；**无** registry |
| Classifier | `tone_module/classifier.py` | Loader + adapter 编排 |
| Loader | `tone_module/loader.py` | 生产 `get_tone_loader()` → `load(None)`；fail-closed |
| 训练（离线） | `tone_module/train_tone_cnn.py` | **不进** Runtime；编排器 · Canonical 经 `training_io/` |
| Training Engineering | `tone_module/training_io/` | **FROZEN** — 见 §11 |
| Dataset Foundation | `tone_module/dataset/` | **FROZEN** — 见 §10 |
| ASR 挂载 | `faster_whisper_vad/api_routes.py` | `run_tone_inference` pre-dedup → `diagnostics.toneModule` |
| 时间对齐 | `fw-detector/tone-time-align.ts` | timestamp-only 切片对齐 |
| 打分 SSOT | `fw-detector/tone-match-score.ts` | `computeToneScoreResult` |
| Recall 排序 | `lexicon/tone-recall-sort.ts` | penalty × candidateScore |

**禁止：** `get_backend` · backend registry · runtime model switching · 同一 Worker 多模型。

---

## 3. 数据流（冻结）

### 3.1 FW 内部

```text
POST /utterance (api_routes.process_utterance)
  → VAD + Whisper decode
  → run_tone_inference(processed_audio, word_times)
      → extract_mel_features (mel.py ← contract SSOT)
      → get_tone_classifier().predict_batch
          → numpy_p0.infer_batch(mel_batch, weights)
  → UtteranceResponse.tone + diagnostics.toneModule
```

### 3.2 Node 主链

```text
asr-step → ctx.acousticToneSlices（来自 ASRResult.tone）
  → runFwDetectorV4Path
      → recallTopKForWindows
          → resolveTimestampToneState
          → computeToneScoreResult per hit
          → candidateScore *= tonePenalty
      → Ranking → Assembly (tone-free) → KenLM → Apply
```

**非声学 Tone：** `agent/postprocess/tone-stage.ts` 为 TTS 音色克隆（YourTTS），与 `acousticToneSlices → Recall` **无关**。

---

## 4. Single Service / Single Model

```text
faster-whisper-vad (单进程)
  → TONE_MODEL_PATH | tone_cnn_p0.npz
  → backends/numpy_p0 (单 adapter)
  → featureVersion p0-v1 (+ legacy mel_mean_80_v1)
```

**新模型：** 新服务实例 + 独立 env/port/`TONE_MODEL_PATH` + 独立 adapter 文件；见 Deployment Runbook。

---

## 5. Loader Contract

| 环境 | 入口 |
|------|------|
| 生产 | `get_tone_loader()` → `load(None)` |
| 测试 | `load(path)` · `reset_*_singleton` |

失败：`ready=false` → `skippedReason=model_error`（fail-closed）。

---

## 6. ToneScoreResult 契约

```typescript
interface ToneScoreResult {
  toneCompatible: boolean;
  tonePenalty: number;
  toneReason: 'match' | 'mismatch' | 'no_pattern';
}
```

---

## 7. Diagnostics

| 挂载点 | 字段示例 |
|--------|----------|
| `diagnostics.toneModule` | `backend` · `backendAdapter` · `featureVersion` · `loadMs` · `artifactPath` · `tone_inference_ms` |
| `spanAssemblyV4.tone` | `recallToneFallbackCount` · `recallToneCompatibleCount` 等 |

**不进 Decision。**

---

## 8. Required Data Contract

见 [TONE_V2_CONTRACT_FREEZE.md](../tone-v2/TONE_V2_CONTRACT_FREEZE.md) §2。

**Runtime Boundary：** `FW Worker → tone_module → HTTP tone → asr-step → ctx.acousticToneSlices → Recall`。

---

## 9. Regression Gate

| 范围 | 测试 |
|------|------|
| Phase 2 contracts | `tone_module/test_phase2_contracts.py` |
| Dataset Foundation | `test_phase6d_dataset.py` · `test_phase6e_aishell3.py` |
| Training Engineering | `test_phase7b1_training_io.py` · `test_phase7b2_canonical_feature_shard.py` |
| Loader / fail-closed | `test_loader.py` · `test_classifier_fail_closed.py` |
| 打分 / 反事实 | `tone-match-score.test.ts` · `tone-recall-counterfactual.test.ts` |
| Contract freeze | `npm run test:fw-detector` |
| Node E2E | `tests/tone-v2-phase1-dialog200-batch.js` |

**E2E 证据：**

- Phase 1：200/200 `tone_effective_chain`  
- Phase 2 Foundation：131/131（`tone-v2-phase2-dialog200-batch-result.json`）

全量 200 属模型质量评估，非 Foundation 阻塞项。

---

## 10. Dataset Foundation（Phase 7-A · FROZEN · Training only）

**SSOT：** [../tone-v2/TONE_V2_DATASET_FOUNDATION_FREEZE.md](../tone-v2/TONE_V2_DATASET_FOUNDATION_FREEZE.md)

```text
DatasetAdapter.materialize()
    → DatasetManifest
AlignmentProvider.collect_samples()
    → SyllableSample[]
```

| 角色 | 实现 | `dataset_id` |
|------|------|--------------|
| **Current Canonical Training Dataset** | `OpenSlrAishell3DatasetAdapter` | `openslr_aishell3` |
| **Regression Fixture** | `HuggingFaceZipDatasetAdapter` | `CS5647Team3_data_mini` |

**Level 2 验收：** `python -m tone_module.dataset.probe_aishell3 accept`  
**扩展新语料：** 仅新增 Adapter + Provider；**不得**修改 `dataset_contract.py` · `cache_layout.py` · Probe 框架。

**与 Runtime 边界：** `tone_module/dataset/` **不** import `inference` · `classifier` · FW Decision。

---

## 11. Training Engineering（Phase 7-B · FROZEN · Training only）

**SSOT：** [../tone-v2/TONE_V2_TRAINING_ENGINEERING_FREEZE.md](../tone-v2/TONE_V2_TRAINING_ENGINEERING_FREEZE.md) · **Guide：** [../tone-v2/TONE_V2_TRAINING_ENGINEERING_GUIDE.md](../tone-v2/TONE_V2_TRAINING_ENGINEERING_GUIDE.md)

```text
SyllableSample[]
    → Feature Shard（build-feature-shards）
    → Shard Reader
    → Sequential Feature Reader
    → Mini-batch Reader
    → train_tone_cnn train
```

| 组件 | 路径 | 职责 |
|------|------|------|
| Feature Shard | `training_io/feature_shard.py` | 物化 mel 特征 · `shard_manifest.json` |
| Shard Reader 链 | `training_io/shard_reader.py` | 只读 IO · batch · `fit_norm_stats` |
| Speaker Holdout | `training_io/speaker_holdout.py` | Canonical 默认 speaker-level split |
| IO Validation | `training_io/probe_feature_shard.py` | `build` · `accept` |
| Canonical 槽 | `.../openslr_aishell3/v1/training_features/` | 997,992 · 21 shard（P7-B2） |

**Level 验收：** `probe_feature_shard accept`（**Training IO Validation** — **不是** Runtime Validation）  
**默认训练：** 仍 `default_data_mini_pipeline`；Canonical 须显式 `--dataset aishell3`  
**模型复用：** `tone_cnn` · `tone_crnn` · 未来模型 **全部复用** 本层

**与 Dataset Foundation 边界：** 仅消费 `SyllableSample[]`；**不得**修改 dataset 冻结体。  
**与 Runtime 边界：** `training_io/` **不** import `inference` · `loader` · FW Decision。

---

## 12. 冻结约束摘要

| 允许（模型能力阶段） | 禁止（须再冻结） |
|----------------------|------------------|
| 同 featureVersion 换权重 + 重启 | Required schema · Runtime hop |
| 离线训练 · benchmark | Registry · Switching · Guard 恢复 |
| 新代际模型（新实例 + 再冻结） | metadata 进入 Decision |

---

## 13. 相关文档

| 文档 | 路径 |
|------|------|
| Contract SSOT | [../tone-v2/TONE_V2_CONTRACT_FREEZE.md](../tone-v2/TONE_V2_CONTRACT_FREEZE.md) |
| Dataset Foundation SSOT | [../tone-v2/TONE_V2_DATASET_FOUNDATION_FREEZE.md](../tone-v2/TONE_V2_DATASET_FOUNDATION_FREEZE.md) |
| Training Engineering SSOT | [../tone-v2/TONE_V2_TRAINING_ENGINEERING_FREEZE.md](../tone-v2/TONE_V2_TRAINING_ENGINEERING_FREEZE.md) |
| 文档索引 | [../tone-v2/README.md](../tone-v2/README.md) |
| FW 主链 | [../fw-detector/ARCHITECTURE.md](../fw-detector/ARCHITECTURE.md) |

**不得引用：** `docs/tone-v2/archive/deprecated/` · `archive/audit/` 作为开发依据。
