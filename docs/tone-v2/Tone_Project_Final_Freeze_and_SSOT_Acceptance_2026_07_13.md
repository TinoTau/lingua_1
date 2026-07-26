# Tone Project Final Freeze & SSOT Acceptance Audit

**Date:** 2026-07-13  
**Audit Type:** Tone Project Final Freeze（最终冻结 · 只读验收）  
**Scope:** 不开发 · 不训练 · 不修改 Runtime · 不继续优化 CRNN  
**Prior Evidence:**  
- [`Tone_Model_V3_Recognition_Ceiling_Audit_2026_07_13.md`](./Tone_Model_V3_Recognition_Ceiling_Audit_2026_07_13.md)  
- [`Tone Model V2 Production Architecture（冻结方案）.md`](./Tone%20Model%20V2%20Production%20Architecture%EF%BC%88%E5%86%BB%E7%BB%93%E6%96%B9%E6%A1%88%EF%BC%89.md)

---

## Final Verdict

## **B — Freeze PASS · SSOT 存在文档级问题**

| 维度 | 判定 |
|------|------|
| **Engineering Freeze（工程冻结）** | **PASS** — 可进入 Maintenance |
| **SSOT Acceptance（全域单一真相）** | **CONDITIONAL** — 生产 Runtime 链 PASS；文档与遗留域未完全 SSOT |

**裁决：** Tone **工程开发阶段可正式结束**；生产主链已冻结且可维护。SSOT 在**代码生产路径**上成立，但在**冻结文档与遗留工具索引**上存在必须同步项（本轮仅列出，不实施）。

---

## 一、本轮目标确认

| 目标 | 状态 |
|------|------|
| 完成 Tone 项目最终冻结 | ✅ 本报告定义冻结边界 |
| 不再扩大模型（CNN / CRNN / Transformer） | ✅ 冻结 |
| 不再开发 / 修改 Runtime | ✅ 冻结 |
| 不再修改当前 Feature `p1-frame-mel-f0-v1` | ✅ 冻结 |
| 进入 Maintenance | ✅ 准许 |

---

## 二、Development Timeline（开发历程）

```
P9-A  Tiny CNN (conv1d_global_pool_v1, ~14K)
  ↓   建立 Feature V2 + Artifact + Runtime + Node 闭环
  ↓   val_acc 71.44%（Business Baseline 存档）
  ↓
P9-B  Production CNN V2 (conv1d_production_v2, ~200K)
  ↓   GPU 全量训练 · AdamW/Cosine/AMP
  ↓   val_acc 82.48%（Development Baseline）
  ↓   解决：模型 under-capacity · 帧级 mel+F0 首次被吃满
  ↓
P9-C  CRNN V3 (conv1d_bigru_v1, 227K)
  ↓   BiGRU 时序建模 · NumPy CPU 推理优化
  ↓   val_acc 83.56%（Research Baseline）
  ↓   解决：时序聚合；未达 90% promotion 目标
  ↓
Recognition Ceiling Audit（2026-07-13）
  ↓   确认收益递减 · 瓶颈在 Label 非模型容量
  ↓   停止 CRNN 扩参
  ↓
Final Freeze（本报告）
  ↓   工程冻结 · SSOT 验收 · 进入 Maintenance
```

### 各阶段结论

| 阶段 | 解决的问题 | 最终结论 |
|------|-----------|---------|
| **P9-A** | V2 Feature/Runtime/Artifact 闭环验证 | **完成历史使命**；退役为主要对照 |
| **P9-B** | 生产级 CNN 精度（+11 pp） | **Production Development Baseline** |
| **P9-C** | CRNN 时序建模（+1.08 pp） | **Research Baseline**；不 promotion |
| **Ceiling Audit** | 为何 83.56% 触顶 | Label > Dataset > Feature > Model |
| **Final Freeze** | 工程边界与 SSOT | 冻结生产链；研究仅限 Label/Feature/Dataset |

---

## 三、Final Architecture Freeze（永久冻结）

以下链路**永久冻结**，除非正式 **Architecture Unfreeze**：

```
FW Timestamp（WordInfo start/end）
    ↓
Feature  feature_v2.extract_feature  →  (64, 83)  p1-frame-mel-f0-v1
    ↓
Runtime  inference.py → classifier.py
    ↓
Loader   ToneModelLoaderV1（loader_v1.py）
    ↓
Backend  numpy_p1（CNN）| numpy_crnn_v1（CRNN）— 由 artifact architecture 决定
    ↓
Artifact npz-p1-v1
    ↓
CPU NumPy 推理（训练可用 GPU，推理禁止 torch）
    ↓
AcousticToneSlice / TonePosterior
    ↓
Recall（不变）
```

**同步冻结（不得修改）：** Node 接入方式 · Lexicon · KenLM · FW 主链。

---

## 四、Model Freeze（模型冻结）

### 4.1 最终模型状态

| 角色 | 模型 | Architecture | val_acc | Artifact |
|------|------|--------------|--------:|----------|
| **Production Baseline** | CNN V2 | `conv1d_production_v2` | **82.48%** | `models/candidate/tone_cnn_production_v2_candidate_20260712.npz` |
| **Research Baseline** | CRNN V3 Full | `conv1d_bigru_v1` | **83.56%** | `models/candidate/tone_crnn_v3_full_candidate_20260713.npz` |
| **历史存档** | Tiny CNN P9-A | `conv1d_global_pool_v1` | 71.44% | `tone_cnn_p1_v1_production_20260712.npz`（不得覆写） |

### 4.2 停止项（冻结）

| 方向 | 状态 |
|------|------|
| 继续扩大 CNN | **停止** |
| 继续扩大 CRNN（hidden 96→128→256） | **停止** |
| Transformer / Conformer | **不进入当前路线** |
| CRNN Promotion 为 Production | **不执行**（未达 ≈90% 门槛） |

**Runtime 默认加载：** `config.TONE_MODEL_PATH` → `tone_cnn_p1_v1_full.npz`（CNN V2 生产路径；见 `artifact_governance.py`）。

---

## 五、Recognition Ceiling Freeze（识别上限冻结）

冻结 [`Tone_Model_V3_Recognition_Ceiling_Audit_2026_07_13.md`](./Tone_Model_V3_Recognition_Ceiling_Audit_2026_07_13.md) 结论：

```
Tiny CNN   71.44%
    ↓ +11.04 pp
CNN V2     82.48%
    ↓ +1.08 pp
CRNN V3    83.56%  ← 当前冻结管线上限
```

| 冻结结论 | 依据 |
|---------|------|
| 收益递减已确认 | V2→CRNN 仅 +1.08 pp；Pilot +3.49 pp → Full +1.08 pp |
| 扩模型 ROI 低 | hidden 扩大预计 <1 pp |
| 主瓶颈为 Label | 33.5% 错误为变调类混淆 |
| 理论实际上限 ~85–86% | 当前 Feature+Label 下；90% 需 Label 修正 |

**该结论自本报告起冻结，不得再以「继续堆模型」作为主质量路线。**

---

## 六、Project Boundary Freeze（项目边界）

### 6.1 允许（Maintenance 后唯一研究方向）

| 方向 | 说明 |
|------|------|
| **Label Strategy** | 变调一致标注 · 轻声质量 · 标注审计 |
| **Feature Version（未来新版本）** | 需正式 Unfreeze + 新 `featureVersion` |
| **Dataset Strategy（未来新版本）** | 新数据源 / 新 split 策略 |

### 6.2 禁止（除非 Architecture Unfreeze）

Runtime · Node · FW · Recall · Lexicon · KenLM · Artifact Contract（`npz-p1-v1`）· 当前 CPU Runtime · 当前 Feature `(64,83)` · CRNN/CNN 架构扩参

---

## 七、SSOT Acceptance Audit（重点）

### 7.1 审计方法

- 生产主链源码静态审计：`inference.py` · `classifier.py` · `loader_v1.py` · `feature_v2.py` · `backends/*`
- 门禁测试：`test_phase8_runtime_mainline.py` · `test_phase9a_v2_cnn_training.py` · `test_phase9c3_no_p0_fallback.py`
- 冻结文档交叉比对：`TONE_V2_CONTRACT_FREEZE.md` · `TONE_V2_TRAINING_ENGINEERING_FREEZE.md` · P10 报告

### 7.2 分项结果

| SSOT 维度 | 生产域判定 | 证据 |
|-----------|-----------|------|
| **Runtime** | **PASS** | 唯一主链：`inference` → `feature_v2` → `get_tone_loader_v1` → backend；无 registry · 无 hot_reload |
| **Feature** | **PASS** | Runtime 仅 `extract_feature`；`test_phase8` 禁止 `extract_mel_features` |
| **Artifact** | **PASS** | 生产仅 `npz-p1-v1`；`loader_v1` 拒绝 P0 keys |
| **Loader** | **PASS** | 生产单例 `get_tone_loader_v1()`；无 shadow loader |
| **Backend** | **PASS** | 按 `ToneModelWeightsV3` / metadata.backend **确定性**分发；`numpy_p1` 拒绝 CRNN 权重 |
| **Export** | **PASS（按架构分链）** | `export.py` / `export_v2.py` / `export_crnn_v1.py` 各对应单一 architecture；非 auto-detect |
| **Dataset** | **PASS（Canonical）** | AISHELL-3 `openslr_aishell3/v1` · speaker holdout · seed=42 · 997,992 |
| **Training** | **CONDITIONAL** | 生产训练以 GPU `trainer_v2` + `training_features_v2` 为主；遗留 trainer 仍存在 |
| **Feature Cache** | **CONDITIONAL** | Canonical = `training_features_v2` / `training_feature_shard_v2`；v1 shard 遗留 |
| **Documentation** | **FAIL** | `TONE_V2_CONTRACT_FREEZE.md` 仍描述 P0/numpy_p0/loader.py |

### 7.3 生产 Runtime 证据

```46:58:electron_node/services/faster_whisper_vad/tone_module/classifier.py
    def predict_batch(self, feature_batch: np.ndarray) -> np.ndarray:
        ...
        if isinstance(weights, ToneModelWeightsV3):
            return infer_batch_crnn(feature_batch, weights)
        ...
        return infer_batch_cnn(feature_batch, weights)
```

```430:435:electron_node/services/faster_whisper_vad/tone_module/loader_v1.py
            if any(key in data for key in _P0_FORBIDDEN_KEYS):
                raise ValueError("artifact appears to be p0 format; P1 loader refuses it")
            ...
                if fv in P0_COMPATIBLE_FEATURE_VERSIONS:
                    raise ValueError(f"p0 featureVersion refused: {fv}")
```

```35:40:electron_node/services/faster_whisper_vad/tone_module/test_phase8_runtime_mainline.py
    def test_classifier_uses_p1_loader_and_backend(self) -> None:
        clf_source = inspect.getsource(classifier)
        self.assertIn("get_tone_loader_v1", clf_source)
        self.assertIn("numpy_p1", clf_source)
        self.assertNotIn("from tone_module.loader import get_tone_loader", clf_source)
        self.assertNotIn("numpy_p0", clf_source)
```

### 7.4 无隐藏 Fallback 确认（生产路径）

| 检查项 | 结果 |
|--------|------|
| 生产 `inference` 回退 P0 mel | **不存在** |
| `loader_v1` 加载失败回退 `loader.py` | **不存在** |
| Backend auto-detect / registry | **不存在** |
| CRNN 失败回退 CNN | **不存在** |
| `TONE_MODEL_ID` 热切换 | **不存在** |

`run_tone_model_v3_*` 验收字段 `noFallback: true` · `noShadow: true`（metrics JSON）。

---

## 八、Legacy Cleanup Audit（遗留清单）

### 8.1 遗留内容（完整列出）

| 类别 | 路径 | 用途 | 建议 |
|------|------|------|------|
| P0 Loader | `loader.py` | P0 回归 / Phase3 测试 | **保留** · 标注 Legacy · 不用于生产 |
| P0 Backend | `backends/numpy_p0.py` | P0 验证 | **保留** · 测试依赖 |
| P0 Feature | `mel.py` | P0 mel + v1 shard 构建 | **保留** · 禁止进入 Runtime |
| P0 Validator | `validate_artifact.py` | P0 四阶段验收 | **保留** · 文档标注 Legacy |
| P0 离线评估 | `offline_tone_eval.py` | P0 only 评估 | **保留** · 或迁移至 v1 validator |
| P0 训练 CLI | `train_tone_cnn.py` | P0 训练 + 旧 CLI | **冻结** · 不删除（历史回归） |
| Feature Shard V1 | `training_io/feature_shard.py` · `shard_reader.py` | mel-80 shard | **保留** · 标注 Superseded |
| Feature Shard V2 | `training_io/feature_shard_v2.py` | **Canonical** | **保留** |
| CRNN 慢参考 | `models/crnn_v3_baseline.py` | profiling 对照 | **保留** |
| CRNN 优化实验 | `models/crnn_v3_optimized.py` | profiling 对照 | **保留** |
| Pilot 子集 | `training_io/pilot_subset.py` | CRNN pilot | **保留** · 研究用 |
| Smoke 模型目录 | `models/smoke/` | 结构验证 | **保留** |
| Candidate 目录 | `models/candidate/` | 训练输出 | **保留** |
| 审计 JSON | `_audit_*.json` | 历史探针 | **可归档** · 非 Runtime |
| 过时 README | `models/README.md` | 仍写 P0 | **必须更新**（SSOT 项） |
| Legacy 数据回退 | `cache_layout.legacy_extract_root()` | data_mini 迁移 | **只读** · 不影响 AISHELL canonical |

### 8.2 是否建议删除？

**否。** 遗留项服务于 **回归测试与历史复现**；删除会破坏 Phase 2–9 门禁。正确做法是 **文档标注 Legacy + 禁止生产引用**，而非物理删除。

---

## 九、Production Readiness（生产就绪分类）

| 组件 | 分类 | 说明 |
|------|------|------|
| **Runtime（inference + classifier）** | **Production** | P10 直接替换完成 · 门禁 PASS |
| **Feature `p1-frame-mel-f0-v1`** | **Production** | `feature_v2` SSOT |
| **Artifact Contract `npz-p1-v1`** | **Production** | V1/V2/V3 architecture 共用格式 |
| **Loader `ToneModelLoaderV1`** | **Production** | 拒绝 P0 |
| **CPU NumPy Backend** | **Production** | `numpy_p1` + `numpy_crnn_v1` |
| **CNN V2 Candidate** | **Production Baseline** | val 82.48% · 推广候选 |
| **CRNN V3 Full** | **Research** | val 83.56% · 未 promotion |
| **Tiny CNN P9-A** | **Historical Archive** | 仅历史对照 |
| **Label Strategy** | **Research** | 变调标注未实施 |
| **Feature V2（未来版）** | **Research** | 需 Unfreeze |
| **Dataset Strategy** | **Research** | Canonical AISHELL-3 已冻结 |
| **GPU Training Pipeline** | **Maintenance** | 仅复现/验收 · 非 Runtime |

---

## 十、Future Roadmap（冻结后路线）

### 10.1 唯一允许研究方向

```
Label V2（变调一致 · 轻声质量 · 标注审计）
    ↓ 预期释放 ~5 pp
Feature V2（新 featureVersion · 需正式 Unfreeze）
    ↓
Dataset Strategy V2（新数据源 / 新 split）
```

### 10.2 明确停止方向

| 停止项 | 依据 |
|--------|------|
| 扩大 CNN | Ceiling Audit · V2 已接近 Feature 上限 |
| 扩大 CRNN | Full +1.08 pp · hidden 扩预计 <1 pp |
| Transformer / Conformer | 未进入冻结方案 · ROI 未验证 |
| 继续 Runtime 优化 | P10 已冻结 · NumPy CRNN 已 PASS latency |
| 修改 Node / FW / Recall | Architecture Freeze |

---

## 十一、Final Acceptance（十问）

| # | 问题 | 回答 |
|---|------|------|
| 1 | Tone 项目是否真正完成冻结？ | **是（工程域）** — 架构 · 模型 · 上限结论均已冻结 |
| 2 | 是否真正符合 SSOT？ | **生产 Runtime：是**；**全域（含文档）：否** — 契约文档未同步 |
| 3 | 是否还有重复链路？ | **生产：否**；**遗留域：是** — P0 训练链与 v1 shard（已隔离，不进入 Runtime） |
| 4 | 是否还有 Legacy？ | **是** — 见 §8；有意保留，非生产双链 |
| 5 | 是否存在隐藏 Fallback？ | **生产路径：否** |
| 6 | 是否存在双 Runtime？ | **生产：否**；遗留 `numpy_p0` 仅测试/离线 |
| 7 | 是否存在双 Feature？ | **生产：否**（仅 `feature_v2`）；训练遗留 `mel.py` |
| 8 | 是否存在双 Artifact？ | **生产：否**（仅 `npz-p1-v1`）；P0 npz 仅历史 |
| 9 | 是否存在双 Training？ | **是（遗留）** — 多 trainer 并存；Canonical 路径已明确 |
| 10 | 是否可以正式结束 Tone 工程开发？ | **是** — 进入 Maintenance；质量提升转 Label 研究 |

---

## 十二、SSOT 必须修复项（Verdict B）

本轮**不实施代码修改**；以下项为进入完全 SSOT 的**文档级必须同步项**：

| 优先级 | 项 | 文件 |
|--------|-----|------|
| **P0** | 契约 SSOT 从 P0 迁移至 P1 Runtime | `docs/tone-v2/TONE_V2_CONTRACT_FREEZE.md` |
| **P0** | Canonical shard 升级为 v2 | `docs/tone-v2/TONE_V2_TRAINING_ENGINEERING_FREEZE.md` |
| **P1** | 模型目录说明更新 | `tone_module/models/README.md` |
| **P1** | 工具索引去除 P0 为 SSOT 的表述 | `docs/tone-v2/README.md` |
| **P2** | 增补 Legacy 索引（可选） | `tone_module/LEGACY_INDEX.md`（建议新增） |
| **P2** | Runtime 门禁补充 CRNN backend 断言 | `test_phase8_runtime_mainline.py`（文档先行定义允许性） |

**不要求：** 删除遗留代码 · 重新训练 · 修改 Runtime · 扩大 CRNN。

---

## 十三、Maintenance 模式定义

自本报告起，Tone 项目进入 **Maintenance**：

| 允许 | 禁止 |
|------|------|
| 回归测试修复（不改变契约） | 新 Feature Version（无 Unfreeze） |
| 文档 SSOT 同步（§十二） | Runtime / Node / FW 功能开发 |
| Label / Dataset 研究（独立分支） | CNN / CRNN 架构扩参 |
| Candidate 验收与 promotion 流程 | Transformer 路线 |
| 依赖安全更新（不改变行为） | 修改 Artifact Contract |

---

## 十四、证据索引

| 证据 | 路径 |
|------|------|
| 生产 Runtime | `tone_module/inference.py` · `classifier.py` |
| Feature SSOT | `tone_module/feature_v2.py` · `contract.py` |
| Loader SSOT | `tone_module/loader_v1.py` |
| Backend | `tone_module/backends/numpy_p1.py` · `numpy_crnn_v1.py` |
| Runtime 门禁 | `tone_module/test_phase8_runtime_mainline.py` |
| Artifact 治理 | `tone_module/models/ARTIFACT_GOVERNANCE.md` |
| CNN V2 冻结 | `docs/tone-v2/Tone_Model_V2_CNN_Freeze.md` |
| CRNN 全量报告 | `docs/tone-v2/Tone_Model_V3_CRNN_Full_Production_Training_Report_2026_07_13.md` |
| 识别上限 | `docs/tone-v2/Tone_Model_V3_Recognition_Ceiling_Audit_2026_07_13.md` |
| 架构冻结方案 | `docs/tone-v2/Tone Model V2 Production Architecture（冻结方案）.md` |

---

**Signed Verdict:** **B — Tone Project Final Freeze PASS · SSOT 文档待同步 · 准许进入 Maintenance**
