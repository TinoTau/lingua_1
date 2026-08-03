<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Tone_V2_P9_C1_Internal_GPU_Training_Foundation_PreDev_Audit_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Tone V2 P9-C1 — Internal GPU Training Foundation PreDev Audit Report

**Date:** 2026-07-05  
**Phase:** P9-C1 Internal GPU Training Foundation PreDev Audit  
**Type:** 只读审计（**非开发** · **非训练** · **零代码修改**）

**定位：** 在 **lingua_1 项目内部** 建立可复用、但 **不过度平台化** 的 GPU Training Foundation，**先服务 Tone V2**，后续可扩展至 ASR / VAD / LID / Speaker 等。

**当前优先目标（不变）：**

```text
FW WordInfo → Feature Tensor (64,83) → GPU CNN Training
→ numpy_p1 artifact → validate_artifact_v1 PASS
```

**不得偏离为独立训练平台项目。**

**依据：**

- [Tone V2 P8-C Feature V2 Foundation Development Specification.md](./Tone%20V2%20P8-C%20Feature%20V2%20Foundation%20Development%20Specification.md)
- [Tone V2 P8-C — Feature Contract Specification.md](./Tone%20V2%20P8-C%20%E2%80%94%20Feature%20Contract%20Specification.md)
- [Tone_V2_P8_D_V2_Training_Path_Acceptance_Report.md](./Tone_V2_P8_D_V2_Training_Path_Acceptance_Report.md)
- [Tone_V2_P9_A_FW_WordInfo_V2_CNN_Training_Foundation_Development_Report.md](./Tone_V2_P9_A_FW_WordInfo_V2_CNN_Training_Foundation_Development_Report.md)
- [Tone_V2_P9_B_FW_WordInfo_V2_CNN_1k_Pilot_Training_Report.md](./Tone_V2_P9_B_FW_WordInfo_V2_CNN_1k_Pilot_Training_Report.md)
- [Tone_V2_P9_C_GPU_Feature_Extraction_Training_PreDev_Audit_Report.md](./Tone_V2_P9_C_GPU_Feature_Extraction_Training_PreDev_Audit_Report.md)
- 当前仓库代码 + 环境探测

---

## Executive Summary

| 维度 | 结论 |
|------|------|
| 是否单独开训练项目 | **否** — 应留在 `lingua_1` 内 |
| 推荐路径 | `electron_node/services/faster_whisper_vad/tone_module/training/gpu/` |
| 第一版范围 | **仅 Tone V2 GPU CNN 训练** + torch→numpy 导出 |
| GPU Feature Extraction | **P9-C1 不做** — 沿用 CPU reference / 已有 Tensor 输入 |
| PyTorch | ❌ **未安装**（硬阻塞） |
| 过度平台化风险 | 中 — 须严格最小模块边界 |
| P9-C1 开发准入 | **CONDITIONAL PASS** |

### Final Verdict: **CONDITIONAL PASS**

架构与路径清晰，可在 lingua_1 内部以 **最小 GPU 训练子模块** 落地；须先安装 torch CUDA，且 **不得** 在本阶段引入 Lightning / Hydra / 分布式 / registry。

---

## 一、Project Boundary Audit

### 1.1 是否应新建独立项目？

**否。**

| 理由 | 说明 |
|------|------|
| SSOT 一致性 | Feature Contract · WordInfo · artifact 均在 `tone_module` |
| Runtime 同仓 | FW 服务根目录即 `faster_whisper_vad/` |
| 避免双 repo 漂移 | P8–P9 已冻结主链于本仓库 |
| 用户明确要求 | 「lingua_1 内部升级，不是新建独立训练平台」 |

独立 repo 仅在有 **跨语言多团队** 且 **与 FW Runtime 解耦** 时才有意义 — **当前不满足**。

### 1.2 是否应作为 tone_module 内部训练子模块？

**是 — 推荐。**

```
electron_node/services/faster_whisper_vad/
  tone_module/
    training/              # 新增 · Training Foundation（非 Runtime）
      gpu/                 # P9-C1 范围
        env_probe.py
        dataloader.py
        trainer.py
        export.py
        metrics.py
    models/
      cnn_p1.py            # KEEP · NumPy reference + export target layout
      cnn_p1_torch.py      # 新增 · torch 训练用
    training_io/           # KEEP · WordInfo / feature / optional cache
    train_tone_v2_model.py # MODIFY · 接入 --training-backend torch
```

**不推荐** 放在 repo 根 `training/` 或 `lingua_training/` — 过早抽象。

### 1.3 是否应预留 future shared training framework？

**可预留接口形状，不可预留平台。**

| 层级 | P9-C1 | 未来（P10+） |
|------|-------|--------------|
| Tone V2 | `tone_module/training/gpu/` | 保持 |
| 跨模块共享 | **不建** | 若 ASR/VAD 需要，再提取 `electron_node/services/_training_core/` **纯 util**（env_probe · metrics · export helpers） |
| 分布式 / 调度 | **禁止** | 与 [HOME_PC_CLUSTER_ASR_TRAINING_FEASIBILITY.md](../train/HOME_PC_CLUSTER_ASR_TRAINING_FEASIBILITY.md) 文档域分离 |

### 1.4 当前是否只服务 Tone V2？

**是。** P9-C1 交付物应 **仅** 覆盖：

- 输入：`(N, 64, 83)` + labels（来自 P8-D path 或 Shard V2 cache）
- 模型：`conv1d_global_pool_v1`
- 输出：`npz-p1-v1` via `save_artifact_v1`

### 1.5 如何避免训练框架过度平台化？

| 原则 | 措施 |
|------|------|
| **No registry** | 延续 `backends/__init__.py`「no registry」；GPU 模块同样禁止 |
| **No daemon / scheduler** | 仅 CLI 同步训练 |
| **No experiment platform** | metrics 写 JSON / 可选 TensorBoard，不用 W&B |
| **Single entry** | 仍通过 `train_tone_v2_model train` |
| **Thin modules** | `trainer.py` 只做 loop；不抽象「Task / Pipeline / Stage」 |
| **Export-bound** | 训练结束必须 `validate_artifact_v1` — 不以 framework 为中心 |

---

## 二、Environment / Dependency Audit

### 2.1 当前环境（2026-07-05 探测）

| 项 | 状态 |
|----|------|
| Python venv | ✅ `faster_whisper_vad/.venv` |
| `requirements.txt` | fastapi · onnxruntime-gpu · numpy · scipy · soundfile — **无 torch** |
| torch | ❌ `No module named 'torch'`（venv + system） |
| CUDA | ✅ `CUDA_PATH` v12.4 · RTX 4060 8GB |
| onnxruntime-gpu | ✅ CUDAExecutionProvider（FW ASR 栈） |
| ctranslate2 CUDA | ✅ |

### 2.2 依赖裁决

| 依赖 | P9-C1 | 说明 |
|------|-------|------|
| **torch (CUDA 12.x)** | **必须** | 与 CUDA 12.4 对齐；可参考 `speaker_embedding/requirements.txt` 注释 |
| numpy | **已有** | artifact / parity |
| scipy · soundfile | **已有** | 特征路径不变 |
| **torchaudio** | **不需要** | 输入已是 `(64,83)` Tensor；无音频 DSP in GPU trainer |
| **TensorBoard** | **可选** | 本地 loss/acc 曲线；非阻塞 |
| **ONNX** | **暂缓** | Runtime 用 numpy_p1；导出 ONNX 非 P9-C1 |
| **Lightning** | **禁止** | 过度抽象 |
| **Hydra** | **禁止** | CLI argparse 足够 |
| **W&B** | **禁止** | 非必要外部服务 |

### 2.3 建议 `requirements` 增补（开发阶段 · 非本轮修改）

```text
# Tone V2 GPU training (optional extra)
# pip install torch --index-url https://download.pytorch.org/whl/cu124
torch>=2.2.0
# optional: tensorboard>=2.14.0
```

**安装位置：** `faster_whisper_vad` venv（与 FW 服务同仓，但 **训练 CLI 不进入 Runtime import 链**）。

---

## 三、Training Framework Architecture Audit

### 3.1 最小模块职责

| 模块 | 职责 | 输入 | 输出 |
|------|------|------|------|
| `env_probe.py` | CUDA/torch/VRAM 探测 | — | JSON report |
| `dataloader.py` | 从 `V2TrainingInputBatch` / memmap / ShardReaderV2 读 `(N,64,83)` | indices / batch | torch.Tensor `(B,64,83)` |
| `trainer.py` | CE loss · Adam/SGD · epoch loop | dataloader · model | best checkpoint state |
| `export.py` | torch Conv1d → `ToneModelWeightsV1` numpy | state_dict | 兼容 `save_artifact_v1` |
| `metrics.py` | train/val acc · loss · JSON log | epoch stats | metrics dict |

| 模型 | 路径 | 说明 |
|------|------|------|
| `cnn_p1_torch.py` | `tone_module/models/` | `Conv1d(83→32→64)` · GAP · Linear→5 |

### 3.2 禁止引入

- distributed training（DDP · FSDP）
- multi-project scheduler
- experiment platform / model registry
- service daemon / background worker
- remote orchestration

### 3.3 与现有代码关系

| 现有 | P9-C1 关系 |
|------|------------|
| `train_tone_v2_model.py` | **编排层** — 特征仍调 `extract_v2_features_via_wordinfo` 或 cache |
| `models/cnn_p1.py` | **NumPy reference** — export 对齐其 weight layout `(C_out, C_in, K)` |
| `loader_v1.save_artifact_v1` | **KEEP** — GPU 训练后仍调用 |
| `validate_artifact_v1` | **KEEP** — 训练验收门 |
| `training_io/` | **KEEP** — 特征 transport；非 GPU 模块职责 |

---

## 四、Single Training Path Audit

### 4.1 冻结主链（验收 SSOT）

```text
SyllableSample → WordInfo Adapter → WordInfo
→ extract_feature (CPU reference)
→ Feature Tensor (64, 83)
→ [GPU] CNN Training
→ TonePosterior (5)
→ V2 artifact (numpy_p1)
```

### 4.2 P9-C1 允许的变化 vs 禁止

| 允许 | 禁止 |
|------|------|
| CNN 训练在 **GPU torch** 上执行 | p0 `(80,)` mean-mel |
| 特征来自 **已有** online path 或 **Shard V2 cache** | `extract_mel_features` |
| 导出 **同一** numpy artifact | `_build_feature_matrix` |
| metadata `trainingBackend=torch_cuda_v1` | ShardReader v1 |
| | p0 artifact / numpy_p0 |
| | FeatureTimestampRecord 类 |
| | GPU 训练内调用 p0 loader |

### 4.3 特征来源策略（与 P9-C 一致）

**P9-C1 不改变特征语义：**

1. **Pilot / 回归：** online WordInfo → `build_v2_training_batch`（P8-D）
2. **Full scale：** 可选 Shard V2 物化（同一 CPU `extract_feature`）→ dataloader 读 tensor

**Shard 是 cache，不是第二主链** — dataloader 只消费 `(64,83)`，不重新定义 Contract。

---

## 五、GPU Training Scope Audit

### 5.1 三层分离

| 层 | P9-C1 | 说明 |
|----|-------|------|
| **GPU training foundation** | ✅ **本轮** | torch CNN loop + export |
| **GPU feature extraction** | ❌ **不做** | F0 parity 风险高 |
| **Feature cache** | 可选输入 | Shard V2 · 非 C1 必需实现 |
| **Online CPU extract** | KEEP | Contract reference |

### 5.2 推荐第一版

```text
CPU reference feature (online or cached)
    → torch GPU CNN training
    → export numpy_p1 artifact
    → validate_artifact_v1 + probe_v2_inference
```

**不得**在第一版 GPU 化 F0，除非独立 parity 阶段 PASS。

---

## 六、Artifact Export Audit

### 6.1 导出契约（必须与现网一致）

| 字段 | 值 | 变更 |
|------|-----|------|
| formatVersion | `npz-p1-v1` | 不变 |
| featureVersion | `p1-frame-mel-f0-v1` | 不变 |
| inputShape | `[64, 83]` | 不变 |
| outputShape | `[5]` | 不变 |
| backend | `numpy_p1` | **推理 backend 不变** |
| modelArchitecture | `conv1d_global_pool_v1` | 不变 |
| weights | conv1_w/b · conv2_w/b · fc_w/b · feature_mean/std | 与 `ToneModelWeightsV1` 一致 |

### 6.2 torch → numpy 可行性

| 项 | 评估 |
|----|------|
| Conv1d weight layout | PyTorch `(out, in, k)` **=** NumPy `cnn_p1` `(C_out, C_in, K)` ✅ |
| Input permute | `(N,64,83)` → `(N,83,64)` 与 NumPy 路径一致 ✅ |
| GAP + FC | 可直接映射 ✅ |
| `validate_artifact_v1` | **无需改 schema** · 需 export parity test |
| 可选新 metadata | `trainingBackend=torch_cuda_v1` in metrics/notes — **非 featureVersion** |

### 6.3 Runtime 影响

**无。** `inference.py` · `loader.py` · `numpy_p0` 不引入 torch。

---

## 七、Validation / Gate Audit（P9-C1 开发后）

| # | Gate | 必需 |
|---|------|------|
| 1 | `training/gpu/env_probe.py` — CUDA available | ✅ |
| 2 | torch train smoke（data_mini · 1 epoch） | ✅ |
| 3 | torch→numpy export shape gate | ✅ |
| 4 | `validate_artifact_v1` PASS | ✅ |
| 5 | `numpy_p1.infer_batch` + `probe_v2_inference` | ✅ |
| 6 | `test_phase9a` anti-p0-fallback（扩展 GPU path 扫描） | ✅ |
| 7 | `test_phase8_runtime_mainline` — Runtime 未改 | ✅ |
| 8 | P8-D Training Path — 特征仍 CPU reference | ✅ |
| 9 | P9-B 1k equivalent — aishell3 1k · GPU train · artifact PASS | ✅ |
| 10 | NumPy vs torch export logits parity（同 batch） | ✅ 推荐 |

---

## 八、Scope Drift Audit

| 漂移风险 | 严重度 | 防止措施 |
|----------|--------|----------|
| 训练框架变 experiment platform | 高 | 无 W&B/Hydra/Lightning；CLI only |
| model/registry/switch | 高 | 静态 gate 延续 P9-A tokens |
| 双训练主链 | 高 | 单 `train_tone_v2_model`；backend flag only |
| cached-only mainline | 中 | full 仍须 P8-D online gate 回归 |
| Shard-centric drift | 中 | cache = dataloader source option |
| Runtime GPU 依赖 | 高 | torch 不进入 inference import |
| GPU feature 暗改 Contract | 高 | C1 不做 GPU extract |
| 独立 training repo | 中 | 路径锁定 `tone_module/training/gpu` |

---

## 九、KEEP / MODIFY / RESTORE / DELETE / RECLASSIFY

| 动作 | 项 |
|------|-----|
| **KEEP** | p0 Runtime · p0 legacy train · P8-D WordInfo path · Feature Contract · numpy_p1 · validate_artifact_v1 · Shard V2 optional cache |
| **KEEP** | `models/cnn_p1.py` NumPy reference |
| **MODIFY** | `train_tone_v2_model.py` — `--training-backend torch` |
| **MODIFY** | `requirements.txt` — torch（optional extra 或 documented install） |
| **新增** | `tone_module/training/gpu/*` · `models/cnn_p1_torch.py` |
| **RESTORE** | 目标 = model training，不是 framework building |
| **DELETE** | p0 fallback in V2 GPU path · registry/switch/shadow |
| **RECLASSIFY** | GPU Training Foundation = **Lingua internal module**，非 standalone platform |

---

## 十、Required Development Matrix（P9-C1）

| # | Deliverable | Priority |
|---|-------------|----------|
| D1 | Install torch+cu124 in venv | P0 |
| D2 | `training/gpu/env_probe.py` | P0 |
| D3 | `models/cnn_p1_torch.py` | P0 |
| D4 | `training/gpu/trainer.py` + `export.py` | P0 |
| D5 | `training/gpu/dataloader.py`（V2 batch / Shard V2） | P0 |
| D6 | `train_tone_v2_model --training-backend torch` | P0 |
| D7 | `test_phase9c1_*` gates | P0 |
| D8 | TensorBoard（可选） | P2 |
| D9 | GPU feature extraction | **Out of scope** |

---

## 十问终答

| # | 问题 | 答案 |
|---|------|------|
| 1 | 是否应该单独开训练项目？ | **否** |
| 2 | 训练框架应放在哪？ | **`tone_module/training/gpu/`**（`faster_whisper_vad` 内） |
| 3 | 第一版必须安装哪些依赖？ | **torch (CUDA 12.x)**；numpy/scipy/soundfile 已有 |
| 4 | 是否必须 torchaudio / Lightning / Hydra / W&B？ | **均不需要/禁止**（TensorBoard 可选） |
| 5 | 是否先做 GPU training 而非 GPU feature extraction？ | **是** |
| 6 | 如何保持 WordInfo → Feature Tensor 主链？ | 特征仍 CPU `extract_feature`；GPU 只训练 CNN |
| 7 | torch 训练后能否导出 numpy_p1 artifact？ | **是** — Conv1d layout 兼容 |
| 8 | 是否会影响 Runtime？ | **否** — torch 隔离在 training 子模块 |
| 9 | 是否可以进入 P9-C1 开发？ | **CONDITIONAL PASS** — 先装 torch |
| 10 | 开发后能否 AISHELL-3 full training？ | **条件性可以** — 需 Shard 物化或接受 online CPU 特征耗时 + GPU train |

---

## Final Verdict

### **CONDITIONAL PASS**

P9-C1 应在 **lingua_1 / tone_module** 内以 **最小 GPU 训练子模块** 实施，**不** 新建独立平台；第一版 **仅 GPU CNN 训练 + numpy 导出**，特征侧保持 CPU reference；**PyTorch 未安装** 为当前唯一硬阻塞。全量 AISHELL-3 建议 **CPU Shard V2 一次性物化 + GPU torch 训练**（见 P9-C），与 C1 模块正交、可并行规划。

---

## 附录：代码现状索引

| 事实 | 路径 |
|------|------|
| V2 训练入口 | `tone_module/train_tone_v2_model.py` |
| NumPy CNN | `tone_module/models/cnn_p1.py` |
| CPU extractor | `tone_module/feature_v2.py` |
| WordInfo path | `tone_module/training_io/v2_training_path.py` |
| Artifact save/load | `tone_module/loader_v1.py` |
| Validation | `tone_module/validate_artifact_v1.py` |
| No registry policy | `tone_module/backends/__init__.py` |
| requirements（无 torch） | `requirements.txt` |
| P9-B 1k artifact | `tone_module/models/tone_cnn_p1_v1_1k.npz` |
| `training/` 目录 | **尚不存在** |
