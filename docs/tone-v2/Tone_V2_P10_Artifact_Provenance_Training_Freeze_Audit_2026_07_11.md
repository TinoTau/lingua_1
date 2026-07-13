# Tone V2 P10 — Artifact Provenance & Training Freeze Audit

**Date:** 2026-07-11  
**Phase:** Artifact 来源审计 + Production Training 前冻结审计（只读）  
**前置报告:**  
- `Tone_V2_P9_C3_Full_Feature_Cache_GPU_CNN_Training_Report.md`  
- `Tone_V2_P10_Runtime_Direct_Replacement_Development_Report_2026_07_11.md`  
- `Tone_V2_P10_Runtime_Business_Effect_Acceptance_Report_2026_07_11.md`  
- `Tone_V2_P10_Raw_WAV_vs_Node_Runtime_Audio_Impact_Audit_2026_07_11.md`

---

## 1. Executive Summary

| 问题 | 结论 |
|------|------|
| `p10_structural_smoke` 是什么？ | **P10 Runtime Direct Replacement 开发的结构占位 artifact**（随机初始化权重，非训练） |
| 是否覆盖真正 Production Model？ | **是** — 同名文件 `tone_cnn_p1_v1_full.npz` 于 2026-07-11 22:06 **覆写** P9-C3 全量训练产物 |
| 真正 Production Full Model 是否仍存在？ | **否（磁盘上）** — P9-C3 训练的 val_acc=0.699 权重已丢失；Git 未跟踪 npz |
| Runtime 为何加载 Smoke？ | `config.py` 默认路径指向 `tone_cnn_p1_v1_full.npz`，该文件已被 smoke 覆写 |
| 是否应立即 Production Training？ | **否** — 须先冻结 Runtime 音频域 Feature Cache 策略与 Artifact 命名规范 |
| 真正阻塞 | **(1) 生产权重被覆写 (2) 训练 Cache 域 ≠ Node Runtime 域 (3) 无 artifact 版本隔离** |

### Final Verdict: **B**

> **Smoke 不能作为 Production。必须 Production Training。**

**唯一正确下一步动作：** 先完成 **Freeze Gate（Runtime 音频域 Cache 策略 + Artifact 命名/部署规范）**，再 **按 P9-C3 冻结架构重跑全量 GPU 训练**，产出写入 **独立 Production 文件名**（不得再覆写 `tone_cnn_p1_v1_full.npz` 直至验收通过）。

---

## 2. Runtime 当前真正加载的文件

```text
Runtime 当前真正加载的是：
electron_node/services/faster_whisper_vad/tone_module/models/tone_cnn_p1_v1_full.npz
```

| 属性 | 值 |
|------|-----|
| **路径** | `electron_node/services/faster_whisper_vad/tone_module/models/tone_cnn_p1_v1_full.npz` |
| **大小** | **64,815 bytes** |
| **SHA256** | `E59971DD569F979A958300EB1556D68BB919CE0894F86099F78C66675C2BA9DC` |
| **创建时间** | 2026-07-11 00:07:54（文件 inode；首次落盘） |
| **修改时间** | **2026-07-11 22:06:16**（P10 smoke 覆写时刻） |
| **formatVersion** | `npz-p1-v1` |
| **featureVersion** | `p1-frame-mel-f0-v1` |
| **modelVersion** | `tone_cnn_p1_v1_full` |
| **trainingVersion** | **`p10_structural_smoke`** |
| **backend** | `numpy_p1` |
| **datasetVersion** | `n/a` |
| **metrics.val_acc** | **0.0** |
| **notes** | `structural smoke artifact for P10 runtime E2E; not production-trained weights` |
| **加载入口** | `config.TONE_MODEL_PATH` → `get_tone_loader_v1()` → `ToneModelLoaderV1.load()` |

**对照：** 同目录 `tone_cnn_p1_v1_full_probe.json`（2026-07-11 00:28）与 `tone_cnn_p1_v1_full_validate.json`（00:09）为 **覆写前** 对真实 P9-C3 训练权重的验收记录；与当前 npz metadata **不一致**，证明发生过覆写。

---

## 3. `p10_structural_smoke` 来源（Provenance）

### 3.1 如何产生

| 项 | 证据 |
|----|------|
| **生成方式** | `init_cnn_p1_weights(rng)` 随机初始化 + `loader_v1.save_artifact_v1()` 写入 |
| **非训练** | `metrics.val_acc=0.0`；`datasetVersion=n/a`；notes 明示非 production-trained |
| **开发任务** | **Tone V2 P10 — Runtime Direct Replacement**（Cursor Agent，2026-07-11） |
| **设计目标** | P10 结构/E2E 验收：使 Runtime 能 **真实加载** P1 npz 并跑通 `numpy_p1` 推理链 |
| **输入数据** | **无** — 不使用 AISHELL-3 / dialog_200 / 任何标注集 |
| **数据规模** | **0 训练样本** |
| **脚本 API** | `tone_module.models.cnn_p1.init_cnn_p1_weights` + `tone_module.loader_v1.save_artifact_v1` |
| **参数** | `training_version='p10_structural_smoke'`，`model_version='tone_cnn_p1_v1_full'`，`notes='structural smoke...'` |

### 3.2 为何命名为 `p10_structural_smoke`

根据 **artifact 内嵌 metadata**（非猜测）：

| 含义 | 判定 |
|------|------|
| 真正训练版本 | **否** |
| 临时 / 结构验证 | **是** |
| CI smoke | **类 smoke**（手工 Agent 生成，非 CI 自动） |
| 单元测试 | **否**（独立于 pytest；供 Runtime E2E） |
| Placeholder | **是** |
| Demo | **否** |

**`p10`** = P10 Direct Replacement 阶段；**`structural_smoke`** = 仅验证 schema/loader/runtime 接线，不含训练语义。

### 3.3 是否 P10 开发引入

**是。** 非历史遗留。

- P9-C3（2026-07-10）已将 **真实全量训练权重** 写入 **同名** `tone_cnn_p1_v1_full.npz`（val_acc **0.699**）。
- P10 开发（2026-07-11 22:06）为通过 Runtime E2E，**覆写** 该路径为 structural smoke。
- 开发报告：`Tone_V2_P10_Runtime_Direct_Replacement_Development_Report_2026_07_11.md` 已标注「非生产训练权重」。

---

## 4. 是否覆盖真正 Full Model？

### 4.1 曾经存在的 Production Full Model

**存在过** — P9-C3 全量 GPU 训练：

| 项 | P9-C3 记录（开发报告 + 覆写前 probe/validate JSON） |
|----|--------------------------------------------------|
| 路径 | `tone_module/models/tone_cnn_p1_v1_full.npz`（**同一路径**） |
| 训练命令 | `python -m tone_module.train_tone_v2_model train --dataset aishell3 --feature-cache-dir .../training_features_v2 --training-backend torch --epochs 20 ...` |
| 数据 | AISHELL-3 · **850,680 train / 147,312 val** |
| Feature | `p1-frame-mel-f0-v1` · cache **997,992** samples |
| Best val_acc | **0.699** @ epoch 14 |
| buildTime | 2026-07-10（训练日；早于 smoke 覆写） |

### 4.2 当前磁盘状态

| 文件 | 状态 | 说明 |
|------|------|------|
| `tone_cnn_p1_v1_full.npz` | **已被 smoke 覆写** | 非 P9 权重 |
| `tone_cnn_p1_v1_gpu_smoke.npz` | 保留 | P9-C3 **1 epoch / 966 train** GPU smoke，**非** full production |
| `tone_cnn_p1_v1_1k.npz` | 保留 | P9 早期 1k 子集实验 |
| `tone_cnn_p1_v1_full_production.npz` | **不存在** | 无此命名 |
| Git 历史 | **npz 未入库** | `git show` 无法恢复 full 权重 |

**结论：** Production Full Model **曾写入 `tone_cnn_p1_v1_full.npz`，现已被 P10 smoke 销毁（同路径覆写）。**不能**通过切换配置恢复，除非从外部备份重拷或 **重训**。

### 4.3 为何 Runtime 加载 Smoke

1. `config.py` `_DEFAULT_TONE_MODEL` → `tone_cnn_p1_v1_full.npz`
2. P10 Direct Replacement 将该文件替换为 structural smoke **且未改文件名**
3. 无 `TONE_MODEL_PATH` 环境变量覆盖时，Runtime 必然加载 smoke

---

## 5. Artifact 生命周期

```text
Training (P9-C3, 2026-07-10)
    → tone_cnn_p1_v1_full.npz [Production Candidate, val_acc=0.699]
        → validate_artifact_v1 PASS / probe PASS
            → Acceptance (P9-C3 PASS)
                → Production Runtime [计划接入，P10 前未切换]

P10 Structural Smoke (2026-07-11 22:06)
    → 覆写 tone_cnn_p1_v1_full.npz [Smoke / Placeholder]
        → validate_artifact_v1 PASS (schema only)
            → P10 Runtime Direct Replacement E2E PASS
                → Production Runtime [当前误用 Smoke 作为默认 artifact]
```

**当前 Runtime Artifact 阶段：** **Smoke（结构占位）** — 非 Production、非 Validation Candidate。

---

## 6. Training History 审计（磁盘 artifacts）

| Artifact | Date | Dataset | Feature | Purpose | Current Status |
|----------|------|---------|---------|---------|----------------|
| `tone_cnn_p0.npz` | 2026-06-28 | data_mini | mel_mean_80_v1 | P0 Runtime（历史） | **Deprecated** · 训练遗留 |
| `tone_cnn_p1.npz` | 2026-06-29 | early P1 | p1-frame-mel-f0-v1 | P1 实验 | Legacy |
| `tone_cnn_p2.npz` | 2026-06-30 | — | — | 实验 | Legacy |
| `tone_cnn_p3.npz` | 2026-07-02 | — | mel-era | Phase 7C | Legacy |
| `tone_cnn_p1_v1_1k.npz` | 2026-07-04 | AISHELL-3 1k | p1-frame-mel-f0-v1 | P9 子集训练 | **可用（非 production）** |
| `tone_cnn_p1_v1_gpu_smoke.npz` | 2026-07-10 | AISHELL-3 966 | p1-frame-mel-f0-v1 | P9-C3 GPU 1-epoch smoke | **可用（非 production）** |
| **`tone_cnn_p1_v1_full.npz`** | **2026-07-11 覆写** | **n/a** | p1-frame-mel-f0-v1 | **P10 structural smoke** | **⚠️ Runtime 默认加载 · Smoke** |
| P9-C3 full（原内容） | 2026-07-10 | AISHELL-3 full | p1-frame-mel-f0-v1 | **Production Candidate** | **❌ 已覆写丢失** |

---

## 7. 是否真的需要重新训练？

### 7.1 冻结门控检查（A–H）

| 门控 | 已冻结？ | 能否重训？ | 说明 |
|------|----------|------------|------|
| **A Feature Contract** | ✅ | 可 | `p1-frame-mel-f0-v1` · `(64,83)` · `feature_v2.extract_feature` — P8-C SSOT |
| **B Runtime Contract** | ✅ | 可 | `processed_audio` + WordInfo → `AcousticToneSlice` — P10 已切换 |
| **C Runtime Direct Replacement** | ✅ | 可 | P10 开发完成，无双链 |
| **D Tone Influence** | ✅ | 可 | d043 证明 Posterior→Final（业务效果验收） |
| **E ToneLookup / d001** | ⚠️ | **先评估** | d001 `toneExact=0`：**主因是 smoke 权重无语义 + cafe homophone**；d043 在 smoke 下 `toneExact=4` → Lookup **可工作** |
| **F 词库 tone_pinyin_key** | ⚠️ | **先冻结策略** | Lexicon V3 有 tone 字段；无单独「tone_pinyin_key 冻结」SSOT 文档，但 FW 已在用 |
| **G Domain SSOT** | ✅ | 可 | `fw-detector/freeze/FROZEN.md` 等已冻结 |
| **H Feature Cache** | ❌ | **不能立即** | Cache 基于 AISHELL TextGrid 音节域；P10 音频域审计要求 **Runtime 域对齐** 后再训 |

### 7.2 综合裁决

| 问题 | 答案 |
|------|------|
| 是否需要重新训练？ | **是** — 生产权重已丢失，smoke 不能上线 |
| 是否应立即开始？ | **否** — 须先冻结 **Runtime 音频域 Cache 重建策略** 与 **Artifact 命名/部署** |

---

## 8. 重训前 Freeze Checklist

| 项目 | 已冻结 | 必须先冻结 | 原因 |
|------|--------|------------|------|
| Runtime Feature Contract | ✅ | — | P8-C / `contract.py` |
| Runtime Audio Domain | ❌ | **是** | P10 审计：peak norm + Opus 路径 ≠ 纯 AISHELL raw |
| Runtime WordInfo | ✅ | — | FW ASR 字级 timestamp SSOT |
| Tone Feature (`feature_v2`) | ✅ | — | 唯一 extractor |
| Feature Version | ✅ | — | `p1-frame-mel-f0-v1` |
| Tone Lookup 语义 | ✅ | — | `tone_exact` / `plain_fallback` 已定义 |
| tone_pinyin_key（词库） | ⚠️ | **建议** | 重训不依赖词库，但业务验收依赖；避免并行改词库 |
| Domain SSOT | ✅ | — | FW freeze 文档 |
| Lexicon bundle | ⚠️ | **建议** | 与 Tone 业务验收耦合 |
| Candidate / AcousticToneSlice Contract | ✅ | — | `TONE_V2_CONTRACT_FREEZE.md` |
| Training Dataset（AISHELL-3） | ✅ | — | `TONE_V2_DATASET_FOUNDATION_FREEZE.md` |
| Label Format | ✅ | — | 5-class tone from TextGrid |
| Validation / Acceptance Dataset | ⚠️ | **是** | dialog_200 + Node E2E 为业务验收 SSOT |
| Runtime Diagnostics | ✅ | — | P10 diagnostics 字段已定义 |
| Artifact Metadata schema | ✅ | — | `npz-p1-v1` / `loader_v1` |
| **Artifact 命名与部署** | ❌ | **是** | 禁止 smoke 覆写 production 文件名 |
| **Feature Cache v2 域策略** | ❌ | **是** | 是否按 `processed_audio` 域重建 |

---

## 9. 若今天直接 Production Training 的风险

### HIGH

| 风险 | 说明 |
|------|------|
| 训练域 ≠ Runtime 域 | Cache 用 AISHELL 原始 wav + TextGrid 音节；Runtime 用 Opus 往返 + peak normalize + trim |
| 再次覆写 production 文件 | 无命名规范时可能重复 P10 事故 |
| 无生产权重回滚 | npz 不入 Git，覆写即丢失 |

### MEDIUM

| 风险 | 说明 |
|------|------|
| 词库并行变更 | tone_pinyin_key 改动使验收基线漂移 |
| d001 cafe homophone 验收标准未冻结 | 业务 PASS 标准未书面化 |
| KenLM / Penalty 并行调参 | 与模型质量混淆 |

### LOW

| 风险 | 说明 |
|------|------|
| Loader / numpy_p1 schema | 已冻结 |
| Runtime 双链回退 | P10 已禁止 |

---

## 10. Feature Cache 是否需要重建？

| 项 | 状态 |
|----|------|
| 现有 Cache | `training_features_v2/` · **~2775 文件** · P9-C3 报告 **997,992** samples |
| 提取函数 | `feature_v2.extract_feature`（与 Runtime 同函数） |
| 音频域 | **AISHELL 原始 wav + TextGrid 音节边界** |
| Runtime 域 | **`processed_audio`**（VAD 拼接 + peak -3dBFS + trim + Node Opus） |

**裁决（引用 P10 音频域审计）：** Cache **不对应** Node Runtime 音频域。  
**是否必须重建：** **是（若目标为 Production 业务质量）** — 须先 **冻结**「Cache 构建是否模拟 `preprocess_pcm_f32` + Node Opus 路径」的策略，再执行 rebuild。  
**是否阻塞结构验收：** 否 — smoke/结构链不要求 Cache 重建。

---

## 11. Production Training Plan（冻结架构内）

```text
Dataset (AISHELL-3, frozen adapter)
    ↓
Speaker Holdout Split (frozen)
    ↓
Feature Cache v2
    · 策略冻结：raw AISHELL vs Runtime-processed 域（P10 门控）
    · extract_feature (SSOT)
    ↓
Torch CUDA CNN Training (train_tone_v2_model --training-backend torch)
    · 20 epochs · batch 128 · 同 P9-C3 配置
    ↓
validate_artifact_v1 + probe_v2
    ↓
Acceptance
    · Node E2E dialog_200
    · Business Effect（tone-sensitive fixtures）
    ↓
Artifact → tone_cnn_p1_v1_full_PRODUCTION_<date>.npz（新命名，禁止覆写 smoke 路径）
    ↓
Runtime via TONE_MODEL_PATH 或验收后更新 config 默认
```

**不重设计架构。** 复用 P9-C3 已验证命令链（见 P9-C3 报告 §Full GPU Training Config）。

---

## 12. 规格十问

| # | 问题 | 答案 |
|---|------|------|
| 1 | `p10_structural_smoke` 是什么？ | P10 结构占位 npz：随机 `init_cnn_p1_weights`，0 样本训练 |
| 2 | 为什么存在？ | P10 Runtime Direct Replacement 需真实加载 P1 artifact 跑通 E2E |
| 3 | 是不是 Production Model？ | **不是** |
| 4 | 真正 Production Model 是否还存在？ | **磁盘上不存在**（P9-C3 full 已被同名覆写） |
| 5 | Runtime 为什么加载 Smoke？ | 默认路径 `tone_cnn_p1_v1_full.npz` 已被 smoke 覆写 |
| 6 | 是否应立即 Production Training？ | **否** — 先冻结 Cache 域 + Artifact 命名 |
| 7 | 真正阻塞是什么？ | 权重丢失 + Cache 域不一致 + 无 artifact 版本隔离 |
| 8 | 重训前必须冻结什么？ | Runtime 音频域 Cache 策略、Artifact 部署规范、验收数据集 |
| 9 | 是否需要重建 Feature Cache？ | **是（Production 质量路径）** — 策略先冻结 |
| 10 | 下一步 A/B/C/D？ | **先冻结（A）→ 再训练（B）**；非 C 单独修 Lookup；非 D 恢复（文件已失） |

---

## 13. Final Verdict（唯一结论）

### **Verdict B — Smoke 不能作为 Production；必须 Production Training**

**真正下一步唯一正确动作：**

1. **冻结** Runtime 音频域 Feature Cache 构建策略 + Production Artifact 命名/部署规范（smoke 不得占用 `tone_cnn_p1_v1_full.npz`）。
2. **按 P9-C3 冻结架构重跑全量 GPU 训练**（Cache 按冻结策略重建或确认沿用）。
3. 新 artifact **独立文件名** → `validate_artifact_v1` → Node E2E + Business Effect Acceptance → 再切换 `TONE_MODEL_PATH` / config 默认。

**不是 Verdict D（恢复旧 Production）：** 旧 full 权重 **无法从仓库或当前磁盘恢复**，只能重训。  
**不是 Verdict C（只修 Lookup）：** Lookup 在 d043 可工作；d001 问题与 **无意义 Posterior** 强相关。  
**不是 Verdict A（Smoke 可继续 Production）：** 与 metadata 及业务验收结论矛盾。

---

## 14. 附录：证据索引

| 证据 | 路径 |
|------|------|
| 当前 npz metadata | 本机 `tone_cnn_p1_v1_full.npz`（`trainingVersion=p10_structural_smoke`） |
| P9-C3 训练报告 | `docs/tone-v2/Tone_V2_P9_C3_Full_Feature_Cache_GPU_CNN_Training_Report.md` |
| P10 覆写说明 | `docs/tone-v2/Tone_V2_P10_Runtime_Direct_Replacement_Development_Report_2026_07_11.md` |
| 覆写前 probe | `tone_module/models/tone_cnn_p1_v1_full_probe.json`（2026-07-11 00:28） |
| GPU smoke（非 full） | `tone_module/models/tone_cnn_p1_v1_gpu_smoke.npz` |
| Feature Cache v2 | `tone_module/_data_cache/.../training_features_v2/`（2775 files） |
| save API | `tone_module/loader_v1.py` → `save_artifact_v1()` |
| Runtime 默认 | `config.py` → `_DEFAULT_TONE_MODEL` |
