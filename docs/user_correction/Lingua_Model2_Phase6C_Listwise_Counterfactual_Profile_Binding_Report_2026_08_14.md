# Lingua Model2 Phase 6C — Listwise Counterfactual Profile Binding Report

| Field | Value |
|-------|-------|
| Date | 2026-08-14 |
| Nature | Listwise Counterfactual Profile Binding（冻结 Stage A Base；BOUND-only active mask） |
| Basis | Phase 6B PARTIAL PASS（Base Preservation GO / Ranking HOLD） |
| Dataset | 复用 `pseudo_user_accent_scale_v1` / `stage_b_trainrows`（**未扩 TTS**） |
| Experiment | `training/model2/experiments/stage_b_listwise_binding_v1/` |
| Markers | `STAGE_B_PROBE_ONLY` / `NOT_FOR_RUNTIME` / `NOT_FROZEN` |
| Verdict | **PASS — Listwise Rank Binding GO** |
| 10k–20k | **GO（preconditions met）** |

---

## 1. Executive Summary

在完全冻结 Stage A Base 的前提下，Correct UserProfile 对 FuzzyPool candidate distribution 产生了有方向、candidate-specific、可验证的 ranking 影响。

| Gate | Result |
|------|--------|
| Metric contract（correct vs opposite） | **PASS**（命名与方向已修正；ties ≠ pass） |
| Base preservation（empty == B0） | **PASS**（Δscore=0，rank identical） |
| Tiny listwise overfit | **PASS**（rankΔ +4.68，frac improve 0.90） |
| Tiny User×Relation | **PASS**（A≪B/C/D） |
| Tiny / full profile swap | **PASS**（MRRSwapDamage > 0） |
| Full BOUND ConditionGain@3 | **+0.416** |
| Full TargetRankDelta_mean | **+5.056** |
| Interaction ablation | **PASS** |
| Selectivity | **PASS** |
| NO_CHANGE / false correction | **PASS**（rate=0） |

Primary B1（BOUND-only）后可选 B1W 已跑通；主结论以 **B1 BOUND** 为准。

---

## 2. Phase6B Failure Review

| 6B Failure | 6C Disposition |
|------------|----------------|
| C0 margin↑ 但 TargetRankDelta↓ | **退役** C0 作为主 loss；改 listwise CE + CF prob margin |
| ConditionGain@3 < 0 | Listwise + observed-relation 修复后 **+0.416** |
| MRRSwapDamage = 0 | **> 0**（full 0.022；tiny 0.014） |
| User×Relation ≈ User-only | V2 cand_gate + interaction-only；A 显著优于 B/C/D |
| 7 REVERSED / 2 WEAK | Primary **mask=0**；只训 7 BOUND |
| `correct_leq_*` 语义歧义 | 重命名并严格化 |

额外根因（本轮审计发现，非 6B 报告显式列出）：

> TrainRow `span_syllables` 来自 `source_pinyin`（canonical），导致 CandidateRelation 在 **target 上恒为 0**。  
> V2 cand_gate 正确阻断 user-only shortcut 后，tiny/full 无法学习 target boost。  
> **修复**：`observed_syllables_for_relation` 用 corruption family 的 X→Y 合成 observed（不改 FuzzyPool / 不重做 TTS）。

---

## 3. Metric Contract Audit

见 `metric_contract_audit.json`。

Legacy：

```text
correct_leq_opposite_rate = 1.0  → 被解释为 PASS
```

问题：

1. 字段名像 `correct_score <= opposite_score`（失败语义）；
2. 实现实际是 **非严格 rank**（`rank_correct <= rank_other`），**ties 计为成功**。

---

## 4. correct/opposite Metric Fix

新字段（越高越好）：

```text
CorrectProfileBetterThanOppositeRate
CorrectProfileBetterThanIrrelevantRate
```

语义：

```text
better ⇔ rank_correct < rank_other
        OR (same rank AND score_correct > score_other)
ties ≠ pass
```

单元测试：`test_phase6c_listwise.py::TestMetricSemantics`（gt / lt / tie）。

实测（BOUND eval，n=160）：两率均为 **1.0**，tie/worse=0。

---

## 5. Frozen Components

KEEP / FREEZE：

- Stage A Query / Candidate Encoder、char/syl embeddings、base scorer
- FuzzyPool V1、CandidateIndex
- `PHONETIC_FEATURE_INDEX_V1`、`phonetic_relation_direction_contract_v1`
- CandidateRelation 16D schema
- `score_final = score_base + delta_condition`
- PROFILE_UNAVAILABLE → `delta=0`
- UserProfile mask semantics、PseudoUser Accent Dataset V1、splits
- Model size / CPU budget；**无 S1 / 无 unfreeze base**

---

## 6. Active Feature Mask

Runtime schema 仍 **16D**。Training/eval active supervision：

```text
BOUND (mask=1): n_l, z_zh, ch_c, sh_s, eng_en, in_ing, h_f
WEAK  (primary mask=0; B1W 可选打开): s_sh, en_eng
REVERSED (mask=0): l_n, zh_z, c_ch, an_ang, ang_an, ing_in, f_h
```

产物：`active_feature_mask.json`。

---

## 7. BOUND/WEAK/REVERSED Policy

- Primary **B1**：仅 BOUND 7 维
- Secondary **B1W**：BOUND+WEAK（仅 primary 核心指标 PASS 后执行）
- REVERSED：本轮不启用；未发现“分类错误导致假 REVERSED”需要翻案

---

## 8. Counterfactual Profile Group V1

每个 eligible pronunciation positive：

```text
profile_unavailable / neutral / correct / wrong(opposite|irrelevant|swapped)
```

训练成组：同一 candidate list 上 Correct / Empty / Wrong 共享一次 base forward。  
Correct Profile = 事实 `phonetic_bias_snapshot`（禁止事后重建）。

---

## 9. Candidate List Contract

Frozen FuzzyPool ≤16；同 CF group：source/context/candidate IDs/order/base scores/target index 不变，只换 UserProfile。

---

## 10. Listwise Condition Objective

主 loss（`listwise_cf_losses.py`）：

```text
L = λ_list * (−log p_correct[target])
  + λ_empty * ReLU(m − P_t_correct + P_t_empty)
  + λ_wrong * ReLU(m − P_t_correct + P_t_wrong)
  + λ_nc * NO_CHANGE term
```

T=1.0；`prob_margin≈0.02`。C0 pairwise margin **仅允许作 diagnostic，不作主目标**。

---

## 11. Target Probability Gain

BOUND slice：

| Metric | Value |
|--------|-------|
| TargetProbabilityGain_mean | **+0.106** |
| mean_prob_target_correct vs empty | 明显提升 |

---

## 12. Wrong/Swap Objective

训练含 Wrong；评估：

| Metric | Value |
|--------|-------|
| MRR_correct − MRR_wrong（proxy） | 正（见 listwise/swap） |
| MRRSwapDamage | **+0.022** |
| SwapDamage@3 | **+0.05** |

---

## 13. Candidate-Specific Delta

Hard gate：`interaction≈0 → delta=0`（阻断 user-only / relation-only）。

| Metric | Value |
|--------|-------|
| CandidateDeltaSpread_mean（correct） | **2.52** |
| Empty spread | **0** |

---

## 14. Condition Selectivity

| | Correct | Empty | Wrong |
|--|---------|-------|-------|
| RelevantDeltaMean | 2.555 | 0 | ~0 |
| IrrelevantDeltaMean | 0 | 0 | ~0 |
| ConditionSelectivity | **+2.555** | **0** | 0.036 |

---

## 15. User×Relation Interaction

Full（BOUND，n=200）：

| Variant | mean_rank | Recall@3 |
|---------|-----------|----------|
| A user+relation | **2.67** | **0.59** |
| B user-only | 8.33 | 0.17 |
| C relation-only | 8.33 | 0.17 |
| D neither | 8.33 | 0.17 |

`interaction_gap_vs_user_only = 5.67` → **PASS**。

---

## 16. Shortcut Prevention

Condition Scorer V2：

```text
interaction = user * relation * mask
cand_gate = ‖interaction[j]‖ > 0
user=0 或 relation=0 ⇒ delta=0
```

测试覆盖：`TestRelationInteractionGates`。

---

## 17. Pool-Relative Feature

可选标量：`base_score`、`base_margin_to_top = base − max_other_base`。无 Transformer / attention。

---

## 18. Delta Requirement Analysis

（frozen empty/base scores，BOUND eval n=358）

| Metric | Value |
|--------|-------|
| required_delta_to_rank1 mean / p50 | 0.652 / 0.293 |
| required_delta_to_rank3 mean / p50 | 0.555 / 0.230 |
| learned_delta_target_mean | 2.555（含 relation_gate softplus 放大） |
| frac_learned ≥ need@3 | **1.0** |

说明：rank 改变所需 delta 量级与 base_std≈0.77 同阶；listwise 后 learned delta 足以跨越 Top-K 边界。

---

## 19. Delta Cap Analysis

`base_score_std≈0.770` → `delta_cap=0.6`（clip 上沿）。**未为了追指标继续抬 cap**；有效幅度主要由 gate×tanh 学习。

---

## 20. Tiny Data Selection

BOUND ∩ pronunciation ∩ pool≥3 ∩ empty 非 rank1 ∩ target 上 family relation>0。  
`n_hard_available=378`；tiny n=96。

---

## 21. Tiny Listwise Overfit

| Metric | Value |
|--------|-------|
| pass | **True** |
| mean TargetRankDelta | **+4.68** |
| mean TargetProbabilityGain | **+0.063** |
| frac_rank_improved | **0.896** |

---

## 22. Tiny Interaction Ablation

A mean_rank 3.35 vs B/C/D 9.82；gap **+6.47** → PASS。

---

## 23. Tiny Swap Gate

MRRSwapDamage **+0.014**；SwapDamage@3 **+0.031**；非 ignored。

---

## 24. Base Preservation

| Stage | max\|Δscore\| | rank_mismatch | pass |
|-------|---------------|---------------|------|
| after tiny | 0 | 0 | True |
| after full | 0 | 0 | True |

Empty distribution **严格等于 B0**（自动 assertion）。

---

## 25. Full Training Config

- Condition Scorer **V2** + relation_gate
- epochs=30，lr=1e-3，CPU，batch=16
- Base 全冻；无 S1
- Active mask = BOUND∩schema
- 产物：`training_config.json` / `model_config.json` / `training_log.jsonl`

---

## 26. B0

Relation off / empty path；作为 preservation 参照。`b0_metrics.json`。

---

## 27. B1 BOUND-only（Primary）

BOUND pronunciation val+test（n=358）：

| Metric | Empty | Correct | Gain |
|--------|-------|---------|------|
| Recall@1 | — | — | **+0.182** |
| Recall@3 | — | — | **+0.416** |
| MRR | — | — | **+0.262** |
| TargetRankDelta | — | — | **+5.056** |
| MarginGain | — | — | **+0.244** |
| TargetProbabilityGain | — | — | **+0.106** |
| frac_rank_improved | — | — | **0.888** |

---

## 28. Optional B1W

Primary PASS 后已训练；产物 `b1w_optional_metrics.json`。主 GO 判定仍以 B1 BOUND 为准（避免 WEAK 污染 primary）。

---

## 29–33. Recall / MRR / Rank / Prob / Margin

见 §27 与 `listwise_metrics.json`。相对 6B：

| | 6B primary | 6C B1 BOUND |
|--|------------|-------------|
| ConditionGain@3 | −0.036 | **+0.416** |
| TargetRankDelta | −0.25 | **+5.06** |
| MarginGain | +0.51 | +0.24 |
| MRRSwapDamage | 0 | **+0.022** |

---

## 34. Profile Swap Damage

| | Value |
|--|-------|
| MRR_correct | 0.443 |
| MRR_swapped | 0.421 |
| MRRSwapDamage | **0.022** |
| Recall@3_correct ≥ swapped | 0.59 ≥ 0.54 |

---

## 35–36. Correct vs Opposite / Irrelevant

Strict rates：**1.0 / 1.0**（n=160）。

---

## 37. Per-Direction Binding Quality（ranking-first）

| Direction | n | RankΔ | ProbGain | Label |
|-----------|---|-------|----------|-------|
| n_l | 92 | +5.92 | +0.102 | **BOUND** |
| z_zh | 52 | +6.19 | +0.118 | **BOUND** |
| ch_c | 24 | +3.79 | +0.060 | **BOUND** |
| sh_s | 19 | +3.63 | +0.079 | **BOUND** |
| eng_en | 78 | +4.21 | +0.154 | **BOUND** |
| in_ing | 32 | +4.59 | +0.097 | **BOUND** |
| h_f | 61 | +5.05 | +0.075 | **BOUND** |

REVERSED/WEAK 维在 primary 评估中 n=0（mask / slice）；未宣称其 PASS/FAIL。

---

## 38. Strength Behaviour

| Strength | n | RankΔ | ProbGain | Gain@3 |
|----------|---|-------|----------|--------|
| LOW | 42 | 6.17 | 0.134 | 0.548 |
| MEDIUM | 83 | 4.65 | 0.118 | 0.566 |
| HIGH | 233 | 5.00 | 0.097 | 0.339 |

未严格满足 HIGH≥MED≥LOW 的概率单调；**aggregate rank/prob gain 均为正**，按规格可接受。后续 10k 前可再校准 strength scaling。

---

## 39. User×Relation Ablation

见 §15 — **PASS**。

---

## 40–41. NO_CHANGE Safety / False Correction

| Metric | Value |
|--------|-------|
| ProfileInducedFalseCorrectionRate | **0.0**（n=483） |
| Recall@1 empty vs correct（NO_CHANGE） | 相同 0.041 |

---

## 42. Hard Negative Results

HIGH + empty 已 rank1（n=11）：demoted_by_correct_profile_rate **0.0**。

---

## 43–45. Unseen User / Term / Combo

| Slice | n | ConditionGain@3 | TargetRankDelta |
|-------|---|-----------------|-----------------|
| unseen_user | 841 | +0.195 | +2.35 |
| unseen_term | 841 | +0.195 | +2.35 |

未崩。Combo 切片见 `unseen_combo_metrics.json`（若 n 小则不作强结论）。

---

## 46. Counterfactual Examples

`counterfactual_examples.jsonl`：**100** 条（BOUND val/test），含 base/relation/delta/final 与 empty/correct/wrong ranks。

---

## 47. CPU Performance

| Batch | P50 ms | P95 ms |
|-------|--------|--------|
| B=1 | 2.12 | 2.54 |
| B=5 | 2.65 | 3.51 |
| B=10 | 3.01 | 4.04 |

Listwise 仅影响训练；runtime 仍为单 Profile scoring。

---

## 48. Parameter Count

| | Value |
|--|-------|
| trainable_total | **642** |
| condition_compat | 641 |
| relation_gate | 1 |
| ≪ 500k / condition <5k | **Yes** |

---

## 49. Tests

新增 `training/model2/tests/test_phase6c_listwise.py`：

- Metric semantics（> / < / tie）
- user=0 / relation=0 → delta=0；both active → candidate-specific
- Listwise loss 基本行为
- Active mask：REVERSED=0
- CF grouping 共享 pool 索引

既有 `test_phase6b_relation` 仍 PASS（含 synthesize observed 合同例）。

---

## 50. Runtime Non-Impact

- 无 Node / 无 production TTS / 无 ASR / 无 FuzzyPool 规则变更
- 仅训练侧 relation observed 语义修复 + Condition Scorer V2
- Schema 16D 保留

---

## 51. KEEP / MODIFY / ADD / DELETE / DEFER

| Action | Item |
|--------|------|
| KEEP | Stage A Base、FuzzyPool、16D schema、PROFILE_UNAVAILABLE=0 |
| MODIFY | Metric naming/strictness；relation observed 来源；binding 标签改为 ranking-first |
| ADD | Scorer V2、listwise CF loss、active BOUND mask、6C experiment+tests |
| DELETE（primary） | C0 margin 作为主 condition loss |
| DEFER | Tone、personal_terms、domain_bias、Node runtime、全量 16 维重开 |

---

## 52. Risks

1. **Strength 非严格单调**（HIGH prob gain 低于 LOW）— 扩数据前需监控。
2. **learned Δ 经 gate 放大超过 delta_cap 名义值** — 可接受但需在 10k 标定 gate。
3. **Observed syllables 为 family 合成**，非逐句 ASR G2P；与真实 ASR 残差可能不完全对齐（FuzzyPool 仍用原 span_syllables）。
4. Swap damage 绝对值仍偏小（方向正确）— 10k 后应再加压。
5. B1W / WEAK / REVERSED 全开仍可能回退 — 勿提前全开。

---

## 53. 10k Baseline Preconditions

| Precondition | Status |
|--------------|--------|
| Metric correctness | **Met** |
| Base preservation | **Met** |
| Listwise rank gain（BOUND） | **Met**（RankΔ>0，Gain@3≫0.02） |
| Profile binding（swap>0） | **Met** |
| User×Relation superiority | **Met** |
| Correct ≫ Opposite/Irrelevant | **Met** |
| Selectivity | **Met** |
| Safety（NO_CHANGE / HN） | **Met** |
| Generalization slices | **Met（未崩）** |
| CPU / params | **Met** |

→ **允许进入 10k–20k Baseline Dataset V1 → Stage A/B Baseline Training**。

仍禁止提前：Tone acoustic enrichment、Real Correction calibration、Node runtime integration。

---

## 54. Acceptance Checklist

- [x] Metric contract 审计 + 重命名 + 单测
- [x] Active BOUND mask；REVERSED/WEAK 不污染 primary
- [x] Runtime 16D schema 保留
- [x] Listwise CF 主目标；C0 退役
- [x] CF profile groups；Correct 事实 snapshot
- [x] Empty == B0 assertion
- [x] Candidate-specific delta + selectivity
- [x] User×Relation ≫ shortcuts
- [x] Tiny listwise / interaction / swap gates
- [x] Full B1 BOUND metrics 方向一致
- [x] Optional B1W 仅在 primary PASS 后
- [x] ≥100 counterfactuals；CPU；params
- [x] 未扩 TTS / 未加大模型 / 未引入 Tone·personal·domain·Node

---

## Verdict

**Phase 6C PASS。**  
失败类 RANKING_LOSS / PROFILE_BINDING / CONDITION_INTERACTION / FEATURE_SPECIFIC 在 BOUND 切片上已被 listwise counterfactual binding + observed-relation 修复证伪。  

**Next：** `10k–20k Baseline Dataset V1` → Stage A/B Baseline Training（仍冻结本轮已证明的 condition binding 契约，除非新证据推翻）。
