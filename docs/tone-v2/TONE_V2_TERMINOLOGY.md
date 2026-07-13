# Tone V2 — Terminology Freeze（术语 SSOT）

**状态：** FROZEN  
**生效：** 2026-06-29  
**优先级：** 与 [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md) 并列；**术语歧义**以本文为准。  
**风格指南：** [TONE_V2_DOCUMENTATION_STYLE_GUIDE.md](./TONE_V2_DOCUMENTATION_STYLE_GUIDE.md)

> 修改本文档须走 **Terminology / Contract 再冻结** 流程。新文档、Runbook、审计报告 **必须**引用本文四级验收体系。

---

## 1. 四级验收体系（Validation Levels）

Tone V2 **仅**承认以下四级。**不得**自创第五级或混用层级。

```text
Level 1  Unit Test
Level 2  Dataset Probe
Level 3  Runtime Validation
Level 4  Architecture Verification
```

| Level | 名称 | 证明什么 | 不得证明什么 |
|-------|------|----------|--------------|
| **1** | **Unit Test** | 单模块 · 函数 · Contract · Parser · Feature 最小单元 | 模型质量 · Runtime · Architecture |
| **2** | **Dataset Probe** | 数据接入 · materialize · manifest · join · 统计 · Fixture Test | Runtime · Decision · 模型质量 · Node E2E |
| **3** | **Runtime Validation** | 部署后主链：`TONE_MODEL_PATH` → FW Restart → Node E2E | Dataset 接入 · 模型离线质量（单独指标） |
| **4** | **Architecture Verification** | Frozen Architecture · Decision Ownership · Contract · Pipeline · Drift | 模型质量 |

### Level 1 — Unit Test

**定义：** 验证单个模块、函数、Contract、Parser、Feature 等最小单元。

**典型入口：** `python -m unittest tone_module.test_*` · `validate_artifact` 结构门 · Loader fail-closed 测试。

**不得用于：** 模型质量结论 · Runtime 主链结论 · 架构漂移结论。

---

### Level 2 — Dataset Probe

**定义：**

```text
Dataset Adapter
    ↓
Alignment Provider
    ↓
SyllableSample[]
    ↓
Join Audit
    ↓
Dataset Statistics Probe
    ↓
Fixture Test
```

**职责：** 仅验证 **Training Foundation 数据层** 接入。

**典型入口：** `python -m tone_module.dataset.probe_aishell3`（`materialize` · `join-audit` · `stats` · **`accept`**）。

**子术语：**

| 术语 | 含义 |
|------|------|
| **Dataset Probe** | Level 2 总称 |
| **Limited Dataset Probe** | 带 `--max-utterances` / `--max-speakers` 限流 |
| **Local Dataset Probe** | 使用本地已解压路径或 `AISHELL3_LOCAL_*` |
| **Join Audit** | wav/TextGrid basename 匹配率与缺失样例 |
| **Dataset Statistics Probe** | `stats` — 音节数 · t1–t5 · invalid token |
| **Full Dataset Acceptance** | `accept` — Materialize + Join + Statistics + Manifest/License/Contract + Gates |
| **Fixture Test** | 合成语料目录上的 Dataset Probe / pipeline 单测 |

**不得参与：** Runtime · Recall · Ranking · Assembly · KenLM · Apply · Node Decision。

**不得用于：** Runtime 验收 · 模型质量验收 · 主链（FW → Node E2E）验收。

**不得与 Level 3 混用。**

---

### Level 3 — Runtime Validation

**定义：**

```text
TONE_MODEL_PATH
    ↓
FW Restart
    ↓
Node E2E（如 dialog_200 batch）
```

**职责：** 验证 **部署后** Runtime 主链未回归（`effective_chain` · `model_error` 等架构门）。

**典型入口：** `electron-node/tests/tone-v2-dialog200-batch.js` + `TONE_MODEL_PATH` + FW 重启。

**不得替代：** Dataset Probe（Level 2）。

**不得与 Level 2 混用。**

---

### Level 4 — Architecture Verification

**定义：** 验证 **Frozen Architecture** 未漂移 — Decision Ownership · Contract · Pipeline 边界 · Drift Audit。

**典型产物：** Freeze Audit Report · `Frozen Architecture Verification` 章节 · `Architecture Drift Audit` 章节。

**不得用于：** 模型质量（离线 accuracy / CER 改进）唯一依据。

**与 Level 3 关系：** Level 3 是 Runtime Validation 的**执行**；Level 4 是**架构合规性**裁决框架（可含文档 + 代码审计 + E2E 门组合）。

---

## 2. 保留术语（正名）

| 术语 | Level | 说明 |
|------|-------|------|
| Unit Test | 1 | 单元测试 |
| Dataset Probe | 2 | 数据集探针 |
| Join Audit | 2 | 对齐 join 审计 |
| Dataset Statistics Probe | 2 | 数据集统计探针 |
| Fixture Test | 2 | 合成 fixture 上的数据层验证 |
| Runtime Validation | 3 | 运行时验收 |
| Architecture Verification | 4 | 架构验证 |
| Frozen Architecture Verification | 4 | 冻结架构验证（报告章节名） |
| Architecture Drift Audit | 4 | 架构漂移审计（报告章节名） |
| Offline Evaluation | — | `offline_tone_eval` — **模型质量**离线指标；**不是** Runtime Validation；**不是** Dataset Probe |
| **Current Canonical Training Dataset** | — | 当前规范大规模训练语料（Phase 7-A：**AISHELL-3** `openslr_aishell3`） |
| **Regression Fixture** | 2 | CI / 快速回归用小型数据集（**`data_mini`**）；**不是** Canonical 语料 |
| **Dataset Foundation** | 4 | Training 数据层框架 SSOT — 见 [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md) |
| **Full Dataset Acceptance** | 2 | `probe_aishell3 accept` — Level 2 一体化验收（P7-A） |
| **Training Engineering** | 4 | Training IO 层框架 SSOT — 见 [TONE_V2_TRAINING_ENGINEERING_FREEZE.md](./TONE_V2_TRAINING_ENGINEERING_FREEZE.md) |
| **Feature Shard** | — | 物化 mel 特征 · `shard_*.npz` + manifest；**Training Engineering** |
| **Shard Reader** | — | Feature Shard 只读访问器 |
| **Sequential Feature Reader** | — | 顺序遍历特征行（**禁止**称 Streaming Feature） |
| **Mini-batch Reader** | — | batch 采样 · shuffle · epoch |
| **Canonical Feature Shard** | — | AISHELL-3 全量物化槽 `training_features/`（P7-B2） |
| **Canonical Training Input** | — | Reader 链输出 → 训练张量 |
| **Training IO Validation** | — | `probe_feature_shard accept` — **不是** Runtime Validation；**不是** Dataset Probe |
| **Feature Shard Acceptance** | 1 | `test_phase7b1_training_io` · `test_phase7b2_canonical_feature_shard` |

---

## 3. 禁止术语（Banned）

以下术语在 **Tone V2 现行文档与 Runbook** 中 **禁止** 作为验收类型使用（含变体大小写）：

| 禁止 | 替换指引 |
|------|----------|
| Smoke · Smoke Test · Smoke Result · Smoke CLI | 按层级改用 Level 1–4 正名 |
| Offline Smoke · Deployment Smoke | **Runtime Validation**（Level 3）或删除 |
| Shadow · Shadow Runtime | **Historical Issue**（已关闭路线） |
| Offline Runtime | **Historical Issue** |
| Second Pipeline · Dual Pipeline · 第二 Pipeline · 双链路 | **Historical Issue** — 现行仅单 Runtime 主链 |
| Streaming Feature · Streaming Training · 流式特征 · 流式训练 | **禁止** — 使用 **Sequential Feature Reader** · **Mini-batch Reader** |
| A/B · A/B 并行 | **Historical Issue** — 现行禁止并行模型路径 |
| Registry · Switching · Hot Reload | **Historical Issue** — 现行 Single Service / Single Model |

**语料文件名**（如 `restore-dialog200-smoke.py`）可保留 **文件名**，正文须注明其为历史脚本名，**不是**验收层级名称。

---

## 4. Historical Issue（历史路线标注）

引用已废弃的 Registry / Shadow / 双链路等路线时，**必须**使用：

```markdown
> **Historical Issue（已关闭）：** …  
> **现行架构不存在该能力。** 见 Phase 2 Foundation Freeze · [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)。
```

**不得**让人误认为当前代码仍支持这些能力。

---

## 5. 层级对照（易混场景）

| 场景 | 正确术语 | 错误术语 |
|------|----------|----------|
| `probe_aishell3 stats` | Dataset Statistics Probe | Dataset Probe Test |
| `unittest test_phase6e` Fixture | Fixture Test | Dataset Probe Test |
| `tone-v2-dialog200-batch.js` | Runtime Validation | Deployment Smoke（禁止） |
| `validate_artifact` 结构门 | Unit Test + Artifact 验收 | Runtime Validation |
| `offline_tone_eval` accuracy | Offline Evaluation（模型质量） | Runtime Validation |
| Freeze Report §Frozen Architecture | Architecture Verification | Smoke |
| `data_mini` 回归计数 | Unit Test / Dataset Probe（视入口） | smoke 数据集（禁止） |
| AISHELL-3 全量训练语料 | Current Canonical Training Dataset | 唯一训练数据源（禁止） |
| `data_mini` 在 CI 中的角色 | Regression Fixture | Canonical Training Dataset |
| 多语料扩展方式 | 新增 DatasetAdapter + AlignmentProvider | 修改 Dataset Foundation Framework |
| Training IO 全量验收 | Training IO Validation（`probe_feature_shard accept`） | Runtime Validation |
| 训练读特征 | Shard Reader → Sequential → Mini-batch | Streaming Feature（禁止） |
| 未来 tone 模型训练 IO | 复用 Training Engineering | 新建第二 Training IO Pipeline |

---

## 6. 文档引用义务

所有 **Tone V2 新文档** 须在首屏或「验收」章节注明所用 **Level 1–4** 术语，并链接本文。

**SSOT 索引：** [README.md](./README.md)

---

*Terminology Freeze — no Runtime / Training Pipeline code changes.*
