<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Tone_V2_P8_C_Scope_Drift_Audit_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Tone V2 P8-C — Scope Drift Audit Report

**Date:** 2026-07-04  
**Phase:** P8-C Direction / Scope Drift Audit（**只读** · **非开发** · **非训练**）  
**Audit Type:** Original Goal Alignment · Feature Shard Scope · Training Engineering Overreach

**原始目标（本轮审计 SSOT 定义）：**

```text
TextGrid
→ SyllableSample
→ WordInfo Adapter
→ WordInfo
→ shared Feature Extractor
→ Feature Tensor
→ 重新训练 Tone 模型
```

**原则：**

1. TextGrid 改造核心 = 训练数据使用与 Runtime 一致的 **WordInfo timestamp contract**  
2. Feature Extractor = 训练与未来 Runtime 共享 **Audio + WordInfo → Feature Tensor**  
3. **Feature Shard 只能是训练缓存/物化格式，不得成为架构目标**  
4. Training Engineering **不得反向主导** Feature Foundation  
5. 不得因 Shard/Reader/Manifest/Digest 工程便利改变训练目标与决策链路  

**依据：**

- [Tone V2 P8-C Feature V2 Foundation Development Specification.md](./Tone%20V2%20P8-C%20Feature%20V2%20Foundation%20Development%20Specification.md)（P8-C）
- [Tone V2 P8-C — Feature V2 Foundation Implementation Addendum.md](./Tone%20V2%20P8-C%20%E2%80%94%20Feature%20V2%20Foundation%20Implementation%20Addendum.md)
- [Tone V2 P8-C — Feature Contract Specification.md](./Tone%20V2%20P8-C%20%E2%80%94%20Feature%20Contract%20Specification.md)
- [Tone_V2_P8_C_Feature_V2_Foundation_Development_Report.md](./Tone_V2_P8_C_Feature_V2_Foundation_Development_Report.md)
- [Tone_V2_P8_C_Feature_V2_Foundation_Freeze_Audit_Report.md](./Tone_V2_P8_C_Feature_V2_Foundation_Freeze_Audit_Report.md)
- [Tone_V2_P8_B_Feature_V2_Contract_Foundation_PreDev_Audit_Report.md](./Tone_V2_P8_B_Feature_V2_Contract_Foundation_PreDev_Audit_Report.md)
- 当前仓库实际代码（只读核对）

---

## Executive Summary

| 问题 | 结论 |
|------|------|
| 是否偏离「TextGrid→WordInfo→Feature→重训」原始目标？ | **轻微～中等偏离（呈现层）**；**核心链路已实现，重训尚未开始** |
| 是否误扩展为 Shard V2 为中心的 Training Engineering 工程？ | **部分呈现是**（文档/冻结审计/测试权重）；**代码层未让 Shard 反向定义 Contract** |
| Adapter + Extractor 是否完成？ | **是** — 本轮**真正核心产物** |
| Feature Shard V2 是否被过度提升为架构目标？ | **在文档与 Freeze Audit 表述上：是**；在代码所有权上：**否**（仍属 Training Engineering） |
| 是否必须删代码？ | **否** — 需 **RECLASSIFY**，非 DELETE |
| 下一步应是什么？ | **Training Path 验收**（Adapter→Extractor→Tensor→Model），**非** Canonical Shard 全量构建验收 |

### Final Verdict: **CONDITIONAL PASS**

**理由：** 原始目标的 **Foundation 前半段**（WordInfo Adapter · shared Extractor · P1 Contract）已在代码中落地且架构正确；**后半段**（V2 模型重训 · Runtime 共享 Extractor）**未做**——这与 P8-C「Foundation 非 Model 训练」一致，但开发/冻结报告 **过度把 Shard 全量构建写成「重训前唯一下一步」**，构成 **Scope 叙事漂移**，而非 **架构级 FAIL**。

---

## 一、Original Goal Alignment Audit

### 1.1 目标对齐矩阵

| 层级 | 原始目标 | 当前实现 | 分类 |
|------|----------|----------|------|
| TextGrid → SyllableSample | Dataset 冻结，不改 TextGrid | **KEEP** — `alignment_textgrid.py` 未改 | 架构前提 |
| SyllableSample → WordInfo | **核心改造** | **`syllable_to_wordinfo.py`** 已实现 | **架构目标 · 已完成** |
| WordInfo → Feature Tensor | **共享 Extractor** | **`feature_v2.extract_feature`** 已实现 | **架构目标 · 已完成** |
| Feature Contract | 训练=未来 Runtime | **`contract.P1_*`** 已冻结 | **架构目标 · 已完成** |
| Feature Tensor → Tone Model | **重新训练** | **`train_and_save` 仍 p0**；无 V2 backend | **未开始（预期外推阶段）** |
| Feature Shard V2 | **仅缓存**（用户原则） | 已实现 builder/reader/CLI/tests | **工程缓存 · 必要但非目标** |
| Runtime 共享 Extractor | 未来一致 | `inference.py` 仍 p0 mel | **后续阶段** |

### 1.2 当前实现围绕哪条叙事？

**代码事实主链（V2 训练物化路径）：**

```text
SyllableSample → syllable_sample_to_word_info → WordInfo
→ extract_feature → Tensor → [可选] Feature Shard V2 NPZ
```

**文档/报告主链（易被误读）：**

```text
build-feature-shards-v2 → Canonical Feature Shard V2 → ShardReaderV2 → manifest/digest
```

**裁决：**

| 维度 | 偏向 |
|------|------|
| **代码依赖关系** | 仍围绕 **Adapter + Extractor**；Shard 是 Extractor 的**下游消费者** |
| **交付物叙述** | **偏向 Shard 工程** — 开发报告 Executive Summary 将 Shard 与 Adapter/Extractor **并列** |
| **Freeze Audit 下一步** | **偏向 Shard 全量** — 「REQUIRED BEFORE CANONICAL TRAINING」强调物化，弱化了 **Training Path 端到端** |

### 1.3 区分：架构目标 vs 必要实现 vs 工程便利

| 内容 | 归类 | 是否合理 |
|------|------|----------|
| `syllable_to_wordinfo.py` | **架构目标** | **是** |
| `feature_v2.py` + `P1_*` | **架构目标** | **是** |
| `boundary_consistency.py` | **必要验收**（Adapter 不篡改 boundary） | **是** — 服务 WordInfo 改造，非 Shard 专属 |
| `feature_shard_v2.py` | **工程缓存** | **是** — 但不应称为架构目标 |
| `shard_reader_v2.py` | **训练便利** | **是** |
| `build-feature-shards-v2` CLI | **物化工具** | **是** |
| `test_phase8_shard_contract.py` | **TE 回归** | **合理** — 权重不应高于 Extractor/Adapter 测试 |
| 997k Canonical Shard 全量 | **运维/缓存步骤** | **可选加速** — 非架构必达 |

---

## 二、Feature Shard Scope Audit

### 2.1 代码中的实际定位

| 证据 | 说明 |
|------|------|
| `feature_shard_v2.py` docstring | 「Training Engineering only」 |
| 构建链 | `require_boundary_consistency_pass` → `syllable_sample_to_word_info` → **`extract_feature`** |
| manifest | 引用 `contract.P1_*`；**不定义** shape/version |
| `boundaryProvider` | manifest 诊断字段；**不进 Tensor** |
| `ShardReaderV2` | 只读 NPZ；**不重算 Feature** |

```114:116:electron_node/services/faster_whisper_vad/tone_module/training_io/feature_shard_v2.py
            word_info = syllable_sample_to_word_info(sample, syllable_index=next_global)
            tensor = extract_feature(audio, sr, word_info)
            feature_buf.append(tensor)
```

### 2.2 文档/报告中的定位（易越界表述）

| 来源 | 表述 | 越界风险 |
|------|------|----------|
| P8-C 规格 | Scope 含「Feature Shard V2」 | **规格级合法** — 与用户「原始目标」叙述有张力 |
| 开发报告 §2.2 | 「Canonical V2 Shard 构建 CLI」 | **中等** — 「Canonical」易被读成架构里程碑 |
| Freeze Audit §十 | 「REQUIRED BEFORE CANONICAL TRAINING: 997k 全量 Shard」 | **高** — 将缓存构建等同于重训前置 **架构门** |
| Freeze Audit Executive | 「Shard V2 · Adapter · Boundary Gate **已落地**」并列 | **中等** — Shard 与 Foundation 核心混排 |

### 2.3 定位合理性判定

| 定位 | 是否合理 |
|------|----------|
| Training Cache / 物化格式 | **合理 · 代码符合** |
| Canonical Training Input（加速读取） | **合理 · 可选** |
| Feature Foundation 组成部分 | **不合理 · 代码未越界** |
| P8 **架构目标** | **不合理作为用户原始目标** — P8-C 规格含此项，属 **规格 vs 原始意图** 张力 |
| Regression Gate **核心目标** | **部分过度** — `test_phase8_shard_contract` 验证 TE，不应替代 Training Path Gate |
| 重训前 **独立工程阶段必过** | **过度** — 见 §六 |

---

## 三、Training Engineering Overreach Audit

| 检查项 | Expected | Actual | Impact | Severity | Action |
|--------|----------|--------|--------|----------|--------|
| Shard V2 反向定义 Feature Contract | 禁止 | manifest **读** `P1_*` | 无反向定义 | — | **KEEP** |
| Shard schema 反向定义 Tensor | 禁止 | `featureShape` 来自 contract | 无 | — | **KEEP** |
| Reader/Manifest 成为训练门禁 | 仅 TE 层 | 无 V2 `train_and_save` 路径 | **尚未阻塞** | **LOW** | **KEEP** |
| Boundary Gate 阻塞模型训练 | 仅验证 Adapter | Gate 绑在 **Shard build** 入口 | 若误读为训练总门禁则 **过度** | **MEDIUM** | **RECLASSIFY** — Adapter 验收，非 Shard 验收 |
| 非必要 TE 工程过多 | 最小必要 | builder + reader + CLI + 1 测试文件 | 比例可接受 | **LOW** | **KEEP** |
| Training Cache 当 Canonical Architecture | 禁止 | 文档/Frozen Audit **部分如此** | **叙事漂移** | **MEDIUM** | **RECLASSIFY** |
| Digest 门禁 | 未要求于原始目标 | Freeze Audit **建议** digest | 工程增强 | **LOW** | **OPTIONAL** |
| `train_and_save` 仅 p0 | V2 训练未接 | aishell3 仍 v1+p0 | **重训未启动** | **HIGH** | **MODIFY**（下阶段） |

**关键发现：** TE **未在代码层**反向主导 Contract；过度主要出现在 **Freeze Audit / 开发报告对「下一步」的排序**。

---

## 四、WordInfo Adapter Audit

| 检查项 | Expected | Actual | 判定 |
|--------|----------|--------|------|
| 仅字段转换 | 是 | `syllable_sample_to_word_info` 22 行 | **PASS** |
| 不修改 start/end | 是 | 直拷 `float(sample.start/end)` | **PASS** |
| boundaryProvider 不进 Feature | 否 | 仅 manifest 诊断 | **PASS** |
| 无 FeatureTimestampRecord | 禁止 | 无 | **PASS** |
| 与 Runtime WordInfo 同构 | 是 | `shared_types.WordInfo` | **PASS** |
| label 并行监督 | 是 | Shard `labels`  sidecar | **PASS** |
| wav_path 不进 WordInfo | 是 | 音频 I/O 在 builder | **PASS** |
| word 占位 | 非空 | `syllable:{index}` | **PASS** |
| probability | 元数据 | `1.0` | **PASS** |

**结论：** **Adapter 是本轮核心产物之一，且已正确完成。** TextGrid 改造在训练侧的实质落点 **就是** `SyllableSample → WordInfo`；TextGrid 本身按冻结 **未改**（符合 Dataset Foundation 边界）。

---

## 五、Feature Extractor Audit

| 检查项 | Expected | Actual | 判定 |
|--------|----------|--------|------|
| Audio + WordInfo → Tensor | 是 | `extract_feature(audio, sr, word_info)` | **PASS** |
| 独立于 Dataset | 是 | 不读 TextGrid/SyllableSample | **PASS** |
| 独立于 Training 逻辑 | 是 | 无 label/shard 依赖 | **PASS** |
| 独立于 Shard | 是 | 可单独调用 | **PASS** — `test_phase8_feature_equality` |
| 未被 Shard 反向绑定 | 是 | Shard **调用** Extractor | **PASS** |
| 可不经过 Shard 训练 | 是 | 无 V2 train loop，但 Extractor 可在线调用 | **PASS（能力）** |
| 可未来用于 Runtime | 是 | 签名与 Contract 就绪 | **PASS** — 未接入 |
| 无 Training-only / Shard-only Extractor | 禁止 | 仅 `feature_v2.extract_feature` | **PASS** |

**结论：** Extractor **符合原始目标**，且 **不是** Shard 的附属模块。

---

## 六、Training Path Audit

### 6.1 重新训练 Tone 模型的正确路径

**架构正确路径（与用户原始目标一致）：**

```text
(SyllableSample + wav) → Adapter → WordInfo → extract_feature → Tensor + label → Model
```

### 6.2 是否必须经过 Feature Shard V2？

| 路径 | 代码支持 | 判定 |
|------|----------|------|
| **A. 在线提取后训练** | `extract_feature` 可直接调用；**无 V2 train loop** | **能力具备 · 入口未接** |
| **B. 物化 Shard 后训练** | `build-feature-shards-v2` + `ShardReaderV2`；**无 V2 train loop** | **能力具备 · 入口未接** |
| **C. 两者共享 Extractor** | 是 — Shard 内调用同一 `extract_feature` | **PASS** |
| **D. Shard 为推荐缓存非必选** | **代码符合 D**；**文档/Frozen Audit 表述偏向 B 为必达** | **呈现漂移** |

**当前 `train_and_save` 事实：**

- `data_mini` → `_build_feature_matrix` → **p0 mel，无 Adapter**  
- `aishell3` → **v1 Shard** + p0 mel → **无 V2**  

**裁决：** **不得**将「Feature Shard V2 全量构建」误判为「重新训练前唯一下一步」。更准确顺序：

1. **Training Path 验收** — Adapter→Extractor→Tensor（在线或经 Shard 抽样等价）  
2. **V2 backend + train 入口** — 消费 Tensor 训练 CNN/CRNN  
3. **（可选）Canonical Shard 全量** — 训练加速/复现，**非架构门**

---

## 七、Freeze Audit Reinterpretation

| Freeze Audit 结论 | 原表述侧重 | 更准确解读 |
|-------------------|------------|------------|
| P8 Foundation 可冻结 | Adapter + Extractor + **Shard V2** 并列 | **Foundation = Contract + Adapter + Extractor**；Shard **可冻结 TE 格式**，非 Foundation 本体 |
| Canonical Feature Shard V2 可进入 | 全量 997k 构建 | **可选 TE 运维步骤**；不等于 P8 架构闭合 |
| CNN/CRNN 还不能开始 | 需 Shard + backend | **半对**：需 **V2 backend + Training Path**；Shard 全量 **非硬前提** |
| REQUIRED BEFORE TRAINING | 997k Shard · digest · F0 回归 | **应拆分**：Training Path Gate **≠** Canonical Shard Build Acceptance |

**更准确的下一步：**

```text
TextGrid→WordInfo→Feature Tensor→Training Path 验收
（而非：Canonical Feature Shard V2 Build Acceptance 作为架构主里程碑）
```

---

## 八、Decision Path Audit

**Feature Foundation 的终局决策链（不变）：**

```text
Feature Tensor → Tone Model → Tone Posterior → Recall → Ranking → Final Candidate
```

**当前 Training IO 链（手段，非终局）：**

```text
Feature Tensor → [可选 Shard NPZ] → ShardReader → MiniBatch（p0 或未实现的 V2）
```

| 检查 | 结果 |
|------|------|
| Training IO 进入 Recall/Decision | **否** |
| Shard 成为决策链环节 | **否（代码）** |
| 文档是否暗示 Shard=主链终点 | **部分（呈现层）** |

**裁决：** 决策链 **未漂移**；需防止 **项目叙事** 把 Shard 验收当成 P8 成功定义。

---

## 九、Architecture Drift Matrix

| Area | Original Goal | Current Implementation | Drift Type | Impact | Severity | Action |
|------|---------------|------------------------|------------|--------|----------|--------|
| **WordInfo Adapter** | SyllableSample→WordInfo | `syllable_to_wordinfo.py` | **无漂移** | 训练侧 Timestamp SSOT 对齐 | — | **KEEP** |
| **Feature Extractor** | 共享 Audio+WordInfo→Tensor | `feature_v2.extract_feature` | **无漂移** | Foundation 核心 | — | **KEEP** |
| **Feature Contract** | P1 唯一 | `contract.P1_*` | **无漂移** | 训练/未来 Runtime 一致 | — | **KEEP** |
| **Feature Tensor** | (64,83) | Extractor 输出 | **无漂移** | — | — | **KEEP** |
| **Feature Shard V2** | 训练缓存 | builder/reader/CLI | **叙事漂移** | 被报告提升为并列里程碑 | **MEDIUM** | **RECLASSIFY** |
| **Shard Reader** | 读缓存 | `ShardReaderV2` | **无架构漂移** | TE 便利 | **LOW** | **KEEP** |
| **Boundary Gate** | Adapter 不篡改 boundary | `boundary_consistency.py` | **无漂移** | 服务 WordInfo 改造 | — | **KEEP** |
| **Regression Gate** | Foundation 验收 | phase8 含 shard 测试 | **权重漂移** | Shard 测试与 Extractor 测试同级 | **LOW** | **RECLASSIFY** |
| **Training Entry** | V2 重训 | 仅 `build-feature-shards-v2`；`train` 仍 p0 | **能力缺口** | 原始目标后半未达 | **HIGH** | **MODIFY**（下阶段） |
| **Runtime Integration** | 未来共享 Extractor | p0 mel 不变 | **计划内未做** | 非 P8 Scope 漂移 | **MEDIUM** | **KEEP**（阶段分离） |
| **Model Training** | 重训 Tone | 未开始 | **目标未完成** | 预期外推 | **HIGH** | **下阶段** |
| **开发/Freeze 文档** | Foundation 核心叙事 | Shard 与 Adapter 并列 | **文档漂移** | 误导下一步 | **MEDIUM** | **RECLASSIFY** |

---

## 十、Required Correction Matrix

### KEEP

| 对象 | Reason |
|------|--------|
| `syllable_to_wordinfo.py` | 原始目标核心 |
| `feature_v2.py` + `P1_*` | 原始目标核心 |
| `boundary_consistency.py` | Adapter 验收，服务 WordInfo 改造 |
| `feature_shard_v2.py` / `shard_reader_v2.py` | 合法 TE 缓存（定位需 RECLASSIFY） |
| p0 并行冻结 | P8-C 明确不修改 p0 Runtime |

### RECLASSIFY

| 对象 | From | To |
|------|------|-----|
| **Feature Shard V2** | 「架构目标 / Canonical 里程碑」 | **Training cache / materialized feature artifact** |
| **build-feature-shards-v2** | 「重训前主步骤」 | **可选加速物化 CLI** |
| **test_phase8_shard_contract** | 「Foundation 核心门禁」 | **Training Engineering 格式回归** |
| **Boundary Gate（绑 Shard build）** | 「Shard 前置门」 | **WordInfo Adapter integrity gate** |
| **Freeze Audit「REQUIRED BEFORE CANONICAL TRAINING」** | Shard 全量必达 | **拆为：Training Path Gate（必）+ Shard 全量（可选）** |

### MODIFY（下阶段 · 非本轮改代码）

| 对象 | Reason |
|------|--------|
| V2 `train_and_save` / backend | 完成「→ 重训 Tone 模型」 |
| `inference.py` | Runtime 共享 Extractor（Model 阶段后） |
| 文档/Runbook 下一步排序 | Training Path 验收优先于 Shard 全量 |

### RESTORE

| 对象 | Reason |
|------|--------|
| 项目叙事主链 | 强调 TextGrid→WordInfo→Tensor→Model，Shard 脚注为缓存 |

### DELETE

| 对象 | Reason |
|------|--------|
| **无** | 已实现 Shard/Reader **无架构越界**，删之损失合法 TE 能力 |

### OPTIONAL FUTURE WORK

| 对象 |
|------|
| V2 manifest logical digest（Phase 7B2 类比） |
| F0 黄金向量回归 |
| 997k Canonical Shard 全量（训练加速） |

---

## 十一、Final Verdict — 十问

| # | 问题 | 回答 |
|---|------|------|
| **1** | 是否偏离原始目标？ | **是，但主要为呈现/阶段排序偏离**；**核心 Adapter+Extractor 未偏** |
| **2** | 偏离程度？ | **轻微～中等** — 代码 **轻微**；文档/Frozen Audit **中等** |
| **3** | 偏离来源？ | **主要来自：① P8-C 规格本身含 Shard V2；② 开发/Freeze 报告表述；③ 非实现选择**（实现未让 Shard 主导 Contract） |
| **4** | Shard V2 是否被过度提升为架构目标？ | **在文档与 Freeze Audit 中：是**；**在代码所有权：否** |
| **5** | 应 KEEP？ | Adapter · Extractor · Contract · Boundary Gate · Shard 作为 **TE 缓存** |
| **6** | 应 RECLASSIFY？ | Shard V2 · Shard 测试 · Canonical 构建 CLI · Freeze Audit 下一步表述 |
| **7** | 应 MODIFY？ | V2 训练入口 · Runtime 接入 · 文档叙事（下阶段） |
| **8** | 是否需删除已实现内容？ | **否** |
| **9** | 下一步：Shard 验收 vs Training Path 验收？ | **Training Path 验收** — `Adapter→WordInfo→extract_feature→Tensor`（在线或抽样 Shard 等价）；Shard 全量为 **可选 TE** |
| **10** | 能否不大改代码纠正方向？ | **能** —  primarily **RECLASSIFY 文档/流程/门禁命名与排序**；代码结构 **已符合**「Extractor 核心、Shard 缓存」 |

### Final Verdict: **CONDITIONAL PASS**

**摘要：**

- **未**把 P8 做成「以 Shard 为中心的 Training Engineering 替代 WordInfo 改造」——Adapter 与 Extractor 才是代码中的真实主轴。  
- **存在** Scope 叙事漂移：开发报告与 Freeze Audit **过度强调 Canonical Feature Shard V2**，易让人以为 **重训前必须先全量物化 Shard**，这与用户定义的原始目标 **不完全一致**。  
- **原始目标的后半段（重训 Tone 模型）尚未开始**——这是 **阶段边界**，不是 Shard 工程替换了重训。  
- **纠正方向**：RECLASSIFY + 下阶段补 V2 Training Path；**无需**删除 Shard V2 代码。

---

## 附录 — 代码 vs 叙事对照

**核心（原始目标）：**

```8:21:electron_node/services/faster_whisper_vad/tone_module/training_io/syllable_to_wordinfo.py
def syllable_sample_to_word_info(sample: SyllableSample, *, syllable_index: int) -> WordInfo:
    ...
    return WordInfo(
        word=f"syllable:{syllable_index}",
        start=float(sample.start),
        end=float(sample.end),
        probability=1.0,
    )
```

```200:224:electron_node/services/faster_whisper_vad/tone_module/feature_v2.py
def extract_feature(audio: np.ndarray, sample_rate: int, word_info: WordInfo) -> np.ndarray:
    ...
    return out.astype(np.float32)
```

**缓存层（非架构目标 · 合法 TE）：**

```154:168:electron_node/services/faster_whisper_vad/tone_module/training_io/feature_shard_v2.py
def build_feature_shards_v2(...):
    """Build Feature Shard V2 via Adapter → extract_feature (Boundary Gate required)."""
    all_samples = list(train_samples) + list(val_samples)
    require_boundary_consistency_pass(all_samples)
```

**重训尚未接入：**

```596:597:electron_node/services/faster_whisper_vad/tone_module/train_tone_cnn.py
        x_train, y_train = _build_feature_matrix(train_samples)
        x_val_raw, y_val = _build_feature_matrix(val_samples)
```

---

*本报告为 P8-C Scope Drift 只读审计；未修改任何代码、配置、模型、文档或 Runtime 行为。*
