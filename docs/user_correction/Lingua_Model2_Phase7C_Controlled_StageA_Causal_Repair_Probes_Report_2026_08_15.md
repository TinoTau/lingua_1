# Lingua Model2 Phase 7C — Controlled Stage A Causal Repair Probes Report

| Field | Value |
|-------|-------|
| Date | 2026-08-15 |
| Nature | **CAUSAL PROBES ONLY** — 不替换 Phase 7A baseline |
| Baseline | `training/model2/experiments/stage_a_baseline_v1/` |
| Diagnosis | Phase 7B Attribution Report |
| Markers | `PHASE7C_CAUSAL_PROBE_ONLY` / `NOT_FOR_RUNTIME` / `NOT_FROZEN` / `DO_NOT_REPLACE_BASELINE` |
| Verdict | **PASS（因果方向已判定）**；**HOLD（无清洁修复可进 7D consolidation）** |

---

## Final Verdict Block

```text
Phase 7C Verdict:
PASS  (causal hypotheses confirmed/refuted)
+ HOLD on clean repair / 7D consolidation

Baseline Reproduction:
PASS

P1 Query-Channel:
NOT_SUPPORTED  (as primary UNSEEN repair)

P2 Phonetic Bias:
PARTIALLY_SUPPORTED

P3 Anti-Memorization:
PARTIALLY_SUPPORTED  (shortcut↓ without UNSEEN↑)

P4 Early-Stop:
AMPLIFIER

Primary Root Cause After 7C:
Stage A dual-encoder does not learn transferable
query↔candidate phonetic matching; SEEN success is
largely non-transferable memorization/geometry.
Oracle query syllables are a dataset-honesty issue
but not a sufficient single repair lever.

Best Clean Intervention:
NONE_YET

New Shortcut Detected:
NO (major). P3 reduced shortcuts; P2 null-query slightly ↑

Stage A:
KEEP_7A

Stage B:
KEEP

Dataset Contract:
MODIFY_IN_NEXT_PHASE (remove oracle span_syllables for honesty)

Tone:
HOLD

Node:
HOLD

50k:
HOLD

Recommended Next Phase:
Do NOT enter Phase 7D baseline consolidation.
Open stronger representation probes (explicit phonetic
matcher / residual over runtime-observable features)
as a new causal round — still no Tone/Node/50k.
```

---

## 1. Executive Summary

四个单变量探针均相对 **冻结的 7A Stage A** 独立运行（同容量 M0，无 Tone/更大模型/扩数据/Stage B 重训）。

| Probe | 主变量 | UNSEEN R@1 | Shortcut | Verdict |
|-------|--------|----------:|----------|---------|
| 7A | — | 0.044 | co 0.475 / nq 0.480 | baseline |
| **P1** Observed-only query syl | query contract | **0.033** ↓ | 略↓ | **NOT_SUPPORTED** |
| **P2** Phonetic aux loss | loss | 0.045 ≈ | co↓ nq↑ | **PARTIAL** |
| **P3** Cand char dropout 0.5 | anti-mem | 0.045 ≈ | **co↓ nq↓↓** | **PARTIAL** |
| **P4** Epoch dynamics | stop policy | epoch1 0.050 → final 0.033 | SEEN↑ | **AMPLIFIER** |

**关键因果结论：**

1. **去掉 oracle `span_syllables`（P1）并不能修好 UNSEEN** → query-channel 不是充分主修复杠杆（但仍需为 runtime 诚实性修改）。  
2. **破坏 candidate lexical shortcut（P3）有效降低 co/nq，但 UNSEEN 不升** → 证实 7B「记忆存在」；同时证明「拆掉 shortcut ≠ 自动获得可迁移匹配」。  
3. **过拟合是放大器不是主因（P4）** — epoch 1 UNSEEN 已接近 random。  
4. **尚无清洁干预同时满足 UNSEEN↑ + shortcut↓** → **不推荐 7D consolidation**。

---

## 2. Baseline Reproduction

Artifacts + live eval：`phase7c_meta/phase7c_baseline_reproduction.json`

| Metric | Expected | Live/Artifact |
|--------|---------:|--------------:|
| SEEN R@1 | 0.728 | 0.728 |
| SEEN R@3 | 0.945 | 0.945 |
| UNSEEN R@1 | 0.044 | 0.044 |
| candidate-only SEEN | ≈0.457 | **0.475** |
| null-query SEEN | ≈0.480 | **0.480** |

→ **PASS**

**DIAGNOSTIC_ORACLE_CEILING：** FuzzyDistance UNSEEN≈0.979 依赖 canonical `span_syllables`，**不是** RUNTIME_OBSERVABLE_PERFORMANCE。

---

## 3. Field Source Audit（P1 前置）

| Field | SOURCE |
|-------|--------|
| `span_text` | ASR_OBSERVED |
| `span_syllables` (7A) | **CANONICAL_TARGET**（100% = target pinyin） |
| `span_syllables` (P1-B) | **ASR_DERIVED_APPROX**（pypinyin fallback；显式标记） |
| candidate surface/syl | CANDIDATE_METADATA |
| `observed_syllables_for_relation` | SYNTHETIC_LABEL |
| `target_term_id` | SYNTHETIC_LABEL |

`RUNTIME_LIKE_QUERY` = **AVAILABLE_VIA_P1B**。

---

## 4. Causal Scorecard（seed 20260812）

| Metric | 7A | P1 | P2 | P3 | P4 | Desired |
|--------|---:|---:|---:|---:|---:|---------|
| SEEN R@1 | 0.728 | 0.722 | 0.736 | **0.836** | 0.741 | not collapse |
| UNSEEN R@1 | 0.044 | 0.033 | 0.045 | 0.045 | 0.033 | ↑ |
| UNSEEN R@3 | 0.098 | 0.087 | 0.108 | 0.117 | 0.096 | ↑ |
| Seen−Unseen gap | 0.685 | 0.689 | 0.691 | 0.792 | 0.708 | ↓ |
| Candidate-only Seen | 0.475 | 0.443 | **0.412** | **0.400** | 0.438 | ↓ |
| Null-query Seen | 0.480 | 0.434 | 0.490 | **0.326** | 0.430 | ↓ |
| Shuffle-query Seen | 0.412 | 0.389 | 0.412 | 0.371 | 0.389 | ↓ |
| Phonetic pair agree | ~0.53* | 0.536 | **0.590** | 0.555 | 0.527 | ↑ |
| Fuzzy-order reverse | — | 0.464 | **0.410** | 0.445 | 0.473 | ↓ |
| UNSEEN random-order R@1 | 0.044 | 0.033 | 0.046 | 0.045 | 0.033 | stable |
| NO_MATCH FP | 0.287 | 0.270 | 0.260 | **0.217** | 0.270 | not worsen |

\*7A phonetic agreement measured in live pack / probe evals.

Position bias：randomizing pool order ≈ original（无 `POOL_POSITION_SHORTCUT` 主导最终指标）。

---

## 5. P1 — Query-Channel Repair

**Hypothesis：** oracle syl + ASR chars 混在 query → 修复 observed-only 应改善泛化。

**Intervention：** 仅改 query `span_syllables`/`syllable_ids` → ASR_DERIVED_APPROX；池/标签/架构不变。

**Result：** UNSEEN **更差**；shortcut 仅略降。  
**Verdict：NOT_SUPPORTED** as primary causal repair.

**Interpretation：** 去掉 oracle 使任务更接近 runtime，但模型本就不会利用 syl 做可迁移匹配；oracle 泄漏解释「确定性基线虚高」，**不是** Stage A UNSEEN 失败的充分开关。

---

## 6. P2 — Phonetic Inductive Bias（Aux Ranking Loss）

**Intervention：** 保留 CE，加 pairwise phonetic-order aux（λ=0.5）。**不是** `score=fuzzy`。

**Result：** phonetic agreement ↑（0.54→0.59），fuzzy reversal ↓；UNSEEN 几乎不动；candidate-only ↓ 但 null-query 略↑。  
**Verdict：PARTIALLY_SUPPORTED** / `SUPPORTED_AS_PRIOR` 趋势弱，**NOT_YET_SUPPORTED_AS_LEARNED_GENERALIZATION**。

---

## 7. P3 — Anti-Memorization（Candidate Char Dropout 0.5）

**Intervention：** 训练时随机屏蔽 candidate **char** ids，保留 syllables。

**Result（seed 12）：**

- candidate-only 0.475→**0.400**
- null-query 0.480→**0.326**
- SEEN **上升**至 0.836（强制走 syl/oracle 通道）
- UNSEEN **≈不变**（0.045）

**Verdict：PARTIALLY_SUPPORTED** — 精确命中 7C 文档所述中间态：

> shortcut 被破坏，但 transferable representation 仍未建立。

这是**成功的因果实验**，不是失败实验。  
Seed 13：UNSEEN 仍无显著提升（稳定性：shortcut 方向一致、UNSEEN 修复未出现）。

**3-seed stability（20260812/13/14）：** UNSEEN R@1 mean≈0.045（无修复）；null-query / candidate-only 平均仍低于 7A → shortcut↓ 可复现，transfer 未出现。

---

## 8. P4 — Early-Stop / Dynamics

每 epoch checkpoint + SEEN/UNSEEN/shortcut：

| Epoch | SEEN R@1 | UNSEEN R@1 | cand-only |
|------:|---------:|-----------:|----------:|
| 1 | 0.402 | **0.050** | 0.387 |
| 13 | 0.709 | 0.046 | — |
| 20 | **0.741** | 0.033 | 0.414 |

**Interpretation：AMPLIFIER（非 MAJOR）。**  
Epoch 1 UNSEEN 已接近 random；后续主要放大 SEEN 记忆。Early-stop ** alone 不能**作为修复。

---

## 9. Root-Cause Update（相对 7B）

| Hypothesis | After 7C |
|------------|----------|
| REPRESENTATION / lexical memorization | **CONFIRMED**（P3 直接操纵） |
| QUERY_CHANNEL oracle | **CONTRIBUTORY / honesty issue**；**NOT_CAUSAL as sole fix**（P1） |
| OVERTRAINING | **AMPLIFIER**（P4） |
| Easy-neg / relation / carrier | 仍非主路径（未重开） |
| Task evidence insufficiency | 仍否定（oracle ceiling 存在，但 runtime-observable 路径未学会） |

---

## 10. Stage B / Governance

- Stage B：**未训练、未修改**；sanity **DEFER**（无清洁 Stage A 候选可绑定）。  
- 参数量：与 7A M0 同构；P2 无新头，仅 aux loss。  
- 无 Tone / Node / 50k / 更大模型。  
- 7A baseline：**未覆盖**。

---

## 11. Artifacts

```text
training/model2/experiments/phase7c_meta/
  phase7c_baseline_reproduction.json
  baseline_7a_full_eval.json
  runtime_like_query_audit.json
  causal_scorecard.json
  root_cause_update.json
  stage_b_sanity.json
  go_summary.json

training/model2/experiments/phase7c_p{1,2,3,4}_*/seed_*/
  config.json metrics.json shortcut_metrics.json
  position_bias.json per_relation.json
  phonetic_agreement.json training_dynamics.json
  checkpoints/epoch_*.pt
```

Script：`training/model2/scripts/run_phase7c_probes.py`  
Eval helpers：`training/model2/diagnostics/phase7c_eval.py`

---

## 12. Acceptance Mapping

| Criterion | Status |
|-----------|--------|
| Baseline reproduction | PASS |
| P1–P4 completed independently vs 7A | PASS |
| Position-bias control | PASS |
| Shortcut probes | PASS |
| Runtime-like audit | PASS（via P1-B） |
| Per-relation metrics | PASS（per probe `per_relation.json`） |
| Causal scorecard + root-cause update | PASS |
| Stage B unmodified | PASS |
| Clean repair for 7D | **HOLD** |

---

## Verdict

**Phase 7C = PASS on causal attribution；HOLD on repair consolidation.**

下一步**不要**做 Phase 7D baseline replacement。应设计新的 representation 级因果探针（在 runtime-observable query 上显式学习 phonetic matching），同时把 dataset contract 中的 oracle `span_syllables` 列为必须修正项——它是诚实性/评测纯度问题，不是本轮已验证的单键修复开关。
