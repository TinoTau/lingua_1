<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/TONE_V2_DOCUMENTATION_STYLE_GUIDE.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 — Documentation Style Guide

**状态：** FROZEN（随 [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md)）  
**受众：** 审计报告 · Runbook · Phase 开发报告 · README 维护者

---

## 1. 必读 SSOT

| 文档 | 用途 |
|------|------|
| [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md) | **术语唯一 SSOT** — 四级验收体系 |
| [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md) | 契约与 Runtime 冻结 |
| [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md) | Dataset Foundation 冻结 |
| [TONE_V2_TRAINING_ENGINEERING_FREEZE.md](./TONE_V2_TRAINING_ENGINEERING_FREEZE.md) | Training Engineering 冻结 |
| [README.md](./README.md) | 文档索引 |

---

## 2. 验收描述规则

### 2.1 必须标明 Level

写「验收」「测试」「通过」时，标明 **Level 1–4** 或正名：

```markdown
✅ Runtime Validation（Level 3）：dialog_200 67/67 effective_chain
✅ Dataset Probe（Level 2）：join rate ≥ 95%
✅ Unit Test（Level 1）：test_loader 5/5 PASS
✅ Architecture Verification（Level 4）：无 Registry 漂移
```

### 2.2 禁止模糊用语

| 禁止 | 改用 |
|------|------|
| 「跑一下 smoke」 | 「执行 Runtime Validation」或「执行 Dataset Probe」 |
| 「E2E smoke 过了」 | 「Runtime Validation PASS」 |
| 「数据 smoke」 | 「Limited Dataset Probe」或「Fixture Test」 |

### 2.3 不得跨层暗示

- Dataset Probe **不得**写「证明 Runtime 可用」。
- Runtime Validation **不得**写「证明数据集对齐质量」—— 那是 Dataset Probe。
- Offline Evaluation **不得**写「替代 Node E2E」。

---

## 3. 报告章节命名（推荐）

| 章节 | Level | 内容 |
|------|-------|------|
| `Unit Test Result` | 1 | unittest · contract 门 |
| `Fixture Test / Dataset Probe Result` | 2 | probe · fixture · join |
| `Runtime Validation Result` | 3 | TONE_MODEL_PATH · FW · E2E |
| `Frozen Architecture Verification` | 4 | 冻结边界检查 |
| `Architecture Drift Audit` | 4 | KEEP/MODIFY/漂移表 |

**禁止章节名：** `Probe Result` · `Dataset Probe Test` · `Runtime Validation Result`

---

## 4. Historical Issue 模板

归档文档或引用废弃路线时，在段落首使用：

```markdown
> **Historical Issue（已关闭）：** 本文档曾使用「Registry / Shadow / 双链路」等表述。  
> **现行架构：** Single Service / Single Model。不存在 Registry · Switching · Shadow Runtime。  
> 术语以 [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md) 为准。
```

`archive/deprecated/` 与 `archive/audit/` 内文件 **不得**作为实现 SSOT；可保留原文但须带 archive README 说明。

---

## 5. 工具与脚本表述

| 工具 | 文档写法 |
|------|----------|
| `tone-v2-dialog200-batch.js` | Runtime Validation 工具（Level 3） |
| `probe_aishell3` | Dataset Probe CLI（Level 2） |
| `validate_artifact` | Artifact Unit Test / 验收门（Level 1，非 Runtime） |
| `offline_tone_eval` | Offline Evaluation（模型质量，非 Level 3） |
| `train_tone_cnn` | Training Pipeline（非验收层级名称） |

---

## 6. 中英文混排

- 正名优先 **英文 Level 名 + 中文释义** 首次出现：`Runtime Validation（运行时验收）`。
- 禁止新造中文「冒烟」「影子」「双链 smoke」等混搭词。

---

## 7. 修改检查清单（PR / 文档轮）

- [ ] 无 Banned 术语（§3 TERMINOLOGY）
- [ ] 验收句标明 Level 1–4
- [ ] Dataset Probe 与 Runtime Validation 未混用
- [ ] Registry/Shadow 仅 Historical Issue
- [ ] 链接 `TONE_V2_TERMINOLOGY.md`

---

*Style Guide — documentation only.*
