# Lingua Model2 — End-to-End Architecture Conformance & Drift Audit

| Field | Value |
|-------|-------|
| Date | 2026-08-16 |
| Nature | **READ-ONLY ARCHITECTURE CONFORMANCE AUDIT** |
| Markers | `E2E_CONFORMANCE_AUDIT` / `NOT_FOR_RUNTIME` / `NOT_FROZEN` / `READ_ONLY` |
| Artifacts | `training/model2/experiments/e2e_conformance_audit/` |

---

## 1. Executive Summary

原始 Model2 职责是 **FineSpan 并行、UserProfile 条件候选扩召回**。当前最大漂移不是“需要发音模型”，而是：

1. **学习主线曾滑向 closed-set ranking**（Phase 5–7C）；  
2. **Phase 7F REAL_ASR 用整句 G2P 作 query**，绕过 FineSpan，并据此宣布 `OBSERVABILITY_LIMIT`。

Span-reference（音节窗 1–5，对齐 Lattice FineSpan）对比（n=200）：

| Path | TargetIntroduction (profile new) | Recovers when 7F fails |
|------|----------------------------------:|------------------------:|
| Phase7F whole-utt | **0.00** | — |
| SPAN_REFERENCE | **0.19** | **0.775** visibility/profile |
| FAMILY_SYNTH span control | **1.00** | — |

**Phase 7F `OBSERVABILITY_LIMIT` → `TEST_PATH_INVALID`（对架构结论而言）。**  
**Separate pronunciation model: NO。 Neural retrieval: NO。**  
**Recommended action: TARGETED_RESTORE（恢复 FineSpan 检索单位与符合契约的评测）。**

---

## 2. Original Product Intent

见 `model2_original_intent_contract.md`。权威来源：2026-08-11 设计文档 §1：

> Model2 只负责在 Fine Span Sliding Window 阶段扩大候选召回。

---

## 3. Historical Drift Timeline

见 `model2_historical_drift_timeline.md`。

关键节点：Hybrid §13（Model2=池内排序）；Phase 6 binding 门；Phase 7F 整句测试污染结论。

---

## 4. Current Actual Dataflow

见 `current_model2_actual_dataflow.md`。

生产：FineSpan **存在且活跃**；Model2 **未接线**。  
实验：7E 机制正确方向；7F REAL_ASR **整句 bypass**。

---

## 5. Span Ownership (Highest Priority)

见 `span_ownership_audit.json`。

| Q | Answer |
|---|--------|
| FineSpan 生成 | Node `runLatticeFineSpanGeneration` |
| 结构 | `PathFineSpan` + `GlobalWindowDescriptor.windowText/PinyinKey` |
| 7F REAL_ASR | **整句** `asr_hypothesis` → G2P；`ARCHITECTURE_DRIFT_WHOLE_UTTERANCE_BYPASS` |

---

## 6. REAL_ASR Failure Trace

`real_asr_span_trace.jsonl`（40 条）。示例：

```text
ASR: 请记录到订单被朱李写公经
Target: 公斤  Profile: in_ing
7F: 对 12 音节整句做 reverse → 垃圾长 query → 不引入
SPAN: window [gong, jing] → profile/base 恢复
```

痕迹统计：p7f_intro=0；span_profile_intro=10；span_base_visible=25；recover=31/40。

---

## 7–8. Reference vs Current

`span_reference_vs_phase7f.json`：

```text
TEST_PATH_INVALID_OR_DRIFT — span reference recovers where whole-utt fails
```

整句路径把 relation 作用在**全句**，破坏长度匹配与局部残差；FineSpan 窗口恢复正确粒度。

---

## 9–10. UserProfile / Mapping

| Field | Status |
|-------|--------|
| phonetic_bias | PARTIAL（BOUND-only spike） |
| domain / personal_terms / speaking habit | NOT_IMPLEMENTED in retrieval |
| BOUND-only | `SPIKE_ONLY_LIMIT` |

---

## 11–14. Query / Pronunciation / FuzzyPool / Expansion

- Shadow path: whole-utt 7F（`SHADOW_RETRIEVAL_PATH`）  
- Pronunciation model：**不因整句失败而需要** → **NO**  
- FuzzyPool：**KEEP**（单一检索原语）  
- Profile Retrieval：**访问全词库** — KEEP；必须绑 FineSpan

---

## 15–18. Stage A/B / Relation / Domain

| Component | Action |
|-----------|--------|
| Stage A | ARCHIVE narrative; KEEP_OPTIONAL post-merge |
| Stage B | KEEP_POST_RECALL |
| CandidateRelation | KEEP |
| Domain/habits | DEFER but track in product contract |

---

## 19–21. Training / Metrics / Datasets

- 旧 “Recall@K” = **METRIC_NAMING_DRIFT**  
- 7F whole-utt dataset：**DIAGNOSTIC_ONLY / invalid for architecture verdict**  
- Core metrics 必须回到 TargetIntroduction* on **FineSpan**

---

## 22–24. Drift Inventory & Complexity

见 `architecture_drift_inventory.csv`、`complexity_addition_audit.json`、`cleanup_scope.csv`。

Critical：input granularity；whole-utt G2P verdict；dataset contamination。

---

## 25. Minimal Target Architecture

```text
ASR → FineSpan (1..5 syl windows)
        ├─ Base FuzzyPool / Exact
        └─ UserProfile expansion → lexicon (same FuzzyPool primitive)
             → merge/dedup by term_id
             → optional Stage B binding
             → existing sentence assembly
```

Single authoritative path. No whole-utt Model2. No second ASR. No default pronunciation model.

---

## 26–27. Decisions

| Question | Verdict |
|----------|---------|
| Separate pronunciation model? | **NO** |
| Neural retrieval? | **NO** |
| Phase7F OBSERVABILITY_LIMIT? | **TEST_PATH_INVALID** |

残留 observability（span 上仍有失败）可另测，但不得沿用整句结论。

---

## 28–29. Cleanup (plan only) & Governance

本轮不改正式代码。计划：删除整句架构结论；恢复 FineSpan 评测；归档 Stage A recall 叙事。

治理：Product Freeze；ACP；主指标=span introduction；测试捷径≠架构；每阶段 Conformance Check。

---

## Final Verdict

```text
Audit Verdict:
PASS

Original Model2 Responsibility:
FineSpan-parallel UserProfile-conditioned candidate recall expansion (not final decision).

Current Model2 Responsibility:
Offline: deterministic profile retrieval spike (partial) + legacy closed-set Stage A/B artifacts;
Production: unwired; Phase7F invalid whole-utt test path polluted observability verdict.

Overall Architecture Conformance:
MAJOR_DRIFT

Critical Drift Count:
3

High Drift Count:
4

FineSpan Is Authoritative Retrieval Unit:
PARTIAL

Whole-Utterance Retrieval Exists:
YES

Whole-Utterance Retrieval Verdict:
TEST_ONLY / DRIFT

Profile-Conditioned Candidate Introduction:
PARTIAL

UserProfile Pronunciation Usage:
PARTIAL

UserProfile Speaking-Habit Usage:
NOT_IMPLEMENTED

UserProfile Domain Usage:
NOT_IMPLEMENTED

FuzzyPool:
KEEP

Stage A:
ARCHIVE / KEEP_OPTIONAL

Stage B:
KEEP_POST_RECALL

CandidateRelation:
KEEP

Phase 7F OBSERVABILITY_LIMIT:
TEST_PATH_INVALID

Separate Pronunciation Model Required:
NO

Neural Retrieval Required:
NO

Recommended Architecture Action:
TARGETED_RESTORE

Required Deletes:
Whole-utt REAL_ASR as architecture verdict; Stage A “Model2 recall” naming; pronunciation-model default proposal from 7F

Required Restores:
FineSpan as Model2 retrieval unit; span-conforming realistic eval; introduction metrics as primary

Required Modifications:
BOUND-only mark SPIKE or evidence-based expand; track domain/habits in contract

Frozen Components:
UserProfile schema; FuzzyPool primitive; relation direction contract; 7E retrieval mechanism; merge by term_id

Next Recommended Phase:
Phase 7G — FineSpan-Conforming Realistic Eval & Contract Restore
(HOLD Tone / Node / 50k / neural retrieval / pronunciation model)
```
