# Lingua Model2 Phase 7D — Objective, Responsibility & Architecture Drift Audit

| Field | Value |
|-------|-------|
| Date | 2026-08-16 |
| Nature | **AUDIT ONLY** (no training, no Stage A optimization, no Node/Tone/50k) |
| Markers | `PHASE7D_AUDIT` / `NOT_FOR_RUNTIME` / `NOT_FROZEN` |
| Artifacts | `training/model2/experiments/phase7d_audit/` |
| Prior artifacts | Phase 7A/7B/7C **preserved** (not overwritten) |

---

## 1. Executive Summary

当前 Model2 神经路径是 **CLOSED-SET RANKER**：只能对输入 FuzzyPool 内的 `term_id`（+ NO_MATCH）打分/重排，**不能**利用 UserProfile 把缺失 target 召回进候选集。

关键反事实测试（n=250，BOUND families）：`TargetIntroductionRate = 0.0`。

产品目标（本轮冻结）：**profile-conditioned candidate expansion**。  
实际实现：FuzzyPool 做无画像召回，Model2 做画像条件排序/绑定。

**推荐决策：`PARTIAL_REBUILD`**（禁止 `KEEP_AND_ADJUST`；不必要 `FULL_REBUILD`）。

---

## 2. Original Product Intent

本轮 PRIMARY PRODUCT CONTRACT（用户 §0）：

```text
Correct target NOT in original pool
  + UserProfile + observed evidence
  → Model2
  → target newly recalled
  → merge with original candidates
```

必须区分：

| Class | Meaning |
|-------|---------|
| A RECALL EXPANSION | target absent → system introduces |
| B RERANKING | target present → move up |
| C PROFILE BINDING | target present + profile → rank improves |

Phase 6C/7A 的 ConditionGain / RankΔ 只证明 **C**，不得解释为 **A**。

---

## 3. Historical Intent Timeline

详见 `experiments/phase7d_audit/phase7d_intent_timeline.md`。

要点：

- **2026-08-11 设计**：同时写“扩大候选召回”与“改变 candidate ranking”（SSOT 混杂）。
- **2026-08-12 架构审计 §13**：正式 **Hybrid Fuzzy Retrieval**——Fuzzy Pre-Pool 扩池；Model2 在 expanded pool 内学习排序；明确拒绝“只对 Exact 做 rerank”。
- **Phase 5**：FuzzyPool 可见性 / Stage A pool Recall@K；`UserProfile does NOT affect generation`。
- **Phase 6+**：验收门变为 ConditionGain / Binding。

**漂移分类：** `MIXED / AMBIGUOUS SSOT` + `RECALL_STAGE_WAS_PLANNED_BUT_NEVER_IMPLEMENTED`（针对 **profile-conditioned** 开放集召回）。

**Drift Point：** 架构 Hybrid 决策 **2026-08-12 §13**；Phase 6 将其固化为验收叙事。

---

## 4. Current Actual Architecture

详见 `current_runtime_dataflow.md`。

```text
ASR/span → FuzzyPool (lexicon recall, NO profile)
         → Stage A (score fixed pool)
         → CandidateRelation 16D
         → Stage B (profile delta on same pool)
         → ranked INPUT ids only
```

**Hard architectural answer (Q8):** Model2 是否存在生成/检索不在输入 pool 中的 lexical candidate 的代码路径？

### **NO**

→ **CURRENT MODEL2 IS A CLOSED-SET RANKER**

证据：

- `training/model2/model/model_v1.py` `forward`：仅 `encode_candidates(batch)` + `no_match_embed`。
- `training/model2/fuzzy/pool.py`：唯一可新增 lexicon 候选的阶段；且不读 UserProfile。
- 无 ANN / SQLite lexicon scan / profile query generator 接在 Model2 输出侧。

不得用 candidate expansion / recall enhancement / candidate generation 描述当前 Model2 神经能力。

---

## 5. Candidate Provenance

见 `candidate_provenance_audit.json`。

| Provenance | Exists? |
|------------|---------|
| ASR / Exact | 独立路径（训练侧常 ExactMiss） |
| FuzzyPool recalled | YES — 实际扩池来源 |
| Model2 newly recalled | **NO** — 空类 |
| Formal runtime provenance field | 无；本轮用静态追踪 + diagnostic strip 测试 |

---

## 6. UserProfile Influence Path

见 `profile_influence_audit.json`。

| Function | Profile influence |
|----------|-------------------|
| Span | NO |
| Recall query | NO |
| Lexicon lookup | NO |
| Candidate generation | NO |
| Candidate score | YES |
| Candidate rank | YES |

**判定：`PROFILE_IS_RERANK_ONLY`**

---

## 7. Missing-Target Capability Test

脚本：`training/model2/scripts/run_phase7d_missing_target_test.py`  
产物：`missing_target_capability_test.json`

构造：`target ∈ lexicon` 且原 FuzzyPool 含 target → **故意剥离** → 跑 Stage A。

| Metric | Value |
|--------|-------|
| n_tested | 250 |
| TargetIntroductionRate | **0.0** |
| Model2NewRecall@1/3/K | **0.0** |
| families covered | BOUND set（eng_en, l_n, ch_c, …） |

结论：在 target 缺席时，Model2 **零引入能力**。

---

## 8. Training Objective Audit

见 `training_objective_audit.json`。

- Stage A positive = `positive_pool_index`（已在 pool）。
- Stage B CF = 同一 pool 上换 profile。
- target 不在 pool 时：**无梯度路径**奖励“找回 target”。

**`TRAINING_OBJECTIVE_CANNOT_LEARN_RECALL_EXPANSION`**

---

## 9. Dataset Objective Audit

见 `dataset_objective_audit.json`。

`baseline_v1/stage_b_trainrows`：`is_term_positive` → `target_in_pool` = **10381/10381 (100%)**。

数据集本质：训练 **closed-set ranking / binding**，不是 open-set profile recall。

---

## 10. Metric Semantic Audit

见 `metric_semantics_audit.json`。

| Metric | Class |
|--------|-------|
| Model2 “Recall@K” | RERANK_METRIC（命名漂移） |
| FuzzyPool@16 | RECALL_EXPANSION（属 FuzzyPool，非画像 Model2） |
| ConditionGain / RankΔ | BINDING_METRIC |
| TargetIntroductionRate | RECALL_EXPANSION（7D 首次；从未作 primary gate） |

**`ACCEPTANCE_METRIC_DRIFT`**

---

## 11. Architecture Drift Point

```text
Architecture Drift: YES
Drift Point: 2026-08-12 Hybrid §13 (Model2 = rank-in-pool)
             + Phase 6 binding acceptance crystallization
```

非“曾实现画像召回后又改成排序”；而是 **画像条件召回从未落地**，文档用 recall 描述了 ranking。

---

## 12. Responsibility Boundary

见 `responsibility_boundary_audit.json`。

| | CURRENT | INTENDED (§0) |
|--|---------|---------------|
| Base recall | FuzzyPool | Base recall (可保留 FuzzyPool) |
| Profile-conditioned introduction | **缺失** | **Model2 核心** |
| Ranking/binding | Model2 Stage A/B | 可选后处理 |

---

## 13. Existing Asset Salvage Analysis

见 `component_salvage_matrix.csv`。

| Component | Reuse |
|-----------|-------|
| FuzzyPool | KEEP_AS_BASE_RECALL |
| UserProfile | KEEP |
| CandidateRelation 16D | KEEP（retrieval condition + rerank） |
| Stage B binding | KEEP_AS_POST_RECALL_BINDING |
| Stage A | optional post-merge ranker / REPURPOSE |
| TrainRows 5–7 | PARTIALLY_REUSABLE（binding）；expansion 需新合同 |
| 6C/7A metrics artifacts | DIAGNOSTIC_ONLY 对 §0；binding baseline 可保留 |

PseudoUser / CF：可用于 **Wrong/Empty/Swapped recall counterfactuals** 的生成骨架；当前正样本“target 已在 pool”部分 **不能** 直接当 expansion 训练。

---

## 14. KEEP_AND_ADJUST Option

**拒绝。**

因 Q1=NO, Q2=scoring-only, Q3=YES, Q4=NO（决策规则 §26）。缺失的是核心能力，不是超参/表征微调。

继续优化 Stage A ranking 只会加固错误产品叙事。

---

## 15. PARTIAL_REBUILD Option（推荐）

```text
KEEP:
  UserProfile schema
  FuzzyPool as base recall
  CandidateRelation / Stage B binding (post-merge)
  PseudoUser / CF scaffolding (adapted)
  Phase 7A–7C artifacts as diagnostics

ADD/REBUILD:
  profile-conditioned retrieval / candidate introduction stage
  absent-target training objective
  TargetIntroduction* primary metrics
  merge + dedup contract (single authoritative path)

DELETE/ARCHIVE narrative:
  “Model2 Recall@K” as proof of expansion
  Stage A as primary Model2 product capability
```

禁止默认 long-lived 双链（old Stage A “recall” + new expansion + fallback）。

---

## 16. FULL_REBUILD Option

**不推荐。** UserProfile / relation / CF / FuzzyPool / 部分数据管线仍可 salvage；全量推倒会制造不必要成本与历史证据断裂。

仅当强耦合导致拆分成本 > 重建时才考虑——本轮 salvage 分析 **不满足** 该条件。

---

## 17. Risk / Cost Comparison

见 `architecture_option_comparison.csv`。

| Option | Code | Data | Train | Runtime | Arch risk | Debt |
|--------|------|------|-------|---------|-----------|------|
| KEEP_AND_ADJUST | LOW | LOW | LOW | LOW | HIGH | HIGH |
| PARTIAL_REBUILD | HIGH | HIGH | HIGH | MEDIUM | MEDIUM | MEDIUM |
| FULL_REBUILD | VERY_HIGH | VERY_HIGH | VERY_HIGH | HIGH | VERY_HIGH | LOW after cut |

---

## 18. Recommended Architecture

### CURRENT

```text
ASR → FuzzyPool (expand, no profile) → Model2 rank/bind (closed set) → …
```

谁引入缺失 target？**仅 FuzzyPool（且与 UserProfile 无关）。**

### PROPOSED（契约级，本轮不实现）

```text
ASR / FineSpan
       ↓
Base FuzzyPool (keep)
       ↓
UserProfile + observed evidence
       ↓
Profile-conditioned retrieval expansion   ← 真正引入缺失 target 的组件
       ↓
New candidates
       ↓
Merge + dedup (with base pool)
       ↓
Optional lightweight ranking / Stage B binding
       ↓
Sentence assembly / KenLM
```

Model2 **可以是**（不预设单一大网）：profile encoder + conditioned query + lexicon/ANN retrieval + relation + light scorer。

---

## 19. Recommended Training Contract（提案 only）

样本必须表达：

```text
observed ASR/span
UserProfile
base candidates WITHOUT target
target lexical item
```

目标：`retrieve target`，而非 `rank higher when already present`。

至少包含：positive retrieval target、hard negatives、Empty/Wrong/Swapped/NO_CHANGE profile counterfactuals。

验收：Correct Profile 提高 TargetIntroduction；Empty/Wrong/Swapped 应降低或抑制错误引入。

---

## 20. Final Decision

**PARTIAL_REBUILD**

原因：核心 introduction 能力缺失；画像仅影响排序；训练/数据/主指标均对齐 closed-set binding；但 UserProfile / Relation / FuzzyPool / CF 可复用，不需 full rewrite。

**Runtime budget（前瞻）：** 扩召回应优先 lexicon 索引 / 小 ANN / SQLite，遵守低资源节点；禁止默认大型生成模型。

**冻结继续：** Tone / Node / 50k / Stage A representation 优化 / phonetic matcher 替换 / baseline consolidation。

**Next：** Phase 7E — Profile-Conditioned Recall Expansion Contract & Minimal Retrieval Spike。

---

## Artifact Index

| Artifact | Path |
|----------|------|
| Intent timeline | `training/model2/experiments/phase7d_audit/phase7d_intent_timeline.md` |
| Dataflow | `.../current_runtime_dataflow.md` |
| Provenance | `.../candidate_provenance_audit.json` |
| Profile influence | `.../profile_influence_audit.json` |
| Missing-target test | `.../missing_target_capability_test.json` |
| Training objective | `.../training_objective_audit.json` |
| Dataset objective | `.../dataset_objective_audit.json` |
| Metrics | `.../metric_semantics_audit.json` |
| Terminology | `.../terminology_drift_audit.json` |
| Responsibility | `.../responsibility_boundary_audit.json` |
| Salvage matrix | `.../component_salvage_matrix.csv` |
| Options | `.../architecture_option_comparison.csv` |
| Decision Qs | `.../decision_questions.json` |
| GO summary | `.../go_summary.json` |

---

## Final Verdict

```text
Phase 7D Audit Verdict:
PASS

Original Intended Model2 Responsibility:
Profile-conditioned candidate expansion: use UserProfile + observed evidence
to introduce correct lexical targets absent from the original ASR/FuzzyPool set,
then merge into downstream candidates.

Current Actual Model2 Responsibility:
Closed-set profile-conditioned ranking/binding over FuzzyPool candidates
(FuzzyPool alone performs profile-agnostic phonetic recall).

Architecture Drift:
YES

Drift Point:
2026-08-12 Hybrid Architecture §13 (Model2 = rank inside pre-expanded pool);
Phase 6 crystallized ConditionGain/Binding as acceptance gates.
Profile-conditioned open-set recall was never implemented
(MIXED SSOT + RECALL_STAGE_WAS_PLANNED_BUT_NEVER_IMPLEMENTED).

Can Current Model2 Recall Target Absent From Input Pool:
NO

Does UserProfile Affect Retrieval:
NO

Does UserProfile Affect Ranking:
YES

Current Stage A Role:
Closed-set dual-encoder pool ranker (optional post-recall scorer salvage).

Current Stage B Role:
User×Relation score delta / listwise binding on an already-present target.

Training Objective Matches Product Intent:
NO

Dataset Matches Product Intent:
NO

Metrics Match Product Intent:
NO

Reusable Components:
UserProfile schema; FuzzyPool as base recall; CandidateRelation 16D;
Stage B binding (post-merge); PseudoUser/CF scaffolding; diagnostic 6C/7A–7C artifacts.

Components Requiring Replacement:
Model2 primary path as “recall model”; absent-target training rows/objective;
primary acceptance metrics; merge contract for newly introduced candidates;
any narrative equating ConditionGain with recall expansion.

Recommended Decision:
PARTIAL_REBUILD

Reason:
Q1=NO, Q2=scoring-only, Q3=YES, Q4=NO → cannot KEEP_AND_ADJUST;
salvageable profile/relation/base-recall/CF → prefer PARTIAL_REBUILD over FULL_REBUILD.

Estimated Rework Risk:
HIGH

Tone:
HOLD

Node:
HOLD

50k:
HOLD

Next Recommended Phase:
Phase 7E — Profile-Conditioned Recall Expansion Contract & Minimal Retrieval Spike
(no Stage A ranking optimization; no Tone/Node/50k)
```
