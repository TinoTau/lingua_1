<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Tone_V2_Model_Architecture_Origin_and_Production_Target_Audit_2026_07_12.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Tone V2 Model Architecture Origin & Production Target Audit

**日期：** 2026-07-12  
**类型：** 只读审计 — 模型架构来源与 Production 目标  
**范围：** `electron_node/services/faster_whisper_vad/tone_module`（架构 / 契约 / 文档 / 验收产物）  
**非范围：** Runtime · Node · FW · Recall · Training 超参优化 · 网络开发

**参照 Production Baseline：**

```text
artifact:   tone_cnn_p1_v1_production_20260712.npz
architecture: conv1d_global_pool_v1
params:     ≈ 14,533 (trainable)
val_acc:    0.7144
```

---

## Executive Summary

| 问题 | 结论（有文档/代码依据） |
|------|-------------------------|
| 14K CNN 是否为最终 Production **架构**目标？ | **否** — P9 PreDev 明确定位为 **P9-A「轻量 1D CNN」**，用于快速建立 V2 artifact/eval 闭环 |
| 是否为 POC？ | **架构层面：是验证/闭环模型**；**权重层面：否** — `production_baseline_20260712` 为全量 AISHELL-3 真实训练 |
| 是否为验证 Tone 链路而设计？ | **部分成立** — P10 `structural_smoke` 明确为结构验证；P9-A CNN 为 **Feature V2 + numpy_p1 闭环** 的第一版默认架构 |
| Runtime 是否允许更大模型？ | **Hop 不变可**；**同 schema 下增大通道/层数：否** — `loader_v1` 硬编码张量形状 |
| numpy_p1 是否限制网络？ | **是** — 推理与 export 均绑定 **固定 2×Conv1d + GAP + FC** 拓扑 |
| 是否存在下一代模型计划？ | **是（文档）** — P9-B **CNN+BiGRU**；代码中 **无 CRNN 实现** |
| 继续只调 Tiny CNN 是否符合原路线？ | **不完全** — 原路线含 P9-B CRNN 作为第二实验；同架构权重迭代在 Phase 3/6 文档中允许，但 **非架构终态** |

### Final Verdict: **B — Current CNN is Phase-1 Validation Model**

> Runtime 保持冻结；在 **不修改 Feature Contract / input shape** 前提下，应进入 **下一代 Tone 模型（文档所称 P9-B：CNN+BiGRU / CRNN）** 的开发与验收，而非将 `conv1d_global_pool_v1` 视为最终架构终态。

---

## 一、模型设计初衷

### 1.1 `conv1d_global_pool_v1` 何时引入

| 证据来源 | 时间 | 内容 |
|----------|------|------|
| [Tone_V2_P9_V2_CNN_CRNN_Training_PreDev_Audit_Report.md](./Tone_V2_P9_V2_CNN_CRNN_Training_PreDev_Audit_Report.md) | **2026-07-04** | 定义 P9 目标：`Feature (64,83) → CNN/CRNN → TonePosterior`；建议 `modelArchitecture: conv1d_global_pool` |
| [Tone_V2_P9_B_FW_WordInfo_V2_CNN_1k_Pilot_Training_Report.md](./Tone_V2_P9_B_FW_WordInfo_V2_CNN_1k_Pilot_Training_Report.md) | **2026-07-04** | 首次 **1k pilot** 训练产出 `tone_cnn_p1_v1_1k.npz`，`modelArchitecture: conv1d_global_pool_v1` |
| [Tone_V2_P9_C3_Full_Feature_Cache_GPU_CNN_Training_Report.md](./Tone_V2_P9_C3_Full_Feature_Cache_GPU_CNN_Training_Report.md) | **2026-07-10** | 引入 `models/cnn_p1_torch.py` + GPU trainer；全量训练同架构 |
| `contract.py` L177 | 代码 SSOT | `P1_MODEL_ARCHITECTURE = "conv1d_global_pool_v1"` |

**Git 历史：** 仓库 `git log --all -- "**/cnn_p1_torch.py"` **无提交记录**（文件可能未纳入版本历史或为本地产物）。引入时间以 **P9 文档时间线** 为准。

### 1.2 设计目的（文档原话）

[Tone_V2_P9_V2_CNN_CRNN_Training_PreDev_Audit_Report.md](./Tone_V2_P9_V2_CNN_CRNN_Training_PreDev_Audit_Report.md) §2.4：

| 优先级 | 架构 | 理由 |
|--------|------|------|
| **P9-A（第一版默认）** | **轻量 1D CNN** | **最低复杂度；快速建立 V2 artifact + eval 闭环；便于 ablation** |
| **P9-B（第二实验）** | **CNN + BiGRU** | 声调时序建模；参数量可控 |
| P9 排除 | Conformer / Transformer | 过度复杂 |

[Tone_V2_P9_B_FW_WordInfo_V2_CNN_1k_Pilot_Training_Report.md](./Tone_V2_P9_B_FW_WordInfo_V2_CNN_1k_Pilot_Training_Report.md) L211：

> **模型质量（pilot）** — val_acc best=0.50 — **pilot 基线，非最终精度目标**

[Tone_V2_P10_Artifact_Provenance_Training_Freeze_Audit_2026_07_11.md](./Tone_V2_P10_Artifact_Provenance_Training_Freeze_Audit_2026_07_11.md) L69：

> P10 smoke 设计目标：**P10 结构/E2E 验收** — 使 Runtime 能真实加载 P1 npz 并跑通 `numpy_p1` 推理链（**非训练**）

**归类：**

| 维度 | 归类 |
|------|------|
| 架构选型 | **Baseline / Prototype（P9-A 闭环）** — 非文档中的最终精度架构 |
| 全量训练权重 | **Production Baseline（权重域）** — `production_baseline_20260712`，非 smoke |
| 结构占位 | **Smoke / Structural** — `p10_structural_smoke` |

### 1.3 为何约 14,533 参数

**代码推导（非文档猜测）：**

```text
conv1: 32 × 83 × 3 + 32  = 8,000
conv2: 64 × 32 × 3 + 64  = 6,208
fc:    64 × 5 + 5        =   325
合计可训练参数            ≈ 14,533
```

**常量来源：** `contract.py`

```python
P1_CNN_CONV1_OUT = 32
P1_CNN_CONV2_OUT = 64
P1_CNN_KERNEL_SIZE = 3
P1_N_CHANNELS = 83
```

**文档说明：** P9 PreDev 要求 **「轻量 1D CNN」** + **「最低复杂度」**，未单独写「14533」数字，但 **32/64 通道** 与 **双层 Conv** 为 P9-A 默认建议的直接实现（`Tone_V2_P9_V2_CNN_CRNN_Training_PreDev_Audit_Report.md` §2.2–2.4）。

**无** 代码或文档写明「14K 为 Production 精度终态目标」。

---

## 二、是否曾计划升级网络

### 2.1 文档中的下一代计划

| 来源 | 计划 |
|------|------|
| P9 PreDev §2.4 | **P9-B：CNN + BiGRU**（第二实验，CRNN 首选 RNN 单元） |
| P9 PreDev §2.2 | CRNN / BiGRU / BiLSTM 适配性 **「高」**；Conformer **「低（P9）」** |
| [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md) L323 | `tone_cnn` · **`tone_crnn`** · 未来模型复用 Training Engineering |
| [docs/tone-module/ARCHITECTURE.md](../tone-module/ARCHITECTURE.md) §11 | 同上 |
| [Tone_V2_Phase6_Model_Improvement_PreDev_Code_Audit_Report.md](./Tone_V2_Phase6_Model_Improvement_PreDev_Code_Audit_Report.md) | `tone_crnn_p1` 需 **新训练脚本 ± 新 adapter**（冻结设计内预期） |

### 2.2 代码搜索结果（`tone_module/`）

| 关键字 | 代码实现 |
|--------|----------|
| CRNN / BiGRU / LSTM | **无** |
| Conformer / Transformer / Attention | **无** |
| ResNet / MobileNet | **无** |
| `tone_crnn` | **无** |
| TODO / upgrade / larger capacity | **无架构升级 TODO** |

**结论：** **存在明确的文档级下一代计划（CNN+BiGRU）**；**代码尚未实现**。

### 2.3 历史模型代际（区分命名）

| 名称 | 特征 | 结构 | 阶段 |
|------|------|------|------|
| `tone_cnn_p0`–`p3` | `p0-v1` · `(80,)` mean-mel | **80→32→5 MLP** | Phase 4–7（P0 域） |
| `tone_cnn_p1_v1` | `p1-frame-mel-f0-v1` · `(64,83)` | **conv1d_global_pool_v1 ~14K** | **P9-A（V2 特征域）** |
| `tone_crnn_p1`（计划） | 同 P1 feature（文档） | CRNN | **未实现** |

---

## 三、P1 命名是否表示 Phase 1

### 3.1 代码中的 `P1` / `p1` 含义

`contract.py` 注释：

```text
# --- Feature V2 (p1-frame-mel-f0-v1) ---
# --- P1 V2 Tone Model Artifact (P9-A) — isolated from p0 npz-v1 ---
```

| 符号 | 含义 | 是否 = 项目 Phase 1 |
|------|------|---------------------|
| `p1-frame-mel-f0-v1` | **Feature 代际**（mel+F0 V2） | 否 |
| `numpy_p1` | **Backend 代际**（`(N,64,83)` 推理） | 否 |
| `cnn_p1` / `tone_cnn_p1_v1` | **P9-A artifact 命名空间** | 否 |
| `npz-p1-v1` | **Artifact schema 代际** | 否 |
| 项目 **Phase 1** | Runtime 主链冻结（[Tone_V2_Phase1_Freeze_Report.md](./Tone_V2_Phase1_Freeze_Report.md)） | 是（里程碑，不同命名空间） |

### 3.2 是否存在 P2 预留

| 类型 | 证据 |
|------|------|
| Feature P2 | **无** — 仅 `P1_FEATURE_VERSION` |
| Backend `numpy_p2` | **无** |
| Schema `npz-p2` | **无** |
| 文档 P9-B CRNN | **有** — 同 P1 feature，新 `modelArchitecture` + 新 backend 文件（Phase 6 审计预期） |

---

## 四、Runtime 是否限制模型规模

### 4.1 Runtime 真正依赖什么

**推理链（代码）：**

```text
inference.run_tone_inference
  → feature_v2.extract_feature  (固定输出 64×83)
  → ToneClassifier.predict_batch
  → numpy_p1.infer_batch
  → models/cnn_p1.forward_logits  (固定 2-Conv 图)
```

**Loader 硬约束（`loader_v1.py` `_validate_shapes`）：**

| 张量 | 强制形状 |
|------|----------|
| `conv1_w` | **(32, 83, 3)** |
| `conv2_w` | **(64, 32, 3)** |
| `fc_w` | **(64, 5)** |
| `feature_mean/std` | **(83,)** |
| `inputShape` | **[64, 83]** |
| `modelArchitecture` | **`conv1d_global_pool_v1`** |

**Runtime 不依赖：** `trainingVersion` · `val_acc` · 训练 metrics（仅 diagnostics）。

### 4.2 变更场景兼容性（代码裁决）

| 变更 | Runtime 是否无需修改 | 依据 |
|------|----------------------|------|
| 仅换权重（同形状） | **是** | `TONE_MODEL_PATH` + 同 schema npz |
| 增加 Conv **层数** | **否** | `numpy_p1` / `cnn_p1.py` 图固定 2 层；npz 键名固定 |
| 增加 **通道数**（如 32→128） | **否** | `_validate_shapes` 硬编码 32/64 |
| 参数量 ×10（同形状） | **是** | 形状不变即可加载 |
| 参数量 ×10（加宽网络） | **否** | 形状校验失败 → `model_error` |
| 换 `modelArchitecture` 字符串 | **否** | `_validate_metadata` 拒绝非 `conv1d_global_pool_v1` |

**结论：** Runtime **不仅**依赖 input/output shape，还 **硬绑定当前 2×Conv1d(32,64) 拓扑**。

---

## 五、`numpy_p1` 的限制

### 5.1 实现支持的操作

**文件：** `models/cnn_p1.py` · `backends/numpy_p1.py`

| 层 | 支持 |
|----|------|
| Conv1d（固定 2 层） | ✅ |
| ReLU | ✅ |
| Global Average Pool（时间维 mean） | ✅ |
| FC → logits | ✅ |
| Softmax | ✅ |
| Dropout / BN / RNN / Attention | ❌ |

### 5.2 阻塞点定位

| 问题 | 阻塞层 |
|------|--------|
| 增加 Conv 层 | **`cnn_p1.py` `forward_logits`** — 图写死 2 Conv；非「仅 export」 |
| 加宽通道 | **`loader_v1._validate_shapes`** + **`contract.P1_CNN_CONV*_OUT`** |
| CRNN | **无 RNN 算子**；需 **新 backend 文件**（Phase 6 审计与 P9 PreDev 一致） |
| Torch 训练更大网 | 训练侧可改，但 **export 必须匹配 numpy_p1 或新 backend** |

**限制来源：** **Export + Loader 形状校验 + numpy_p1 固定计算图** — 三者叠加；不仅是「没人实现」，而是 **P1 代际契约已冻结该拓扑**。

---

## 六、性能预算

### 6.1 已有 Benchmark 数据

| 来源 | 指标 | 值 |
|------|------|-----|
| `tone_module/_audit_fw_results_partial.json` | `tone_inference_ms` / utterance | **约 7–18 ms**（多样本） |
| `acceptance_20260712.json` / probe | batch 6 slices `toneInferenceMs` | **23 ms** |
| P9-C3 GPU 训练 | 单 epoch VRAM | **~31 MB**（训练侧，非 Runtime） |

### 6.2 明确延迟上限

**未找到** Contract / Freeze 文档中的 **Tone 推理毫秒 SLA** 或「Runtime 允许最大 ms」硬性数值。

`inference.py` 仅 **测量并上报** `tone_inference_ms` 至 diagnostics，**无** 超时裁断或预算门。

**结论：** **没有** 文档化的 Tone 推理毫秒上限；现有观测表明 14K 模型在 utterance 级为 **个位数～十几 ms** 量级。

---

## 七、当前模型是否达到设计目标

### 7.1 按最初设计逐项对照

| 设计目标（文档） | 当前状态 | 判定 |
|------------------|----------|------|
| P9-A：建立 V2 artifact + eval 闭环 | ✅ pilot + 全量 cache + GPU 训练 + validate + Runtime 接入 | **已完成** |
| P9-A：轻量 / 最低复杂度 | ✅ ~14.5K 参数 | **已完成** |
| P9-B：CNN+BiGRU 第二实验 | ❌ 未实现 | **未完成** |
| P9 pilot：**非最终精度目标** | val_acc **0.7144**（全量） | **精度目标未在文档中定义为已达成** |
| Phase 1：Runtime 主链验证 | ✅ 200/200 effective_chain（历史报告） | **已完成（架构里程碑）** |
| Phase 1.5：Production Business Baseline | ✅ 权重 + 业务报告 | **已完成（权重基线，非架构终态）** |

**结论：** 按 P9-A **闭环/验证** 目标 — **已完成**；按 P9 文档中的 **架构演进路线（含 P9-B）** — **仅完成第一阶段**。

---

## 八、当前开发是否偏离原计划

### 8.1 依据历史设计（非个人建议）

| 路线 | 文档立场 |
|------|----------|
| 同架构权重迭代（Loss / Scheduler / 更长训练） | Phase 3 Model Capability **允许**；Phase 6 **CONDITIONAL PASS** 于 p2/p3 权重替换 |
| 仅做 Tiny CNN 超参、永不升级架构 | **未** 在 P9 PreDev 中列为终态；P9-B CRNN 为 **明示第二实验** |
| 进入 CRNN / 新 backend | P9 PreDev + Phase 6 审计 **预期路径**；需 Training Foundation MODIFY，Runtime Hop **可不变** |

**裁决：** 若 **长期仅** 在 `conv1d_global_pool_v1` 上调 Loss/Scheduler — **部分符合** Phase 3「模型能力」中的权重迭代，但 **不符合** P9 文档记载的 **双阶段架构路线（A→B）**。

---

## 九、Production Target

### 9.1 文档中可核实的 Production 要求

| 要求类型 | 是否存在明确条文 |
|----------|------------------|
| 极限轻量 / Tiny CNN 为终态 | **否** — 仅 P9-A「轻量」为 **第一版默认** |
| CPU-only | **否** — GPU 训练已为标准路径（P9-C3） |
| 高准确率数值目标（如 90%） | **否** — 未在冻结文档中发现 |
| Runtime 优先 vs 质量优先 | **部分** — Phase 3：**提升模型能力**且不修改 Runtime；**未量化**优先级权重 |
| Production artifact 命名/治理 | **是** — [models/ARTIFACT_GOVERNANCE.md](../../electron_node/services/faster_whisper_vad/tone_module/models/ARTIFACT_GOVERNANCE.md) |
| Canonical 模型（P0 域历史） | `tone_cnn_p1` @ p0-v1（[TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md) L115）— **与当前 P1 V2 14K CNN 不同域** |

**结论：** 项目 **不存在** 单条「Production 必须保持 14K CNN」的架构终态要求；**存在** artifact 治理与 Runtime 冻结要求；**存在** P9 双阶段模型路线（轻量 CNN → CRNN）。

---

## 十、最终八问

| # | 问题 | 答案 |
|---|------|------|
| 1 | 14K 模型是不是最终 Production **架构**目标？ | **否** — P9-A 轻量闭环架构；P9-B CRNN 为文档第二实验 |
| 2 | 是不是 POC？ | **架构：偏 POC/闭环**；**`production_baseline_20260712` 权重：非 POC**（全量训练） |
| 3 | 是不是为验证 Tone 链路？ | **部分** — P10 smoke 纯结构验证；P9-A 为 **V2 特征+artifact+Runtime 接入** 的第一版；Phase 1 已验证主链 |
| 4 | Runtime 是否允许更大模型？ | **同拓扑更大权重：是**；**加宽/加深：否**（须改 loader+numpy_p1+export） |
| 5 | numpy_p1 是否真正限制网络？ | **是** — 固定 2×Conv1d+GAP+FC 图 + loader 形状锁死 |
| 6 | 是否存在下一代模型计划？ | **是（文档 P9-B CNN+BiGRU）**；**代码未实现** |
| 7 | 继续只优化 Tiny CNN 是否符合原始设计？ | **不完全** — 权重迭代符合 Phase 3；**架构终态路线含 CRNN 升级** |
| 8 | 是否应正式进入下一代 Tone 模型？ | **是（在 Runtime/Feature 冻结前提下）** — 对应文档 P9-B；非重复 Phase 1 主链验证 |

---

## 十一、Final Verdict

## **B — Current CNN is Phase-1 Validation Model**

**依据摘要：**

1. P9 PreDev **明文**将 `conv1d_global_pool` 定为 **P9-A 轻量第一版**，目的是 **快速闭环**，并将 **CNN+BiGRU** 列为 **第二实验**。  
2. P9-B Pilot **明文**「非最终精度目标」。  
3. Production Baseline `20260712` 是 **该架构上的全量训练权重基线**，不是 **架构终态** 声明。  
4. `loader_v1` + `numpy_p1` **冻结 32/64 双 Conv 拓扑**，更大网络需新代际 backend，但 **Runtime Hop 可保持**。  
5. **无** 文档将 14K CNN 定为最终 Production 架构；**有** CRNN 计划且无代码。

**不建议 Verdict A 的原因：** 缺少任何文档将 `conv1d_global_pool_v1` 标为最终架构目标。  

**不建议 Verdict C 的原因：** P9/P10/P9-C3/Phase1.5 文档链完整，证据充分。

---

## 十二、证据索引

| 类型 | 路径 |
|------|------|
| 架构 SSOT | `tone_module/contract.py` |
| Torch 训练图 | `tone_module/models/cnn_p1_torch.py` |
| NumPy 推理图 | `tone_module/models/cnn_p1.py` |
| Runtime Loader 形状锁 | `tone_module/loader_v1.py` |
| P9 架构路线 | `docs/tone-v2/Tone_V2_P9_V2_CNN_CRNN_Training_PreDev_Audit_Report.md` |
| Pilot 非终态精度 | `docs/tone-v2/Tone_V2_P9_B_FW_WordInfo_V2_CNN_1k_Pilot_Training_Report.md` |
| Structural smoke | `docs/tone-v2/Tone_V2_P10_Artifact_Provenance_Training_Freeze_Audit_2026_07_11.md` |
| Production 权重基线 | `docs/tone-v2/Tone_V2_Phase1_Production_Baseline_Recovery_Training_Report_2026_07_12.md` |
| CRNN 平台预期 | `docs/tone-v2/Tone_V2_Phase6_Model_Improvement_PreDev_Code_Audit_Report.md` |
| Artifact 治理 | `tone_module/models/ARTIFACT_GOVERNANCE.md` |

---

*Read-only audit · No code modified · 2026-07-12*
