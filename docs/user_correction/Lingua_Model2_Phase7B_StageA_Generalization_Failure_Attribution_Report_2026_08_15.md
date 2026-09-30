# Lingua Model2 Phase 7B — Stage A Generalization Failure Attribution Report

| Field | Value |
|-------|-------|
| Date | 2026-08-15 |
| Nature | **Stage A Generalization Failure Attribution**（诊断轮；非修复轮） |
| Baseline | Phase 7A Baseline V1 artifacts |
| Experiment | `training/model2/experiments/phase7b_stage_a_attribution_v1/` |
| Script | `training/model2/scripts/run_phase7b_attribution.py` |
| Markers | `PHASE7B_DIAGNOSTIC` / `NOT_FOR_RUNTIME` / `NOT_FROZEN` |
| Verdict | **PASS — attribution complete** |

---

## Final Verdict Block

```text
Phase 7B Verdict:
PASS

Baseline Reproduction:
PASS

Stage A Generalization Failure:
CONFIRMED

Primary Root Cause:
Implicit term / candidate lexical memorization (REPRESENTATION)
— SEEN performance depends on candidate-side / train-term geometry;
  UNSEEN loses that geometry and does not fall back to transferable
  syllable-identity matching.

Secondary Root Cause(s):
1. Loss / training-dynamics misalignment (OVERTRAINING_COMPONENT)
2. Dataset query-channel artifact (oracle span_syllables + conflicting ASR chars)
3. Lexical embedding geometry biased away from phonetic NN structure

Stage A Architecture:
MODIFY_NEXT_PHASE

Stage B Binding Architecture:
KEEP

Dataset:
MODIFY_NEXT_PHASE  (query-channel contract; not full rebuild required for attribution)

Tone:
HOLD

Node:
HOLD

50k Scale:
HOLD

Recommended Next Phase:
Phase 7C — controlled Stage A causal probes
(phonetic-inductive bias / query-channel repair / hard negatives /
 early-stop policy). Do NOT silently replace 7A baseline.
```

---

## 1. Executive Summary

Phase 7A 的 SEEN→UNSEEN 断崖被复现并归因：

| Slice | R@1 | R@3 |
|-------|----:|----:|
| SEEN_TERM (Stage A) | **0.728** | **0.945** |
| UNSEEN_TERM (Stage A) | **0.044** | **0.098** |
| UNSEEN FuzzyDistance / Phonetic | **0.979** | **1.000** |
| UNSEEN Random | ≈0.065 | ≈0.190 |

**Case A：** term-independent deterministic ranker 在 UNSEEN 上明显超过 Stage A → Stage A 是 representation/objective 失败，而非“任务无解”。

**机制（受控证据）：**

1. SEEN 上 **null_query R@1≈0.480**、**candidate-only R@1≈0.457** → `TERM_SPECIFIC_SHORTCUT_RISK`
2. UNSEEN 上 null/shuffle query ≈ random → shortcut 不迁移
3. `span_syllables` **100%** 等于 target pinyin，而 `span_text` **0%** 等于 surface → 查询通道冲突；模型在 SEEN 上可走记忆捷径，在 UNSEEN 上既丢记忆，也未利用可迁移的音节同一匹配
4. val_loss 在 epoch 1 最佳后持续恶化 → `OVERTRAINING_COMPONENT`

Stage B binding **KEEP**。禁止用 Tone / Node / 50k / 更大模型掩盖。

---

## 2. Baseline Reproduction

对比 `stage_a_baseline_v1/metrics.json` 与 `stage_b_baseline_v1/go_summary.json`：

| Metric | Expected (7A) | Got | Match |
|--------|---------------|-----|-------|
| SEEN R@1 | 0.72839 | 0.72839 | ✓ |
| SEEN R@3 | 0.94492 | 0.94492 | ✓ |
| UNSEEN R@1 | 0.04352 | 0.04352 | ✓ |
| UNSEEN R@3 | 0.09792 | 0.09792 | ✓ |
| FuzzyPool@16 ceiling | 1.0 | 1.0 | ✓ |
| Stage B ConditionGain@3 | 0.24593 | 0.24593 | ✓ |
| Stage B TargetRankΔ | 4.533 | 4.533 | ✓ |

→ `phase7b_baseline_reproduction.json`：**PASS**

---

## 3. Split Integrity

| Check | Value |
|-------|------:|
| train/val/test term counts | 1725 / 512 / 286 |
| train/val/test user counts | 401 / 123 / 65 |
| term_id overlap train↔val/test | **0 / 0** |
| user overlap | **0 / 0** |
| surface overlap | **0 / 0** |
| pinyin-key overlap train↔val/test | 17 / 5 |
| syllable-seq overlap | 17 / 5 |
| carrier overlap | 110 / 110（模板全集共享） |
| pool-signature overlap | 13 / 10 |

`term_family_holdout`：exact unseen R@1≈0.044；family-unseen≈0.045 → **不是**“近邻 pinyin sibling 泄漏”主因。

---

## 4. Slice Ambiguity（7A unseen_user ≡ unseen_term）

| Slice | n | Availability |
|-------|--:|--------------|
| SEEN_USER (eval) | 0 | **NOT_AVAILABLE_BY_CURRENT_SPLIT** |
| SEEN_TERM_UNSEEN_USER | 0 | **NOT_AVAILABLE_BY_CURRENT_SPLIT** |
| UNSEEN_TERM_SEEN_USER | 0 | **NOT_AVAILABLE_BY_CURRENT_SPLIT** |
| UNSEEN_USER | 1011 | AVAILABLE |
| UNSEEN_TERM | 1011 | AVAILABLE |
| UNSEEN_TERM_UNSEEN_USER | 1011 | AVAILABLE |

Stage B `unseen_user_metrics` 与 `unseen_term_metrics`：**exact_same_rows=true，jaccard=1**。

**原因（非 exporter bug）：** user-disjoint ⇒ eval 用户全 unseen；term-prefer ⇒ train∩eval `target_term_id` 为空 ⇒ 两 mask 退化成同一集合。

---

## 5. Combo Slice Export

`unseen_combo_metrics.json={}` 的原因：

- plan 登记了 48 个 holdout family sets
- trainrow 上 `unseen_feature_combo=True` 的行数 = **0**
- exporter 对空切片写空对象

→ **DEFER_INSUFFICIENT_DATA**（不是 PASS）。见 `combo_slice_audit.json`。

---

## 6. Deterministic Baselines（核心实验）

统一 SEEN / UNSEEN：

| Method | SEEN R@1 | UNSEEN R@1 | SEEN R@3 | UNSEEN R@3 |
|--------|---------:|-----------:|---------:|-----------:|
| Random | 0.063 | 0.065 | 0.191 | 0.190 |
| FuzzyDistance | 0.964 | **0.979** | 1.000 | **1.000** |
| Phonetic (syl edit) | 0.964 | **0.979** | 1.000 | **1.000** |
| MinimalLinear (7 params) | 0.960 | **0.979** | 1.000 | **1.000** |
| **Stage A** | **0.728** | **0.044** | 0.945 | 0.098 |

**Case A confirmed。**

**必须同时读的数据契约：**

| Fact | Rate |
|------|-----:|
| `span_syllables == target pinyin` | **1.0** |
| `span_text == target surface` | **0.0** |
| `positive_pool_index == 0` | **0.974** |
| positive fuzzy distance == 0 | **1.0** |

因此 Fuzzy/Phonetic 基线接近 **oracle syllable-identity**，不能宣传为“纯 ASR 音系能力”。  
但 Case A 仍成立：存在可迁移的 term-independent 规则；Stage A **没有学会它**，反而在 SEEN 上用可记忆捷径，且 **SEEN R@1 低于 FuzzyDistance（0.728 < 0.964）**——训练甚至破坏了本可用的池内距离信号。

---

## 7. Query / Candidate Ablations

### SEEN（n=512）

| Condition | R@1 | R@3 |
|-----------|----:|----:|
| Normal | 0.732 | 0.938 |
| Shuffle query | 0.412 | 0.654 |
| Null query | **0.480** | 0.754 |

破坏 query 后 SEEN 仍远高于 random → **candidate/term shortcut**。

### UNSEEN（n=512）

| Condition | R@1 |
|-----------|----:|
| Normal | 0.041 |
| Shuffle / Null | ≈0.037–0.039 |

### Candidate-only / Query-only（SEEN n=256）

| Mode | R@1 |
|------|----:|
| Full | 0.695 |
| Candidate-only (mean query) | **0.457** → `TERM_SPECIFIC_SHORTCUT_RISK` |
| Query-only (mean cands) | 0.824（受 pool 位置偏置影响，解释力有限） |

Candidate shuffle（槽位置换但标签跟随）：ΔR1≈0 → 模型依赖的是候选张量内容而非固定槽位索引本身。

---

## 8. Embedding / Negatives / Hardness / Relation

- Candidate NN：`geometry_hint=lexical`（样本上 phonetic_close_rate≈0）
- Easy-negative：**NOT_SUPPORTED**（train/unseen neg fuzzy distance 未显示“训练集明显更容易”）
- Relation gaps：BOUND-7 全面断崖（gap_R1_mean≈0.66，std≈0.06）→ **global**，非单 relation
- LORO 全量重训：**DEFER_COMPUTE**（用 per-relation gap 替代）
- Carrier：110 templates 跨 split 全共享；`unseen_carrier_*` 交叉不完整 → carrier shortcut **NOT_SUPPORTED / limited**
- Family holdout 与 exact unseen 几乎同差 → sibling leakage **非主因**

---

## 9. Training Dynamics / Objective

- best val_loss：**epoch 1**（2.561）
- final epoch 20 val_loss：**2.697**（更差）
- 中间 checkpoint 未保存 → 无法直接测 early UNSEEN R@1  
→ 标记 **OVERTRAINING_COMPONENT**（只诊断，不把 early-stop 当正式修复）

Objective：pool CE 允许通过记住 SEEN 候选/查询共现降低 loss，**不强制**跨 term 的音节同一匹配。

---

## 10. NO_MATCH_FP

复现 **0.287**（969/3371）。分类器将 FP 主要标为 phonetically_similar（与 ASR span 残缺/错字 + oracle syl 并存一致）。  
与 generalization failure **同源倾向**：query↔candidate 耦合弱时，质量流向 NO_MATCH。

---

## 11. Failure Cases

导出 100 条 UNSEEN 失败：`failure_cases_unseen.jsonl`  
本批优先桶：**stageA_bad_phonetic_ok = 100/100**（与 Case A 一致）。

---

## 12. Attribution Matrix

| Hypothesis | Verdict | Confidence |
|------------|---------|------------|
| Term memorization (implicit) | **PRIMARY** | HIGH |
| Lexical embedding shortcut | SECONDARY | MEDIUM |
| Loss misalignment / overtraining | SECONDARY | MEDIUM |
| Dataset query-channel artifact (oracle syl + ASR char) | SECONDARY | HIGH |
| Distribution shift | SUPPORTED | MEDIUM |
| Easy-negative shortcut | NOT_SUPPORTED | LOW |
| Relation memorization | NOT_SUPPORTED | MEDIUM |
| Carrier shortcut | NOT_SUPPORTED | MEDIUM |
| Dataset ambiguity / insufficient ranking signal | NOT_SUPPORTED | MEDIUM |

**Category primary：REPRESENTATION**（次要 OBJECTIVE + DATA channel contract）

---

## 13. Root Cause Decision

```text
PRIMARY ROOT CAUSE:
Implicit term/candidate lexical memorization in Stage A encoders
(REPRESENTATION). SEEN ranking leans on candidate-side geometry /
train-term patterns; UNSEEN loses it. Model fails to use the
transferable syllable-identity rule that deterministic baselines use.

SECONDARY ROOT CAUSES:
1. OBJECTIVE / overtraining (val_loss best at epoch 1, then degrades)
2. DATA query-channel artifact: oracle span_syllables vs conflicting ASR chars
3. Lexical-biased candidate embedding geometry

NOT SUPPORTED:
Easy-negative shortcut; relation-specific memorization; carrier shortcut;
“task has no discriminative evidence” (Case A refutes)

INCONCLUSIVE:
Full leave-one-relation-out retrain (deferred on compute);
complete unseen-carrier × seen-term factorial (join limits)
```

**回答主问题：**  
Stage A 的 0.728→0.044 断层，**主要不是** split 泄漏或任务无解，而是 **REPRESENTATION（+OBJECTIVE）失败**：在可解的 syllable-identity 信号面前，模型学会了 SEEN 专用捷径且无法迁移。

---

## 14. Do Not Fix（本轮遵守）

- 未替换 Stage A/B baseline
- 未改主架构 / Tone / Node / 50k
- 仅新增 diagnostic script + artifacts
- Stage B binding：**KEEP**

### Phase 7C 候选（仅提案）

1. **Query-channel repair：** ASR-derived syllables vs 明确标记的 canonical prior；禁止静默 oracle  
2. **Phonetic inductive bias / auxiliary loss：** 强制 query-syl ↔ cand-syl 匹配  
3. **Hard-negative / anti-memorization：** 打乱 SEEN 捷径  
4. **Early-stop / val-unseen monitoring：** 验证 OVERTRAINING 因果  
5. 每个干预 = `CAUSAL_PROBE_ONLY`，独立目录，不替换 7A

---

## 15. Architecture Drift Audit

| Action | Item |
|--------|------|
| KEEP | Stage A/B prod architecture, FuzzyPool, 7A checkpoints, Stage B binding |
| ADD | `scripts/run_phase7b_attribution.py`, `diagnostics/`, `experiments/phase7b_*` |
| MODIFY | （无生产路径修改） |
| DELETE | （无） |
| DEFER | LORO full retrain; Tone; Node; 50k |

无 shadow path / runtime bypass。

---

## 16. Required Artifacts Checklist

- [x] phase7b_baseline_reproduction.json  
- [x] split_integrity_audit.json  
- [x] slice_identity_audit.json  
- [x] combo_slice_audit.json  
- [x] deterministic_baselines.json  
- [x] stage_a_seen_unseen_metrics.json  
- [x] candidate_embedding_audit.json  
- [x] candidate_shuffle_probe.json  
- [x] query_ablation_probe.json  
- [x] query_candidate_diagnostic.json  
- [x] negative_distribution_audit.json  
- [x] hardness_metrics.json  
- [x] relation_generalization.json  
- [x] leave_one_relation_out.json（DEFER_COMPUTE）  
- [x] term_family_holdout.json  
- [x] carrier_generalization.json  
- [x] training_dynamics.json  
- [x] objective_alignment_audit.json  
- [x] no_match_fp_analysis.json  
- [x] dataset_query_channel_audit.json  
- [x] failure_cases_unseen.jsonl  
- [x] attribution_matrix.json  
- [x] go_summary.json  

---

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| Baseline reproduction | PASS |
| Split/leakage audit | PASS |
| unseen_user/term ambiguity explained | PASS |
| Combo export explained | PASS（DEFER_INSUFFICIENT_DATA） |
| Deterministic vs Stage A comparison | PASS（Case A） |
| Representation / query ablations | PASS |
| Negative / relation / dynamics | PASS |
| Failure cases exported | PASS |
| Attribution matrix + PRIMARY with direct evidence | PASS |
| No runtime architecture drift | PASS |

---

## Verdict

**Phase 7B PASS。**  
Stage A generalization failure **CONFIRMED** and **attributed**：primary = implicit term/candidate memorization（REPRESENTATION）；secondary = objective/overtraining + oracle-syllable/ASR-char channel artifact。

**Next：** Phase 7C causal probes only — still **HOLD** Tone / Node / 50k.
