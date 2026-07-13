# Tone V2 P10 — Runtime Direct Replacement Development Report

**Date:** 2026-07-11  
**Phase:** P10 Runtime Direct Replacement（正式开发）  
**Scope:** `p0 mel80 Runtime` → `P1 Full Runtime`（Direct Replacement，无双链/无 fallback）  
**采集输出:** `tmp/tone_p10_node_e2e/`（Post-replacement E2E，`e2e_report.json`）  
**前置报告:** `Tone_V2_P10_Node_Entry_Full_E2E_Runtime_Audio_Test_Report_2026_07_11.md`（替换前 p0 基线）

---

## 1. Executive Summary

本轮完成 **正式 Runtime 从 p0 到 P1 Full 的直接替换**。生产主链不再引用 `numpy_p0`、`extract_mel_features` 或 `tone_cnn_p0.npz`；唯一 Feature 入口为 `feature_v2.extract_feature()`；唯一 Loader 为 `get_tone_loader_v1()` / `ToneModelLoaderV1`；默认 artifact 为 `tone_cnn_p1_v1_full.npz`。

| 维度 | 结论 |
|------|------|
| P1 Full Runtime 切换 | **完成** |
| Node 代码修改 | **无**（schema / Recall / Ranking 未动） |
| Node E2E（22 fixtures） | **22/22 PASS** |
| FW-direct E2E | **22/22 PASS** |
| Diagnostics | **22/22** 报告 `numpy_p1` + `p1-frame-mel-f0-v1` |
| Registry / Switch / Fallback | **未新增** |
| 双链保留 | **否** |

### Final Verdict: **DEVELOPMENT COMPLETE → 进入 P10 Runtime Direct Replacement Acceptance**

---

## 2. 规格十问（必须回答）

| # | 问题 | 答案 |
|---|------|------|
| 1 | 正式 Runtime 是否已完全切换为 P1 Full Runtime？ | **Yes** |
| 2 | Runtime 是否仍存在 `numpy_p0` 生产引用？ | **No** — `inference.py` / `classifier.py` / `loader_v1.py` / `api_routes.py` / `config.py` 均无 p0 import |
| 3 | Runtime 是否仍存在 `extract_mel_features` 生产引用？ | **No** — 已从 `inference.py` 移除；`mel.py` 仅 Training Legacy |
| 4 | 正式 Runtime 是否仍加载 `tone_cnn_p0.npz`？ | **No** — `config.TONE_MODEL_PATH` 默认指向 `tone_cnn_p1_v1_full.npz` |
| 5 | 正式 Runtime 是否真实加载 `tone_cnn_p1_v1_full.npz`？ | **Yes** — 22/22 E2E diagnostics `artifactPath=.../tone_cnn_p1_v1_full.npz`，`loadMs` 5–8 ms |
| 6 | Feature 是否全部来自 `feature_v2.extract_feature()`？ | **Yes** — `inference.py` 唯一 feature 调用 |
| 7 | Node 是否无需修改即可运行？ | **Yes** — 22/22 Node pipeline HTTP 200，`AcousticToneSlice` 正常下发 |
| 8 | 是否新增 Registry / Switch / Fallback？ | **No** |
| 9 | Runtime 是否仍保留双链？ | **No** |
| 10 | 正式 Runtime 调用图？ | 见 §3 |

---

## 3. Runtime 调用图

### 3.1 生产主链（替换后）

```text
processed_audio
    ↓
feature_v2.extract_feature(processed_audio, sample_rate, word_info)
    ↓
ToneClassifier.predict_batch((N, 64, 83))
    ↓
ToneModelLoaderV1  [get_tone_loader_v1() singleton]
    ↓
numpy_p1.infer_batch
    ↓
tone_cnn_p1_v1_full.npz
    ↓
TonePosterior (t1..t5)
    ↓
AcousticToneSlice
    ↓
UtteranceAcousticTonePayload → api_routes → Node
```

### 3.2 Feature 调用图

```text
run_tone_inference()
    → _iter_words(segments)           # FW WordInfo timestamps
    → extract_feature(audio, sr, w) # per-word; no external slice/mel
    → np.stack → (N, 64, 83)
```

### 3.3 Loader 调用图

```text
get_tone_classifier()
    → get_tone_loader_v1()          # process singleton, fail-closed
    → ToneModelLoaderV1.load(None)
        → config.TONE_MODEL_PATH || models/tone_cnn_p1_v1_full.npz
        → metadata validation (backend, featureVersion, weight keys)
        → ToneModelWeightsV1
```

### 3.4 已删除的生产路径（不得再出现）

```text
processed_audio → mel80 → numpy_p0 → tone_cnn_p0   [REMOVED from production]
```

---

## 4. 修改文件

### 4.1 生产 Runtime（Direct Replacement 核心）

| 文件 | 变更 |
|------|------|
| `tone_module/inference.py` | 删除 `_slice_audio` / `extract_mel_features`；改用 `feature_v2.extract_feature`；stack `(N,64,83)` |
| `tone_module/classifier.py` | 重写为 `numpy_p1` + `ToneModelLoaderV1` + `get_tone_loader_v1()`；`predict_batch` 接受 3D feature |
| `tone_module/loader_v1.py` | **新增** `_resolve_model_path`、`get_tone_loader_v1()` 单例、`reset_tone_loader_v1_singleton()`；metadata / fail-closed |
| `tone_module/contract.py` | **新增** P1 常量、`P1_RUNTIME_VERSION`、`P1_LOADER_VERSION`、diagnostics 字段 |
| `config.py` | `_DEFAULT_TONE_MODEL` → `tone_cnn_p1_v1_full.npz` |
| `tone_module/__init__.py` | 文档更新为 P1 Full Runtime |
| `api_routes.py` | 接线不变；diagnostics 经 `metadata_as_diagnostics()` 透出 P1 字段 |

### 4.2 Artifact

| 文件 | 说明 |
|------|------|
| `tone_module/models/tone_cnn_p1_v1_full.npz` | P10 结构验收 artifact（`training_version=p10_structural_smoke`，**非生产训练权重**） |

### 4.3 测试 / 验收脚本

| 文件 | 变更 |
|------|------|
| `tone_module/test_phase8_runtime_mainline.py` | 断言 inference 用 `extract_feature`；classifier 用 `numpy_p1` / `get_tone_loader_v1` |
| `tone_module/test_phase2_contracts.py` | loader/backend 测试指向 v1/p1 |
| `tone_module/test_classifier_fail_closed.py` | 改用 P1 artifact（`save_artifact_v1`） |
| `tone_module/audit_runtime_acceptance.py` | 默认 artifact 路径改为 P1 |

### 4.4 未修改（按规格）

- **Node 全量代码** — `AcousticToneSlice` schema、Recall、TonePattern、Ranking、KenLM 均未改动
- **Training Legacy** — `mel.py`、`loader.py`、`backends/numpy_p0.py`、`train_tone_cnn.py`、`validate_artifact.py` 等保留

---

## 5. 删除项（Production Runtime Only）

| 删除项 | 状态 |
|--------|------|
| `inference.py` 中 `extract_mel_features` 调用 | ✅ 已删除 |
| Runtime 对 `tone_module.mel` 的生产 import | ✅ 已删除 |
| `classifier.py` 中 `numpy_p0` | ✅ 已删除 |
| `classifier.py` 中 `ToneModelLoader` / `get_tone_loader()` | ✅ 已删除 |
| `if p0` / `if p1` 双链分支 | ✅ 不存在 |
| p0 artifact 默认路径（`config.py`） | ✅ 已替换 |
| p0 Runtime diagnostics（`mel80` / `mel_mean_80_v1`） | ✅ 不再报告 |
| Runtime 外置 feature / 外置 word clip slice | ✅ 已删除 |

**保留（Training Legacy，未误删）：** `mel.py`、`loader.py`、`numpy_p0.py`、`train_tone_cnn.py`、历史 p0 测试、`offline_tone_eval.py`、`validate_artifact.py`

---

## 6. 回归测试

### 6.1 单元测试（P10 相关子集）

```text
python -m unittest \
  tone_module.test_phase8_runtime_mainline \
  tone_module.test_phase2_contracts \
  tone_module.test_classifier_fail_closed \
  tone_module.test_phase9c3_no_p0_fallback \
  tone_module.test_phase9c3_no_runtime_training_import \
  tone_module.test_phase8_shard_contract

Result: 25 tests OK (6.4s)
```

### 6.2 Artifact 验证

```text
python -m tone_module.validate_artifact_v1 \
  --artifact tone_module/models/tone_cnn_p1_v1_full.npz

Result: validation=PASS | schema=True | shape=True | loader=True | adapter=True
```

### 6.3 Runtime Health

| 检查项 | 结果 |
|--------|------|
| `GET :6008/health` | `status=ok`, `utterance_ready=true` |
| FW ASR worker | `worker_state=running` |
| Tone classifier ready | 22/22 utterance 返回 `toneEnabled=true` |

### 6.4 Feature Shape

- 输入：`(N, 64, 83)` — `P1_FEATURE_SHAPE` / `contract.P1_N_CHANNELS`
- 输出：`(N, 5)` posterior — `TonePosterior` t1..t5

### 6.5 Node E2E（dialog_200，22 fixtures）

| 指标 | 值 |
|------|-----|
| `nodeSuccessCount` | **22/22** |
| `fwSuccessCount` | **22/22** |
| `vadMultiSegmentFixtures` | 0/22 |
| `totalWords` | 501 |
| `nodeLatencyAvg` | ~16.4 s（含 ASR + FW + NMT） |
| `fwLatencyAvg` | ~6.4 s |
| `tone_inference_ms` avg | **~66 ms** |
| `p1ArgmaxChangeRate`（offline raw vs processed 对比） | 5.0% |
| `toneSensitiveRecallVariants` | 5 |

### 6.6 Runtime Diagnostics（22/22 一致）

```json
{
  "backend": "numpy_p1",
  "featureVersion": "p1-frame-mel-f0-v1",
  "formatVersion": "npz-p1-v1",
  "modelVersion": "tone_cnn_p1_v1_full",
  "artifactPath": ".../tone_cnn_p1_v1_full.npz",
  "runtimeVersion": "p10-p1-direct-replacement-v1",
  "loaderVersion": "ToneModelLoaderV1"
}
```

**不再出现：** `mel80 Runtime`、`mel_mean_80_v1`、`numpy_p0`、`tone_cnn_p0`

### 6.7 Node 消费 `AcousticToneSlice`（样例 d001）

- `utterance_tone.toneEnabled=true`
- `acousticToneSlices` 含 `start/end/tonePosterior/confidence`
- Node 未改 schema 即可解析

---

## 7. Remaining Risks

| 风险 | 级别 | 说明 |
|------|------|------|
| Artifact 为结构 smoke 权重 | **高** | `training_version=p10_structural_smoke`；切换已完成，**质量验收需 Acceptance + 重训** |
| 多段 VAD 样本未覆盖 | 中 | 22/22 TTS 均为单段；多段 `processed_audio` 行为待 Acceptance 补测 |
| FW 端口 6008 环境依赖 | 低 | 本机 6007 被 Chrome 占用；`service.json` 已固定 6008 |
| 全量 `unittest discover` GPU/cuDNN | 低 | 部分 GPU 训练测试可能崩溃；P10 runtime 子集已通过 |
| `runtimeToneSliceCount` < `fwToneSliceCount` | 信息 | Node 路径经 FW detector 后词级 timestamp 子集与 FW-direct 全词不同；属既有行为，非 P10 引入 |

---

## 8. Acceptance Checklist

| 项 | 状态 |
|----|------|
| [x] `processed_audio` → `feature_v2` → `numpy_p1` → `TonePosterior` 真实执行 | ✅ |
| [x] `numpy_p0` 不再进入 Runtime 生产引用 | ✅ |
| [x] `tone_cnn_p1_v1_full.npz` 正式 Runtime 加载（非仅离线 probe） | ✅ |
| [x] `extract_mel_features` 不再进入 Runtime 生产引用 | ✅ |
| [x] Diagnostics 输出 backend / featureVersion / artifact / modelVersion / loaderVersion / runtimeVersion | ✅ |
| [x] 无 Registry / Switch / Fallback / 双链 | ✅ |
| [x] Node 无需修改即可收到 `AcousticToneSlice` | ✅ |
| [x] Node E2E 22 fixtures 回归 | ✅ |
| [x] dialog_200 子集（22）覆盖 cafe / meeting / lexicon 等场景 | ✅ |
| [x] Training Legacy 未误删 | ✅ |
| [ ] **P10 Runtime Direct Replacement Acceptance**（下一轮） | 待执行 |
| [ ] 生产训练权重替换 smoke artifact | 待 Acceptance 后重训流程 |

---

## 9. 下一步

**停止 Tone 逻辑修改。** 不得在本轮后继续调整 Recall、重训或 Ranking。

进入：**P10 Runtime Direct Replacement Acceptance**

---

## 10. 附录：生产路径 Grep 验收

对生产 Runtime 文件（`inference.py`、`classifier.py`、`loader_v1.py`、`api_routes.py`、`config.py`）检索：

- `numpy_p0` → **0 matches**
- `extract_mel_features` → **0 matches**
- `get_tone_loader(` → **0 matches**
- `tone_cnn_p0` → **0 matches**

`mel.py`、`loader.py`、`train_tone_cnn.py` 等 Training Legacy 仍含上述符号 — **预期保留**。
