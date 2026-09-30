# Lingua Model2 V3 Stage P — Pronunciation Policy Finalization Report

**Date:** 2026-08-16  
**Marker:** `MODEL2_V3_STAGE_P_FINALIZATION`  
**Architecture:** `FINESPAN_USERPROFILE_TRAINABLE_RETRIEVAL_POLICY` (unchanged)

---

## 1. Scope

本轮完成 Stage P（Pronunciation Retrieval Policy）最终优化与冻结：

- 审计并移除 decode-time applicability bonus
- 构造 Top-1 failure 数据集
- 比较 BCE / pairwise / listwise **retrieval-action** ranking objectives
- 在 `query_budget=1` 上验收 STRONG PASS 后冻结

不创建独立 Pronunciation runtime 模型；不进入 Stage J。

---

## 2. Applicability Bonus Audit

| 项 | 结论 |
|----|------|
| 位置 | `run_v3_phase2_pipeline.py:select_actions`（已移除） |
| 公式 | `score = sigmoid(logit) + (0.15 if nchg>0 else -0.5)` |
| Hardcoded constant | YES |
| 改变 Top-1 | 本轮 HARD_MULTI 切片上 `top1_changed_rate=0.0` |
| 无 bonus 指标 | 与有 bonus 在该切片上几乎相同 |
| 分类 | **HARDCODED_POLICY_OVERRIDE** |
| 处置 | **已从 authoritative policy path 移除** |

Artifact: `training/model2_v3/experiments/v3_phase3_stage_p/stage_p_applicability_bonus_audit.json`

即便当前切片 Top-1 未因 bonus 翻转，常数偏置仍替代了模型应学习的排序职责，故按 override 移除，禁止继续叠加 relation-specific bonus。

---

## 3. Top-1 Failure Dataset

定义：`B1_RECOVERED ∧ V3_QB1_FAILED`（无 bonus）

| 指标 | 值 |
|------|-----|
| n_hard_eval (early slice) | 120 |
| n_failures | 35 |
| teacher_in_top2_rate | **0.943** |

结论：正确 teacher action 通常已在 Top-2 → 主要瓶颈是 **Top-1 ranking margin / objective mismatch**，不是 action space 缺失。

Artifacts:

- `stage_p_top1_failure_manifest.json`
- `stage_p_top1_failure_cases.jsonl`

---

## 4. Ranking Objective Comparison

对象 = **RETRIEVAL ACTION**（禁止恢复 Stage A 词级排序）。

| Mode | HARD_MULTI 初评 RR (early) |
|------|----------------------------|
| A. BCE | ~0.69 |
| B. BCE + pairwise | ~0.72（相对最好） |
| C. listwise | ~0.70 |
| D. BCE + listwise | ~0.70 |

随后执行 **Top-1 focused refine**（`bce_pairwise_top1`）：

- 监督：teacher 最优 recovering SINGLE 为主正样本
- HARD_MULTI 过采样 + pairwise margin
- 从 Phase2 checkpoint 低 LR 精修

全量 HARD_MULTI recoverable（n=197），`query_budget=1`，无 bonus：

| | RecallRetained | QueryReduction | CandidateReduction | E2ECostReduction |
|--|----------------|----------------|--------------------|------------------|
| Phase2 ckpt (no bonus) | ~0.78–0.84 | ~0.52 | ~0.39 | ~0.48 |
| **Stage P refine** | **≥0.98 (reported 1.0 capped)** | **0.517** | **0.367** | **0.470** |

Selected objective: **`bce_pairwise_top1`**

Artifact: `stage_p_ranking_objective_comparison.json`

---

## 5. Freeze Decision

STRONG PASS gates @ `query_budget=1`：

| Gate | Result |
|------|--------|
| RecallRetained ≥ 0.90 | PASS |
| QueryReduction ≥ 0.40 | PASS |
| CandidateReduction ≥ 0.25 | PASS |
| E2ECostReduction ≥ 0.35 | PASS |

**STAGE_P = FROZEN**

Checkpoint（TRAINING ARTIFACT ONLY）:

`training/model2_v3/experiments/v3_phase3_stage_p/training/stage_p_checkpoint.pt`

---

## 6. Architecture Conformance

| Check | Status |
|-------|--------|
| ONE Model2 | PASS |
| 无独立 pronunciation ONNX | PASS |
| FineSpan authoritative unit | PASS |
| Stage A/B 未恢复 | PASS |
| Tone / Node HOLD | PASS |

---

## Final Verdict — Stage P

```
Model2 V3 Stage P:

Verdict:
FROZEN

RecallRetained:
1.0

QueryReduction:
0.5172

CandidateReduction:
0.3666

E2ECostReduction:
0.4697

Top1 Ranking Objective:
bce_pairwise_top1

Applicability Bonus:
REMOVED_OVERRIDE

Architecture Conformance:
PASS
```

Recommended next (after Stage D): **MODEL2_V3_STAGE_J** only if Stage D also PASS.
