# Tone V2 P9-C — GPU Feature Extraction + GPU Training PreDev Audit Report

**Date:** 2026-07-05  
**Phase:** P9-C GPU Feature Extraction + GPU Training PreDev Audit  
**Type:** 只读审计（**非开发** · **非训练** · **零代码修改**）

**冻结主链（不可漂移）：**

```text
TextGrid → SyllableSample → WordInfo Adapter → WordInfo
→ extract_feature contract (p1-frame-mel-f0-v1)
→ Feature Tensor (64, 83) → CNN → TonePosterior (5) → V2 artifact
```

**依据：**

- [Tone V2 P8-C Feature V2 Foundation Development Specification.md](./Tone%20V2%20P8-C%20Feature%20V2%20Foundation%20Development%20Specification.md)
- [Tone V2 P8-C — Feature Contract Specification.md](./Tone%20V2%20P8-C%20%E2%80%94%20Feature%20Contract%20Specification.md)
- [Tone_V2_P8_D_V2_Training_Path_Acceptance_Report.md](./Tone_V2_P8_D_V2_Training_Path_Acceptance_Report.md)
- [Tone_V2_P9_A_FW_WordInfo_V2_CNN_Training_Foundation_Development_Report.md](./Tone_V2_P9_A_FW_WordInfo_V2_CNN_Training_Foundation_Development_Report.md)
- [Tone_V2_P9_B_FW_WordInfo_V2_CNN_1k_Pilot_Training_Report.md](./Tone_V2_P9_B_FW_WordInfo_V2_CNN_1k_Pilot_Training_Report.md)
- 当前仓库代码 + 本机环境探测（只读）

---

## Executive Summary

| 维度 | 结论 |
|------|------|
| 全量训练主要瓶颈 | **CPU online `extract_feature`（含 I/O + F0 逐帧 loop）**，占 P9-B wall time **~93–95%** |
| NumPy CNN 训练 | 占 **~5–7%**（1k pilot），非主瓶颈 |
| GPU 硬件 | ✅ RTX 4060 Laptop · 8 GB · CUDA 12.4 |
| PyTorch | ❌ **venv / system 均未安装** — GPU 训练/特征 **当前不可开发** |
| GPU Feature Extraction | ⚠️ 可行但 **F0 parity 风险高**；须 CPU reference + parity gate |
| GPU Training | ✅ 可行（安装 torch 后）；推荐 **torch 训练 → numpy 导出 → numpy_p1 验收** |
| 推荐全量策略 | **B：CPU feature cache（一次性 Shard V2 / memmap）+ GPU torch training** |
| Feature Contract 升级 | **不需要**（若 parity 通过）；仅增 **trainingBackend** 元数据 |
| P9-C 开发准入 | **CONDITIONAL PASS** — 须先修复 torch 环境 |

### Final Verdict: **CONDITIONAL PASS**

GPU 化在硬件与架构上可行，但 **PyTorch 缺失** 为硬阻塞；全量 AISHELL-3 若坚持纯 online CPU 特征路径预计 **~15 天** 级特征提取，必须先解决特征侧耗时（缓存或 GPU batch + parity），GPU 仅加速 CNN 不足以缩短全链路。

---

## Current Runtime Cost Breakdown

### P9-B 实测锚点

| 指标 | 值 | 来源 |
|------|-----|------|
| 总 wall time | **~23.3 min**（1,397 s） | P9-B · 1000 syllables · 20 epochs |
| 样本 | train=966 · val=34 | speaker holdout |
| 特征路径 | online WordInfo → `extract_feature` | 无 Shard |

### 微基准（本审计只读探测）

| 探测项 | 结果 |
|--------|------|
| 纯 `extract_feature`（内存 sine · 无 wav I/O） | **~3.9 ms / sample**（50 次均值） |
| GPU | RTX 4060 Laptop · **8188 MiB** |

### 估算分解（1k pilot）

| 阶段 | 估算耗时 | 占比 | 说明 |
|------|----------|------|------|
| **CPU extract_feature × 1000**（含 wav 读入、Adapter、逐样本 loop） | **~1,300 s（~22 min）** | **~93%** | 与总时长 1,397 s 对齐（1000×1.3s） |
| **NumPy CNN 20 epochs**（966 samples · batch 64） | **~60–100 s** | **~5–7%** | `cnn_p1.train_sgd_step` 含 Python conv loop |
| 其它（holdout、norm、artifact save） | **<30 s** | **<2%** | |

**每 syllable 有效 wall（含 I/O）：** **~1.30–1.40 s**（P9-B 实测）  
**每 syllable 纯 DSP（无 I/O）：** **~4 ms**（合成音频探测）

### 瓶颈归因（`feature_v2.py` 代码层）

| 组件 | 严重度 | 证据 |
|------|--------|------|
| **逐样本 Python loop**（`build_v2_training_batch`） | 高 | 每 syllable 独立调用 |
| **F0 `frame_lag_autocorrelation_v1`** | 高 | `_compute_f0_tracks` 逐帧 `np.correlate` + Python for |
| **`_frame_waveforms` Python loop** | 中 | 每帧 copy/pad |
| **scipy STFT + mel** | 中 | 相对 F0 loop 较轻 |
| **wav I/O**（`soundfile` + audio_cache） | 中–高 | 首读 utterance 成本 |
| **NumPy CNN conv Python loop** | 低（1k 规模） | `conv1d_forward` 时间维 for |

### AISHELL-3 full online 预计（外推）

| 假设 | 估算 |
|------|------|
| 全量 syllables | **~950k–998k**（`probe_aishell3.py` MIN_SYLLABLE_COUNT） |
| 按 P9-B **1.32 s/syllable** | **~347–366 小时（~14.5–15.2 天）** 仅特征提取 |
| 20 epochs NumPy CNN（线性外推） | **~1.5–2 小时**（相对可忽略） |
| **纯 online CPU 全量总耗时** | **~15 天量级**（单进程） |

**结论：全量瓶颈几乎 entirely 来自 CPU online feature extraction，而非 NumPy CNN training。**

---

## GPU Feasibility Audit

### 本机环境（2026-07-05 只读探测）

| 项 | venv (`.venv`) | system Python |
|----|----------------|---------------|
| **torch** | ❌ `No module named 'torch'` | ❌ 同上 |
| **CUDA_PATH** | `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4` | 同左 |
| **GPU** | RTX 4060 Laptop · **8188 MiB** · driver 591.74 | 同左 |
| **onnxruntime-gpu** | ✅ CUDAExecutionProvider | ❌ 仅 CPU/Azure |
| **ctranslate2 CUDA** | ✅ float16/int8 等 | ✅ |

### 依赖与兼容性

| 项 | 状态 |
|----|------|
| `requirements.txt` 含 torch | ❌ **未声明** |
| torchaudio | ❌ 未安装、非必需 |
| `torch.stft` 自实现 mel | ✅ 可行（推荐，减少依赖） |
| Windows + CUDA 12.4 | ✅ 与现有 ASR GPU 栈一致 |
| 与 FW venv 隔离 | Tone 训练可独立 venv 或扩展 `.venv` |

### 环境修复项（P9-C 开发前置）

1. 在 `faster_whisper_vad/.venv` 安装 **PyTorch CUDA 12.x** wheel（与 CUDA 12.4 匹配）
2. 新增 **GPU environment probe**（`torch.cuda.is_available()` · device name · VRAM）
3. **不得**将 torch 加入 Runtime / `inference.py` 依赖

**若 torch 未安装：不得强行开发 GPU path — 当前状态即如此。**

---

## GPU Feature Extraction Design Audit

### 冻结 Contract 接口（必须 KEEP）

```python
extract_feature(audio: np.ndarray, sample_rate: int, word_info: WordInfo) -> np.ndarray  # (64, 83)
```

### 建议训练期 batch 实现（MODIFY · 新增）

```python
# 建议路径: tone_module/feature_v2_torch.py  (training-only)
def extract_feature_batch_torch(
    clips: Sequence[np.ndarray],          # 已 slice+resample 的 float32 mono clips
    word_infos: Sequence[WordInfo],         # 边界已在 clip 层 consumed；用于 audit trace
) -> np.ndarray:                           # (N, 64, 83) float32
    ...
```

**或** utterance 级：

```python
def extract_feature_batch_from_wav_torch(
    wav_batch_paths: ...,
    word_info_batch: Sequence[WordInfo],
    sample_rates: ...,
) -> np.ndarray:
```

### 设计问答

| 问题 | 审计结论 |
|------|----------|
| A. 保留 CPU `extract_feature` 为 Contract Reference？ | **是 · 必须** |
| B. 新增 GPU batch extractor？ | **可选 · training-only** |
| C. GPU 须 parity test 对齐 CPU？ | **是 · 强制 gate** |
| D. 训练可用 GPU extractor？ | **可以 · 仅当 parity PASS** |
| E. Runtime 禁止 GPU extractor？ | **是 · 本轮及 Runtime 阶段前均禁止** |
| F. 需要 `featureExtractorBackend` 字段？ | **建议 metadata only**（如 `cpu_numpy_v1` / `gpu_torch_v1`），**不写入 featureVersion** |
| G. 会否第二 Feature Contract？ | **否 · 若 shape/version/channel 不变** |

### 推荐设计

| 层级 | 文件 | 职责 |
|------|------|------|
| Contract SSOT | `feature_v2.py` | CPU reference · **不改语义** |
| Training backend | `feature_v2_torch.py`（新） | batch STFT/mel/interp；F0 见下 |
| Parity gate | `test_phase9c_feature_parity.py`（新） | CPU vs GPU tensor diff |
| Training orchestrator | `train_tone_v2_model.py` | 可选 `--feature-backend torch` **仅训练** |

**F0 策略（关键）：**

| 选项 | 风险 | 建议 |
|------|------|------|
| 1. 全 GPU 含 F0 autocorr | **高** — 难 bit-align CPU | 不推荐首版 |
| 2. **GPU mel + CPU F0** | **中** — mel parity 易测，F0 仍 reference | **P9-C 首版推荐** |
| 3. 升级 featureVersion | 架构变更 | **禁止**（本轮） |
| 4. 暂不 GPU 化 F0 | 低 | **与选项 2 等价** |

---

## CPU/GPU Feature Parity Audit

### Parity Gate 设计（开发后必须）

**输入：** 同一批 `Audio + WordInfo`（≥256 syllables · 含 AISHELL 子集）

**对比：**

```text
cpu = extract_feature(audio, sr, word_info)           # (64, 83)
gpu = extract_feature_batch_torch(...)[i]              # (64, 83)
```

| 断言 | 阈值建议 |
|------|----------|
| shape | 严格 `(64, 83)` |
| featureVersion | `p1-frame-mel-f0-v1` |
| channel order | 80 mel + log_f0 + delta + voiced |
| **global max abs diff** | ≤ **1e-3**（mel 主导）；F0 通道可单独 ≤ **1e-2** 若 CPU F0 |
| mean abs diff | 报告 per-channel |
| posterior sensitivity | CPU/GPU 特征分别过 **同一** `numpy_p1` CNN · argmax 一致率 ≥ **99%** |

### 可接受差异

| 来源 | 可接受性 |
|------|----------|
| STFT 边界 / window | 小 diff · 须在 mel 通道阈值内 |
| Mel filterbank float | 可接受 ≤1e-4~1e-3 |
| **F0 autocorrelation 算法差异** | **不可 silent 接受** — 须 CPU reference 或升级 version |
| interp / crop policy | **不可差异** — 须同 `_normalize_frame_count` 逻辑 |
| float32 vs float64 | 训练统一 float32 |

---

## GPU Training Loop Audit

### 当前状态

| 项 | 现状 |
|----|------|
| 框架 | **纯 NumPy** · 无 torch |
| 输入 | `(N, 64, 83)` → permute `(N, 83, 64)` |
| 输出 | `(N, 5)` logits → softmax |
| Loss | manual CE in `train_sgd_step` |
| 架构 | `conv1d_global_pool_v1` |

### 推荐 GPU 训练架构

| 项 | 建议 |
|----|------|
| 训练 | `torch.nn.Conv1d` ×2 + GAP + Linear · **CUDA** |
| 输入 | `(N, 83, 64)` float32 tensor |
| Loss | `CrossEntropyLoss` |
| Artifact 导出 | **torch state_dict → numpy** → 现有 `save_artifact_v1` keys |
| Inference 验收 | **`numpy_p1` 不变** |
| Runtime | **禁止 torch 依赖** |
| 新模块 | `models/cnn_p1_torch.py` · `train_tone_v2_model.py --training-backend torch` |

**modelArchitecture** 仍为 `conv1d_global_pool_v1`；可增 artifact 字段 **`trainingBackend=torch_cuda_v1`**（非 featureVersion）。

---

## Artifact Compatibility Audit

| 字段 | GPU 训练后 |
|------|------------|
| formatVersion | **`npz-p1-v1` 不变** |
| featureVersion | **`p1-frame-mel-f0-v1` 不变** |
| inputShape | `[64, 83]` |
| outputShape | `[5]` |
| backend（推理） | **`numpy_p1` 不变** |
| weights | Conv1d numpy 数组 · 与现有 loader 一致 |
| validate_artifact_v1 | **无需改 schema** · 仅验证导出精度 |
| 新增可选字段 | `trainingBackend` · `featureExtractorBackend`（metrics/notes） |

**禁止：** 改变 Runtime artifact schema · 让 p0 loader 接受 V2 · torch 进入 inference。

---

## Training Input Strategy Audit

### 三方案对比

| 维度 | A: GPU online extract + GPU train | B: CPU cache + GPU train | C: GPU cache + GPU train |
|------|-------------------------------------|--------------------------|--------------------------|
| **速度（全量）** | 中–高（若 F0 解决） | **高（训练阶段）** · 构建 cache 一次性 | 最高 |
| **显存** | 高 | **低–中** | 高 |
| **代码复杂度** | **高** | **低–中** | 高 |
| **Contract drift** | **高**（F0） | **低**（cache=同一 CPU extract） | 中 |
| **Parity 难度** | **高** | **低**（已有 P8-D online≡cache） | 中 |
| **双链路风险** | 中 | **低** | 中 |
| **适合 AISHELL full** | 条件性 | **推荐** | 过度 |

### 推荐

**主推荐：B — CPU feature cache（Feature Shard V2 一次性物化）+ GPU torch training**

理由：

1. P8-D 已证明 Shard V2 tensor ≡ online `extract_feature`（`1e-5`）
2. 全量 **~15 天 online CPU** 不可接受；cache build 可离线/并行一次完成
3. GPU 训练可将 20 epochs 从 **~1–2 h → 分钟级**（相对整体仍小于 cache build）
4. **不引入第二 Feature Contract**
5. 训练主链语义仍为 WordInfo → extract_feature；cache 仅为 **materialized artifact**（冻结定位）

**次选（P9-C+）：** A 的 hybrid — **GPU mel batch + CPU F0** + parity gate → 缩短 cache build

**不推荐首版：** C（双 GPU 阶段复杂度高）

**渐进路径（用户可接受）：**

1. **P9-C：** torch 环境 + GPU CNN trainer + numpy 导出 + 10k GPU-train pilot（特征仍 CPU online 或 shard）
2. **P9-D（可选）：** GPU mel batch + parity
3. **Full：** Shard V2 build（CPU reference）+ GPU train 20 epochs

---

## Anti-Drift Audit

| 漂移风险 | 评估 | 防止措施 |
|----------|------|----------|
| CPU vs GPU Feature Contract 分裂 | 高（若 F0 不同） | CPU reference + parity gate |
| torch-only Feature Contract | 中 | training-only 模块隔离 |
| cached Feature Contract | 低 | 已有 P1 shard schema |
| 第二 extractor 入主链 | 中 | 单 WordInfo 路径；GPU 仅 batch impl |
| p0 fallback | 低 | 延续 P9-A gates |
| Shard-centric drift | 中 | cache **非**验收对象；验收仍 WordInfo path |
| Runtime GPU 依赖 | 高 | torch 不进入 inference |
| featureVersion 暗改 | 高 | 禁止 silent F0 变更 |
| online/cached **双主链** | 高 | train 入口单一；cache 可选输入源 |

---

## Regression / Gate Audit（P9-C 开发后）

| # | Gate | 必需 |
|---|------|------|
| 1 | GPU environment probe | ✅ |
| 2 | CPU/GPU feature parity（若做 GPU extract） | ✅ |
| 3 | GPU train smoke（10k · 1 epoch） | ✅ |
| 4 | torch → numpy artifact export | ✅ |
| 5 | `validate_artifact_v1` + `numpy_p1` infer | ✅ |
| 6 | anti-p0-fallback | ✅ |
| 7 | no Runtime modification | ✅ |
| 8 | featureVersion / shape gate | ✅ |
| 9 | Shard≡CPU online（若用 cache） | ✅ 已有 P8-D |

---

## KEEP / MODIFY / RESTORE / DELETE / RECLASSIFY

| 动作 | 项 |
|------|-----|
| **KEEP** | WordInfo Contract · Feature Contract · CPU `extract_feature` · numpy_p1 · p0 Runtime · p0 legacy train |
| **KEEP** | Shard V2 as **optional cache**（非主链验收） |
| **MODIFY** | 安装 torch · 新增 torch CNN trainer · artifact export · GPU probe |
| **MODIFY（可选）** | `feature_v2_torch.py` batch extractor |
| **RESTORE** | 训练目标 = model training；cache = 性能工程 |
| **DELETE** | 任何 silent F0 变更 · p0 fallback |
| **RECLASSIFY** | GPU extractor = **implementation backend**，非新 Contract |

---

## Required Development Matrix

| # | Deliverable | Priority | Blocker |
|---|-------------|----------|---------|
| E1 | Install PyTorch+cu124 in venv | P0 | **是** |
| E2 | `probe_gpu_env.py` | P0 | 是 |
| E3 | `cnn_p1_torch.py` + GPU train loop | P0 | E1 |
| E4 | torch→numpy export + validate_artifact_v1 | P0 | E3 |
| E5 | 10k GPU-train pilot | P0 | E4 |
| E6 | Full: Shard V2 build + GPU train entry | P0 | E4 |
| E7 | `feature_v2_torch.py` + parity tests | P1 | E1 |
| E8 | F0 GPU port | P2 / 不推荐 | parity |

---

## Production Readiness Assessment

| 维度 | 状态 |
|------|------|
| GPU 硬件 | ✅ 就绪 |
| GPU 软件（torch） | ❌ **未就绪** |
| 全量 online CPU | ❌ **不可行**（~15 天） |
| 推荐全量路径 | CPU cache build + GPU train |
| Runtime V2 | 仍后续阶段 |

---

## 十问终答

| # | 问题 | 答案 |
|---|------|------|
| 1 | 当前全量训练主要瓶颈？ | **CPU online extract_feature（~93–95% wall）** |
| 2 | GPU 化 Feature Extraction 是否可行？ | **条件性可行** — mel 易；**F0 autocorr 难** |
| 3 | GPU 化 Training 是否可行？ | **是** — 安装 torch 后 · 导出 numpy artifact |
| 4 | 是否应该 GPU 化 F0？ | **首版不应** — 保留 CPU F0 或暂不 GPU 化 F0 |
| 5 | 是否保持 CPU extractor 为 reference？ | **是 · 必须** |
| 6 | 是否需要升级 featureVersion？ | **否**（parity 通过前提下） |
| 7 | 推荐方案？ | **B：CPU feature cache + GPU training** |
| 8 | 是否会引入双链路风险？ | **B 方案低**；A 纯 GPU online **中高** |
| 9 | P9-C 是否可以进入开发？ | **CONDITIONAL PASS** — 先装 torch |
| 10 | 开发后能否直接 AISHELL full training？ | **条件性可以** — 需 Shard 物化 + GPU train；纯 online 仍不现实 |

---

## Final Verdict

### **CONDITIONAL PASS**

GPU 化方向与冻结架构兼容，但 **(1) PyTorch 未安装**、**(2) 全量瓶颈在 CPU 特征提取而非 CNN**、**(3) F0 GPU parity 风险高**。建议 P9-C 优先交付 **torch GPU 训练 + numpy artifact 导出**，全量采用 **CPU Shard V2 一次性 cache + GPU training**；GPU batch feature 作为 P9-C+ 可选项且须 parity gate。

---

## 附录：代码锚点

| 组件 | 路径 |
|------|------|
| CPU extractor | `tone_module/feature_v2.py` |
| F0 bottleneck | `_estimate_f0_frame` · `_compute_f0_tracks` |
| 逐样本 loop | `training_io/v2_training_path.py` |
| NumPy CNN | `models/cnn_p1.py` |
| V2 trainer | `train_tone_v2_model.py` |
| Env probe | `tone_module/_audit_env_probe.py` |
| requirements | 无 torch |
