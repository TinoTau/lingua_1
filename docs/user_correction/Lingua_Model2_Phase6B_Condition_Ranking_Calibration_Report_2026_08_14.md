# Lingua Model2 Phase 6B — Condition Ranking Calibration Report

| Field | Value |
|-------|-------|
| Date | 2026-08-14 |
| Nature | Condition Ranking Calibration（冻结 Base，修 FUSION / LOSS / PROFILE_BINDING） |
| Basis | Phase 6A PARTIAL PASS |
| Dataset | 复用 `pseudo_user_accent_scale_v1` / `stage_b_trainrows`（**未扩 TTS**） |
| Experiment | `training/model2/experiments/stage_b_condition_ranking_v1/` |
| Markers | `STAGE_B_PROBE_ONLY` / `NOT_FOR_RUNTIME` / `NOT_FROZEN` |
| Verdict | **PARTIAL PASS — Base Preservation GO / Ranking Calibration HOLD** |
| 10k–20k | **HOLD** |

---

## 1. Executive Summary

本轮解决 Phase 6A 的三个核心问题，结果分化：

| Goal | Result |
|------|--------|
| 1. PROFILE_UNAVAILABLE ≈ Stage A B0 | **PASS（max\|Δscore\|=0，rank identical）** |
| 2. Condition 改变 relative ranking（不仅 absolute score） | **PARTIAL** — Tiny hard-set PASS；全量 MarginGain↑ 但 ConditionGain@Recall / TargetRankDelta 仍负 |
| 3. Profile swap 产生可解释 ranking 差异 | **FAIL**（MRRSwapDamage=0） |

**禁止扩数据。** 下一动作仍是 ranking-loss / binding 校准，不是 10k TTS。

关键数值（primary **B2**，pronunciation val+test）：

| Metric | Value |
|--------|-------|
| Base preservation | **PASS** |
| Tiny ranking overfit | **PASS**（rankΔ +0.35，marginGain +0.54） |
| MarginGain_mean | **+0.509** |
| ConditionGain@3 | **-0.036** |
| TargetRankDelta_mean | **-0.252** |
| MRRSwapDamage | **0** |
| Wrong-direction test | PASS（1.0） |
| Trainable condition params | **610**（base 全冻） |

---

## 2. Phase6A Failure Review

6A 失败点与本轮处置：

| 6A Failure | 6B Action |
|------------|-----------|
| Empty path 漂离 B0（S1 joint FT） | **禁用 S1**；冻结 shared/Q/C/base |
| ConditionGain@Recall≈0 | 引入 User×Relation + ranking margin loss |
| Profile swap MRR delta=0 | 保留测试；**全量仍为 0** |
| 仅 absolute score gain | Tiny 上 margin+rank 成立；全量 rank 仍不稳 |

诊断未推翻：Condition path 可学；**ranking conditioning 仍未 GO**。

---

## 3. Base Preservation Strategy

```text
score_final = score_base + gate * delta_condition
PROFILE_UNAVAILABLE / inactive → delta = 0
⇒ score_final == score_base
```

Hard Gate 实测：`max_abs_score_delta = 0.0`，`rank_mismatch = 0`（tiny 后与 full 后均 PASS）。

---

## 4. Frozen Stage A Path

冻结：char/syl embeddings、QueryEncoder、CandidateEncoder、base scorer、NO_MATCH、legacy ConditionEncoder。

可训练：`ConditionCompatibilityScorer`（~609）+ `relation_gate`（1）。

---

## 5. CandidateConditionCompatibility V1

确定性特征：`relation_features[16]`，顺序 = `PHONETIC_FEATURE_INDEX_V1`。

强度：`matched_count / aligned_syllable_count`（normalized count）。

---

## 6. Relation Direction Contract

产物：

* `training/model2/stage_b/phonetic_relation_direction_contract_v1.json`
* 实验目录副本 `relation_contract.json`

语义冻结：

```text
UserFeature X_Y = 用户倾向把 canonical X 发成 observed Y
Match when: source has Y AND candidate has X
```

例：`lai3`→`nai3` 匹配 **`n_l`**，不匹配 `l_n`。单元测试覆盖。

---

## 7. Multi-Syllable Relation

选用 **normalized count**（非纯 binary）。双音节双匹配 → 1.0。

---

## 8. User×Candidate Interaction

```text
interaction[i] = user_condition[i] * relation[i] * mask[i] * realized
```

禁止仅用 generic 64D `u_cond · C` 作为唯一 6B 路径。

---

## 9. Condition Scorer

小 MLP：`interaction[16] + base_score → tanh * delta_cap`。  
`delta_cap` 由 base score std 审计：本轮 **0.6**。

---

## 10. Final Score Formula

```text
score_final = score_base + softplus(relation_gate) * delta_condition
```

无硬编码 `if n_l: score += 0.5`。

---

## 11. Candidate-Specific Delta

Empty spread ≈ 0（delta 强制 0）。  
Correct 产生非零 `delta_spread`（见 margin/delta metrics）。  
但全量上 spread 未稳定转化为 Recall 增益。

---

## 12–14. Losses

```text
L = λ_rank_cond * L_rank_condition
  + λ_wrong * L_wrong_condition
  + λ_nochange * L_profile_nochange
  + L_pair
```

* `margin = score_target − max(non-target in pool)`（C0）
* 目标：`margin(correct) > margin(empty/wrong)`
* NO_CHANGE：高 bias 不得显著恶化 margin

**发现：** 优化相对 C0 margin ≠ 优化全池 listwise rank。  
可出现 MarginGain↑ 同时 mid-competitors 超越 target → TargetRankDelta↓。

---

## 15. Tiny Ranking Overfit

| Metric | Value |
|--------|-------|
| n / hard non-rank0 | 96 / 96 |
| mean TargetRankDelta | **+0.354** |
| mean MarginGain | **+0.537** |
| frac improved / tied / worse | 0.146 / 0.573 / 0.281 |
| PASS | **YES** |

---

## 16. Tiny Profile Swap Test

见 `tiny_swap_test.json`。全量 swap 仍失败（§25）。

---

## 17. Base Preservation Gate

| Checkpoint | max\|Δ\| | rank mismatch | PASS |
|------------|---------|---------------|------|
| after tiny | 0.0 | 0 | YES |
| after full B1/B2 | 0.0 | 0 | YES |

**Hard Gate 满足。** Phase 6A empty-path 漂移问题已关闭。

---

## 18–20. B0 / B1 / B2

* **B0**：Stage A frozen，relation condition off  
* **B1**：等权 condition-only  
* **B2**：fidelity-weighted（primary；ConditionGain@3 略优于 B1 但仍为负）

无 S1 joint fine-tune；无其他 architecture variant。

---

## 21–24. Recall / MRR / RankDelta / MarginGain

Pronunciation slice（primary B2）：

| Metric | Unavailable | Correct | Delta |
|--------|-------------|---------|-------|
| Recall@3 | （见 b2_metrics） | — | **ConditionGain@3 = -0.036** |
| TargetRankDelta_mean | — | — | **-0.252** |
| MarginGain_mean | — | — | **+0.509** |

结论：相对竞争者的 **margin 条件增益成立**；**Recall/Rank 条件增益未成立**（全量）。

---

## 25. Profile Swap Damage

| Metric | Value |
|--------|-------|
| MRRSwapDamage | **0** |
| SwapDamage@3 | **0** |
| ignored_profile | **true** |

仍 FAIL。PROFILE_BINDING 未在全量 ranking 上关闭。

---

## 26–27. Wrong / Irrelevant Direction

`correct_leq_opposite_rate = 1.0`，`correct_leq_irrelevant_rate = 1.0` → 测试 PASS。  
但与 swap=0 并存，说明许多样本 rank 对 profile 变体不敏感（并列/持平居多）。

---

## 28. Per-Direction Binding Quality

| Label | Count | Examples |
|-------|-------|----------|
| BOUND | 7 | n_l, z_zh, ch_c, sh_s, eng_en, in_ing, h_f |
| WEAK | 2 | s_sh, en_eng |
| REVERSED | 7 | l_n, zh_z, c_ch, an_ang, ang_an, ing_in, f_h |
| IGNORED | 0 | — |

**政策：** REVERSED 方向应 `mask=0 / DEFER`，不得为了 16/16 漂亮污染整体。

特别：`z_zh` 本轮 BOUND（6A 曾负 TSG）；`ing_in` 仍 REVERSED。

---

## 29. Per-Strength Ranking Monotonicity

MarginGain：LOW/MED/HIGH 均强正，但 TargetRankDelta 均为负。  
**score/margin 单调 ≠ rank 单调** → 按规范仍 HOLD。

---

## 30. User×Relation Ablation

| Variant | mean_rank | R@3 |
|---------|-----------|-----|
| A user+relation | 7.55 | 0.194 |
| B user-only | 7.55 | 0.194 |
| C relation-only | 7.475 | 0.225 |
| D neither | 7.475 | 0.225 |

A≈B，C≈D：交互相对 user-only **未拉开**（标记 true 仅因容差）。  
真正的 interaction superiority **未证明**。

---

## 31–32. NO_CHANGE / High-Bias

NO_CHANGE：R@1 Correct − Empty = **0**（未升高 FP）。  
High-bias stress：见 `high_bias_stress.json`；与全量负 rank delta 同向，需在 rank 修复后重测。

---

## 33. Delta Scale Analysis

| Item | Value |
|------|-------|
| base_score_std | 0.77 |
| delta_cap | 0.6 |
| 风险 | C0 margin 优化可抬 mid-competitors |

---

## 34–37. Single/Multi / Unseen

见 `b2_metrics.json` slices。Base 冻结下 unseen 不崩（接近 B0 empty path）。  
Condition 增益问题是机制性的，不是 split 泄漏。

---

## 38–39. Mask Invariance / Term-ID

Mask invariance 保持（masked slot 改值不影响）。  
Term-id 非语义嵌入契约保持。

---

## 40–41. CPU / Parameters

* Condition 相关可训练：**610**  
* 全模型规模仍远小于 500k/2M  
* CPU B=1/5/10：仍为数毫秒级（`cpu_latency.json`）

---

## 42. Counterfactual Examples

`counterfactual_examples.jsonl`：**80** 条（B0 / Empty / Correct / Wrong Top-K + margin + delta）。

---

## 43. Runtime Non-Impact

未改 Node / ONNX / FuzzyPool / Domain Vote / KenLM / JobResult / 生产 `/tts`。

---

## 44. KEEP / MODIFY / ADD / DELETE / DEFER

| Action | Item |
|--------|------|
| KEEP | Frozen Stage A base；relation direction contract；base+delta formula；base preservation gate；tiny hard-set protocol |
| MODIFY | C0-margin loss → **listwise / multi-competitor** rank condition loss；REVERSED features mask=0 |
| ADD | CandidateConditionCompatibility；ConditionCompatibilityScorer；condition_losses_v2；ranking metrics |
| DELETE | Phase 6A 式 S1 joint FT（已移除） |
| DEFER | 10k dataset；Tone；personal/domain；S1-lite（直至 ranking GO） |

---

## 45. Risks

1. Margin↑ / Rank↓ 的 C0 目标错位  
2. 半数方向 REVERSED 拉低全量指标  
3. Profile swap 仍忽略 → binding 未完成  
4. Ablation 显示 interaction 未优于 user-only  

---

## 46. Baseline Scale Preconditions

进入 10k–20k 前必须：

1. Base preservation 继续 PASS  
2. Pronunciation ConditionGain@3 **≥ +0.02**（或等价稳定 rank 增益）  
3. TargetRankDelta_mean **> 0**  
4. Profile swap MRR/R@3 damage **≠ 0**  
5. User×Relation ablation 真正优于 user-only / relation-only  
6. REVERSED 方向已 MASK  

**当前未满足。**

---

## 47. Acceptance Checklist

| Criterion | Status |
|-----------|--------|
| Empty ≈ B0 | **PASS** |
| Tiny ranking overfit | **PASS** |
| Correct > Empty on Margin | **PASS** |
| Correct > Empty on Recall/Rank | **FAIL** |
| Profile swap ranking damage | **FAIL** |
| Wrong direction ≥ opposite/irrelevant | PASS（弱） |
| Interaction ablation superiority | **FAIL**（实质持平） |
| NO_CHANGE FP 不升 | PASS |
| Params / CPU | PASS |
| No runtime / no 10k expand | PASS |

---

## STOP Review

触发：

* Correct 全量仍主要抬 margin、伤害/不改 Recall  
* Profile swap 仍无 ranking 影响  

未触发：Empty 漂离 B0；tiny 失败；参数失控。

开放失败类：

```text
RANKING_LOSS
PROFILE_BINDING
FEATURE_SPECIFIC (REVERSED dirs)
CONDITION_INTERACTION (ablation flat)
```

禁止用更多 TTS / 更大模型 / Tone / personal 绕过。

---

## Next Phase Recommendation

```text
Phase 6C — Listwise Condition Rank Binding
  1. multi-competitor / listwise L_rank_cond
  2. mask REVERSED features
  3. require swap damage ≠ 0
  4. require User×Relation ablation gap
→ only then: 10k–20k Baseline Dataset
```

---

**Verdict: PARTIAL PASS — Base Preservation GO / Ranking Calibration HOLD. No 10k scale-up.**
