<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_P4_Offline_Quality_Evaluation_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 Phase 4 — Offline Tone Quality Evaluation Report

**Date:** 2026-06-29  
**Type:** 离线模型质量评估（**非 Runtime 开发**）  
**Artifact:** `electron_node/services/faster_whisper_vad/tone_module/models/tone_cnn_p1.npz`  
**评估集:** 训练同源 holdout（`seed=42`, `val_ratio=0.15`, utterance 级划分）· **1,808** 音节  
**原始数据:** `tone_module/models/tone_cnn_p1_offline_eval.json`

---

## 评估边界声明

| 声明 | 内容 |
|------|------|
| **不得替代 Node E2E** | 本报告仅衡量 **离线 posterior 质量**（Accuracy / CM / 分布）；**不能**代替 dialog_200 Runtime Validation 或 Runtime 回归验收。 |
| **不进入 Runtime Decision** | `offline_tone_eval.py` 仅调用 `numpy_p0.infer_batch`；**不** import Recall / Ranking / Assembly / KenLM / Apply；结果 **不写入** Runtime 或影响在线决策。 |

---

## 1. Artifact Metadata

| 字段 | 值 |
|------|-----|
| `featureVersion` | `p0-v1` |
| `modelVersion` | `tone_cnn_p1` |
| `trainingVersion` | `2026-06-29` |
| `backend` | `numpy_p0` |
| `formatVersion` | `npz-v1` |
| `buildTime` | `2026-06-29T10:32:34Z` |
| `datasetVersion` | `CS5647Team3/data_mini` |
| **SHA256** | `8b22ba13fc9ea32f0b8138294348fb786273b11150b38a4b2193fd0966f1a194` |
| **Size** | 15,760 bytes |

---

## 2. Validation Result（`validate_artifact.py`）

```text
validation=PASS | schema=True | shape=True | loader=True | adapter=True | adapter_acc=0.7323
```

| 阶段 | 结果 |
|------|------|
| Schema Validation | **PASS** |
| Shape Validation | **PASS** |
| Loader.load(artifact) | **PASS** |
| Runtime Adapter (`infer_batch`) | **PASS** |
| **Artifact Acceptance** | **PASS** |

---

## 3. Offline Accuracy

| 指标 | 值 |
|------|-----|
| **Offline Accuracy** | **0.7323**（1,808 / 1,808 val 音节） |
| **Failure Count** | 484（26.8%） |
| **Mean Confidence** | **0.763** |
| 与训练 `val_acc` | 一致（0.732） |

---

## 4. Confusion Matrix

行 = 真实声调 · 列 = 预测声调（t1–t5）

|  | pred t1 | pred t2 | pred t3 | pred t4 | pred t5 |
|--|---------|---------|---------|---------|---------|
| **true t1** | **336** | 39 | 8 | 45 | 4 |
| **true t2** | 21 | **297** | 30 | 43 | 5 |
| **true t3** | 5 | 39 | **157** | 55 | 2 |
| **true t4** | 55 | 54 | 34 | **487** | 12 |
| **true t5** | 8 | 6 | 8 | 11 | **47** |

### Per-Class Recall

| 声调 | Support | Recall | 判定 |
|------|---------|--------|------|
| t1 | 432 | **77.8%** | 正常 |
| t2 | 396 | **75.0%** | 正常 |
| t3 | 258 | **60.9%** | **偏弱** |
| t4 | 642 | **75.9%** | 正常 |
| t5 | 80 | **58.8%** | **偏弱**（样本少） |

**主要混淆对：** t3↔t2、t3↔t4、t1↔t4、t1↔t2、t5↔t3/t4。

---

## 5. Posterior Distribution

**验证集平均 posterior（跨样本 mean）：**

| 声调 | Mean Posterior |
|------|----------------|
| t1 | 0.239 |
| t2 | 0.239 |
| t3 | 0.134 |
| t4 | **0.344** |
| t5 | 0.043 |

| 诊断项 | 值 | 说明 |
|--------|-----|------|
| `posterior_mean_max` | 0.344 | 未出现单类 >0.55 均值塌缩 |
| `posterior_mean_std` | 0.103 | 五类均有非零质量 |
| `pred_class_entropy` | 1.443 | 预测分布未塌缩到单类 |
| `single_class_pred_dominance` | 35.5% | t4 预测占比最高，未超 85% 门限 |

**结论:** **未检测到 posterior collapse**（`posterior_collapse_detected=false`）。

---

## 6. Confidence Distribution

| 区间 | 样本数 |
|------|--------|
| 0.0–0.1 | 0 |
| 0.1–0.2 | 0 |
| 0.2–0.3 | 1 |
| 0.3–0.4 | 58 |
| 0.4–0.5 | 157 |
| 0.5–0.6 | 234 |
| 0.6–0.7 | 189 |
| 0.7–0.8 | 240 |
| 0.8–0.9 | 325 |
| 0.9–1.0 | **604** |

| 统计 | 值 |
|------|-----|
| `confidence_mean` | **0.763** |
| `high_conf_rate` (≥0.75) | **58.7%** |
| `low_conf_rate` (<0.45) | **5.9%** |

分布右偏（高置信占多数），与 73% accuracy 共存 → 存在 **高置信错误**（见 Failure Cases）。

---

## 7. Failure Cases / Weak Classes

### 弱势类

- **t3** recall 60.9% — 常被误判为 t2 / t4  
- **t5** recall 58.8% — support 仅 80；轻声类样本不足

### 失败样例抽样（前 5 条）

| # | True | Pred | Confidence | 模式 |
|---|------|------|------------|------|
| 0 | t3 | t4 | 0.330 | 低置信 · t3/t4 竞争 |
| 1 | t1 | t4 | 0.530 | 边际错误 |
| 3 | t4 | t1 | **0.945** | **高置信错误** |
| 19 | t1 | t2 | **0.936** | **高置信错误** |
| 23 | t4 | t1 | **0.979** | **高置信错误** |

完整 20 条见 `tone_cnn_p1_offline_eval.json` → `failure_samples`。

---

## 8. Posterior Collapse 检查

| 检查 | 阈值 / 启发式 | 结果 |
|------|--------------|------|
| 单类预测占比 | >85% | **35.5%** · 通过 |
| 平均置信度过低 | <0.25 | **0.763** · 通过 |
| 均值 posterior 单类过高 + 低熵 | max>0.55 & entropy<0.5 | **未触发** |

**是否存在 posterior collapse：** **否**

---

## 9. 是否适合进入 Node E2E

| 维度 | 评估 |
|------|------|
| `validate_artifact` | **PASS** — 可加载、可 `infer_batch` |
| 离线准确率 | **73.2%** — 中等；**不足以单独证明** dialog 质量 |
| 结构 / 塌缩 | 无 collapse · 五类 posterior 有效 |
| **Node E2E 定位** | **适合进入 Runtime Validation**（验证 Runtime 未回归 · effective_chain · model_error） |
| **不可替代** | Node E2E **不能**被本离线报告替代；反之亦然 |

**建议:** 部署 `tone_cnn_p1.npz` 后执行 dialog_200 Runtime Validation；离线弱势类（t3/t5）作为 **模型质量改进 backlog**，不构成 Foundation / Artifact 阻塞。

---

## 10. Expected / Actual / Impact

| ID | Expected | Actual | Impact | 处置 |
|----|----------|--------|--------|------|
| VAL-01 | validate_artifact PASS | PASS | 无 | **KEEP** |
| OFF-01 | offline accuracy 报告 | 0.7323 | 质量中等 | **KEEP** 观测 |
| OFF-02 | 五类 CM + 分布 | 已输出 | 无 | **KEEP** |
| OFF-03 | 不进 Decision | 仅 infer_batch | 无 | **KEEP** |
| QUAL-01 | t3/t5 recall 合理 | 60.9% / 58.8% | 轻声/三声偏弱 | **MODIFY**（后续训练数据/类权重 · Phase 4+） |
| QUAL-02 | 高置信错误可控 | 存在 0.94+ 错分 | Recall 侧风险需 E2E 观测 | **KEEP** 监控 |

**RESTORE / DELETE:** 无

---

## 11. Final Verdict

# **CONDITIONAL PASS**

| 通过项 | 条件项 |
|--------|--------|
| `validate_artifact` **PASS** | 离线 accuracy **73.2%**（中等） |
| 离线评估链路完整 | **t3 / t5** recall 偏弱 |
| **无** posterior collapse | 存在 **高置信错误** 样例 |
| 可进入 **Node E2E** Runtime Validation | 离线结果 **不得替代** E2E |

**签署:** Offline Tone Quality Evaluation · 2026-06-29  
**工具:** `validate_artifact.py` · `offline_tone_eval.py` · `infer_batch`（`numpy_p0`）

---

## 复现命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad
# 评估逻辑已执行并写入 tone_module/models/tone_cnn_p1_offline_eval.json
python -c "from tone_module.validate_artifact import validate_artifact; print(validate_artifact(r'tone_module/models/tone_cnn_p1.npz').to_notes())"
```
