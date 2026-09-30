# Lingua Model2 Phase 6A — User-Conditioned Stage B Training Probe Report

| Field | Value |
|-------|-------|
| Date | 2026-08-14 |
| Nature | First phonetic UserProfile conditioning training probe |
| Basis | Phase 5F Data Gate PASS；Stage A M0 architecture |
| Dataset | `pseudo_user_accent_scale_v1` → `stage_b_trainrows/` |
| Experiment | `training/model2/experiments/stage_b_user_condition_probe_v1/` |
| Markers | `STAGE_B_PROBE_ONLY` / `NOT_FOR_RUNTIME` / `NOT_FROZEN` |
| Verdict | **PARTIAL PASS — Condition Mechanism GO / Ranking Gate HOLD** |
| Runtime / ONNX | **NOT RUN** |
| 10k–20k scale-up | **HOLD** |

---

## 1. Executive Summary

本轮第一次训练 phonetic UserCondition path，证明：

* Tiny Condition Overfit **PASS**（mean TargetScoreGain ≈ 0.67，正增益率 90.6%）
* Correct vs Empty：**TargetScoreGain_mean ≈ +0.25**（稳定、按强度单调）
* Opposite-direction test：**66.7%** correct-dir 更高
* Mask invariance **PASS**；参数 **141k ≪ 2M**；CPU 延迟仍小模型预算内

但同时：

* **ConditionGain@Recall≈0**（排序几乎不动）
* Profile swap 对 MRR **无影响**（`ignored_profile` for ranking）
* Joint S1 后 empty-path 相对 B0 偏移大；整体 Recall 相对 Stage A B0 **下降**

**结论：** Condition encoding / loss 路径可学，但当前 Late-Fusion gate **尚未转化为可靠 ranking 条件增益**。  
按 STOP 条件：**不得扩 10k–20k**；下一动作是 CONDITION_CALIBRATION，不是数据扩容。

---

## 2. Phase5F Data Gate Verification

| Gate | Status |
|------|--------|
| 2k–5k real TTS+ASR | PASS（2999） |
| 16 phonetic TRAINABLE_* | PASS |
| user/term leakage=0 | PASS |
| NonTerm 不主导 | PASS |
| condition_supervision_matrix | 已读入并权威使用 |

---

## 3. Stage B Mission

在相同 ASR span / context / FuzzyPool 下，验证：

```text
Correct Profile > Empty Profile
Wrong Profile 不造成不可接受误召回
```

本轮对 **target score** 成立；对 **Recall@K** 尚未成立。

---

## 4. Training Dataset

| Item | Value |
|------|-------|
| Source | `pseudo_user_accent_scale_v1` |
| Built rows | **5345**（含 HN siblings） |
| Pronunciation positives | **1951** |
| NO_CHANGE retained | yes |
| Eval pronunciation (val+test in-pool) | 745 |

优先：`ELIGIBLE_PRONUNCIATION_POSITIVE` / `ELIGIBLE_NO_CHANGE` / `ELIGIBLE_HARD_NEGATIVE`  
禁止用裸 `ASRObservableEffect` 作 positive。

---

## 5. Eligibility Rules

Positive 必须：

```text
associated_with_corruption == true
AND eligible == true
```

Ineligible 样本不进 Stage B trainrows（provenance 仍在 5F results）。

---

## 6. Condition Supervision Matrix

权威读取 `condition_supervision_matrix.json`：

* 16 phonetic → mask_default=1
* tone / personal_terms / domain_bias → **mask=0，不训练**

---

## 7. Phonetic Feature Index

冻结 `PHONETIC_FEATURE_INDEX_V1`（非 dict 迭代顺序）：

| Idx | Feature | Idx | Feature |
|-----|---------|-----|---------|
| 0 | n_l | 8 | an_ang |
| 1 | l_n | 9 | ang_an |
| 2 | zh_z | 10 | en_eng |
| 3 | z_zh | 11 | eng_en |
| 4 | ch_c | 12 | in_ing |
| 5 | c_ch | 13 | ing_in |
| 6 | sh_s | 14 | f_h |
| 7 | s_sh | 15 | h_f |

产物：`stage_b_trainrows/phonetic_feature_index_v1.json`

---

## 8. Condition Value Semantics

| Strength | Value |
|----------|-------|
| NONE | 0.0 |
| LOW | 0.2 |
| MEDIUM | 0.5 |
| HIGH | 0.8 |

与 Phase 5F / PseudoUserProfile 一致；训练未另造 mapping。

---

## 9. Fidelity Weighting

`condition_supervision_weight`（仅 loss，非 runtime feature）：

* GOOD → 1.0
* USABLE + 低 BaseRealization（`ing_in`）→ **0.55**
* 其余 15 → 1.0

比较：

* **B1** 等权
* **B2** fidelity-weighted

本轮 primary = **B1**（pronunciation ConditionGain@3 略优）；W1 未明显优于 W0。

---

## 10. Stage A Initialization

从 `stage_a_probe_v1/model2-stageA-probe-m0.pt` 加载：

* shared char/syl embeddings
* Query / Candidate encoders
* base scoring

Condition MLP 在 Stage A 未有效训练 → Stage B 从近随机 condition 路径开始，gate 初值 0.1。

---

## 11. Freeze / Unfreeze Strategy

| Phase | Epochs | LR | Trainable |
|-------|--------|----|-----------|
| S0 Condition-only warmup | 8 | 1e-3 | ConditionEncoder + gate |
| S1 Joint fine-tune | 12 | 2e-4 | 全模型（低 LR） |

发现：S1 改善了 condition score gap，但 **伤害了 base Recall**（相对 B0）。后续应更长 S0 / 更弱 S1 或冻结 shared。

---

## 12. Condition Fusion

保持 Stage A 已实现融合（未改架构）：

```text
score = dot(Q, C) + condition_gate * ⟨u_cond, C⟩
```

未引入 cross-attention / 大 User Encoder。

---

## 13. Correct Profile Contract

**HARD RULE：** CORRECT = 生成该 utterance 的真实 `PseudoUserProfile.phonetic_bias` snapshot。  
禁止按 corruption 事后伪造。

---

## 14. Neutral vs Unavailable Profile

| Mode | Semantics |
|------|-----------|
| PROFILE_UNAVAILABLE | mask=0（无个性化可用） |
| PROFILE_NEUTRAL | mask=1 + value=0（已知 NONE） |
| CORRECT | 真实 bias + trainable mask |
| WRONG | WP1 irrelevant / WP2 opposite / WP3 other user |

二者评估切片均保留；不得混淆 Unknown 与 Known-NONE。

---

## 15. Wrong Profile Construction

* WP1：无关方向 HIGH
* WP2：opposite direction HIGH
* WP3：同 split 其他 user bias

训练 batch 内旋转采样；评估聚合 wrong。

---

## 16. Condition Loss

```text
L_cond = w_fidelity * ReLU(margin - score_tgt(correct) + score_tgt(empty))
       + w_fidelity * ReLU(margin - score_tgt(correct) + score_tgt(wrong))
```

margin=0.05。有效驱动 **score gap**，但对 Softmax ranking 仍偏弱。

---

## 17. Total Loss

```text
L = L_rank + λ_neg L_neg + λ_hn L_hn + λ_cond L_cond
```

λ_neg=λ_hn=0.5，λ_cond=0.5。未做大 grid search。

---

## 18. Tiny Condition Overfit

| Metric | Value |
|--------|-------|
| n | 96 |
| epochs | 50 |
| mean TargetScoreGain | **0.673** |
| frac_positive_gain | **0.906** |
| PASS | **YES** |

若 tiny 失败本应立即 STOP — 未触发。

---

## 19. Training Config

见 `training_config.json` / `model_config.json`。  
Device：CPU（本机无 CUDA）；seed=20260814。

---

## 20. B0 Baseline

Stage A M0，`use_condition_in_score=False`。

Pronunciation slice：Correct≡Empty≡Wrong（条件路径关闭）。  
Recall@3 ≈ **0.228**（后续 B1/B2 empty 路径 Recall 明显更低 → S1 损伤基线）。

---

## 21. B1 Results（等权，Primary）

Pronunciation positives（n=745）：

| Profile | Recall@1 | Recall@3 | MRR | mean target score |
|---------|----------|----------|-----|-------------------|
| Unavailable | 0.035 | 0.077 | 0.159 | -4.519 |
| Neutral | 0.035 | 0.077 | 0.159 | -4.519 |
| Correct | 0.042 | 0.078 | 0.163 | -4.271 |
| Wrong | 0.035 | 0.077 | — | — |

* ConditionGain@3 ≈ **+0.001**
* TargetScoreGain_mean ≈ **+0.248**
* ConditionGain@1 ≈ +0.007；MRR gain ≈ +0.004

---

## 22. B2 Fidelity-Weighted Results

TargetScoreGain_mean ≈ +0.226；ConditionGain@3 ≈ 0。  
未优于 B1 → 回退等权为主推荐。

---

## 23. Correct vs Empty

* **Score：** Correct > Empty（稳定）
* **Recall：** 近似相等（HOLD）

---

## 24. Correct vs Wrong

Wrong Recall 未超过 Correct；WrongProfileDamage@3 ≈ 0（排序层几乎无差）。  
Score 层 ablation：Wrong feature < Correct。

---

## 25. Condition Gain

| Metric | B1 Pron |
|--------|---------|
| ConditionGain@1 | +0.0067 |
| ConditionGain@3 | +0.0013 |
| ConditionGain_MRR | +0.0038 |
| TargetScoreGain mean/med | +0.248 / (见 metrics) |

核心仍是 **score gain 有、rank gain 弱**。

---

## 26. Wrong Profile Damage

| Metric | Value |
|--------|-------|
| WrongProfileDamage@1/@3 | ~0 |
| score mean damage | -0.10（Wrong 相对 Empty 略抬高 score，但未爆 FP） |

未出现 Wrong≈Correct 同增益爆炸；亦未出现灾难性 FP。

---

## 27. Per-Direction Results

多数方向 ConditionGain@3=0；**TargetScoreGain** 多为正：

| Feature | n | TSG | Notes |
|---------|---|-----|-------|
| ch_c | 24 | +0.57 | 唯一可见 R@3 gain（+0.04） |
| h_f / f_h | 61/26 | +0.55/+0.50 | score 强 |
| l_n / zh_z | 63/74 | +0.33/+0.30 | score 强 |
| z_zh | 52 | **-0.13** | 反向 score（弱） |
| ing_in | 17 | +0.42 | score 有；rank 无；继续监控 fidelity |

---

## 28. Per-Strength Results

TargetScoreGain：

```text
LOW 0.139 < MEDIUM 0.225 < HIGH 0.292
```

强度趋势在 **score** 上可观察；Recall 仍近似平坦 → 更像弱 continuous / 近 ON-OFF 对 rank 的影响。

---

## 29. Initial vs Final

| Family | n | TSG | G@3 |
|--------|---|-----|-----|
| Initial | 531 | 0.235 | ~0.002 |
| Final | 214 | 0.278 | 0 |

Final score gap 不差，但 rank 无增益。

---

## 30. Single vs Multi User

| Kind | n | TSG | G@3 |
|------|---|-----|-----|
| single | 439 | 0.154 | 0 |
| multi | 306 | 0.382 | 0.003 |

Multi 更大 score gain；未见明显“只记固定模板”的崩坏证据（但 combo holdout slice 样本与 seen 合并统计需后续加固）。

---

## 31–34. Unseen User / Term / Combo

Val+test 用户相对 train 本就 disjoint；unseen slices 的 MRR_correct > 0.05（非随机）。  
**未**观察到 seen-user 极高、unseen-user 随机的典型用户记忆崩坏。  
Term 同理（pool 内 target）。Unseen combo 的独立 ConditionGain 需更大 holdout 专测（当前报表为 null/弱）。

---

## 35. Condition Ablation

Mean target score（n=200）：

| Variant | Score |
|---------|-------|
| A Full Correct | **-4.236**（最好） |
| B Relevant Only | -4.304 |
| C Relevant Masked | -4.373 |
| D Wrong Feature High | -4.422 |
| E Empty | -4.454 |

模式符合：A/B 好，C/E 降，D 无异常提升。

---

## 36. Mask Invariance

`phonetic_mask[i]=0` 时改 value → max_abs_delta=**0** → **PASS**。

---

## 37. Opposite-Direction Test

correct-dir HIGH > opposite-dir HIGH 比例 **0.667** → **PASS**。  
说明方向编码并非完全对称失效。

---

## 38. Irrelevant Feature Test

Ablation D（wrong feature）低于 A；未见无关特征系统性抬升 target。

---

## 39. Profile Swap Stress

MRR_correct == MRR_swapped（delta=0）→ **FAIL / ignored for ranking**。  
与 TargetScoreGain 并存：模型改了绝对分，但 **排序对 profile 交换不敏感**。

Failure class：**PROFILE_BINDING** / **FUSION**。

---

## 40. Profile Zeroing

Empty-path vs B0 mean abs score delta ≈ **4.15** → 未接近 Stage A base。  
原因：S1 联合微调改变了 base encoder / 分数尺度。  
Failure class：**FUSION**（训练策略）— UserProfile 应是辅助条件，不应让 empty 路径偏离 B0 过远。

---

## 41. NO_MATCH

NO_CHANGE / NEGATIVE 仍参与训练。高 bias 未观察到“全池乱改”的极端 FP 爆炸（rank 层几乎不动也限制了伤害）。  
需在 ranking 增强后重测 NO_MATCH FP。

---

## 42. Profile-Conditioned Hard Negatives

Trainrows 注入 profile-conditioned HN siblings；loss 含 L_hn。  
正式 HN FP 切片仍偏初步 — 随 ranking 增益增强后加严。

---

## 43. Term-ID Stress

继续依赖 surface/pinyin 特征；term_id 列表置换不改分（Stage A 同契约）。**PASS 预期保持**。

---

## 44. CPU Benchmark

| Batch | P50 ms | P95 ms |
|-------|--------|--------|
| B=1 | 1.58 | 1.95 |
| B=5 | 2.43 | 3.16 |
| B=10 | 2.99 | 3.60 |

无性能爆炸。

---

## 45. Parameter Count

| Item | Count |
|------|-------|
| trainable_total | **141,118** |
| condition_encoder | 6,784 |
| condition-related (+gate) | 6,785 |
| Hard max | 2,000,000 |

---

## 46. Counterfactual Examples

`counterfactual_examples.jsonl`：同 input 下 TopK_empty / TopK_correct / TopK_wrong。  
供人工检查 profile 改变了哪些候选分。

---

## 47. Limitations

1. Score gain ≠ Ranking gain  
2. S1 损伤 base Recall  
3. Profile swap 对 MRR 无感  
4. Neutral≈Unavailable（gate 对全零输入等价）在 rank 层难分  
5. `z_zh` 出现负 TSG  
6. 训练在 CPU；未做 production ONNX  
7. Tone / personal / domain 仍 MASK

---

## 48. KEEP / MODIFY / ADD / DELETE / DEFER

| Action | Item |
|--------|------|
| KEEP | Stage A dual-encoder；FuzzyPool V1；PHONETIC_FEATURE_INDEX_V1；mask contract；5F matrix；tiny-overfit gate |
| MODIFY | L_cond → ranking-aware（listwise / pairwise over pool）；S0 更长、S1 更弱或冻 shared；评估以 rank+score 双门 |
| ADD | Stage B trainrows builder；B0/B1/B2 probe；quartet eval；ablation/swap/zeroing |
| DELETE | 无 |
| DEFER | 10k–20k dataset；Tone；personal/domain；Node/ONNX；binary 降级仅作个别方向建议 |

---

## 49. Risks

* 过早宣布 Stage B GO → 把 score 伪影当召回增益  
* 扩数据掩盖 FUSION/LOSS 问题  
* S1 继续加重会破坏 Stage A 已学表示  
* `ing_in` 等弱 fidelity 在 rank 增强后可能污染 — 保持 weight/MASK

---

## 50. Baseline Scale Preconditions

进入 10k–20k **之前**必须：

1. Pronunciation slice ConditionGain@3 **稳定 > 噪声**（建议 ≥ +0.02）  
2. Profile swap 产生可解释 MRR 下降  
3. Profile zeroing 接近 B0（empty ≈ Stage A）  
4. Base Recall 不低于 B0 过多  
5. 核心方向（n/l、zh/z、ch/c、sh/s…）rank 或 score+rank 双指标可分  

当前 **未满足** → HOLD scale-up。

---

## 51. Acceptance Checklist

| Criterion | Status |
|-----------|--------|
| Tiny Condition Overfit | PASS |
| Mask contract | PASS |
| Correct score > Empty | PASS |
| Correct Recall > Empty（稳定） | **HOLD** |
| Wrong 不爆炸 | PASS（弱分离） |
| Counterfactual 可解释 score 变化 | PASS |
| Unseen user/term 不随机崩 | PASS（初步） |
| Strength score 单调 | PASS（LOW<MED<HIGH TSG） |
| Anti-demo term_id | PASS |
| Profile swap | **FAIL** |
| Profile zeroing ≈ B0 | **FAIL** |
| Params / CPU | PASS |
| No runtime integration | PASS |

---

## STOP Conditions Review

触发关注：

* Correct ≈ Empty on **Recall** useful slices  
* Profile swap 无 ranking 影响  

未触发：Wrong≈Correct 同增益爆炸；unseen 随机；参数失控；tiny 失败。

开放失败类：**FUSION / LOSS / PROFILE_BINDING**  
禁止用更大模型 / 更多 profile 特征 / 更大 raw 数据掩盖。

---

## Next Phase Recommendation

```text
Phase 6B — Condition Ranking Calibration
  (ranking-aware L_cond, S0-heavy schedule, freeze shared)
→ only then: 10k–20k Baseline Dataset
→ then: Tone enrichment / Real correction / Node integration
```

---

**Verdict: PARTIAL PASS — Condition Mechanism GO / Ranking Gate HOLD. No 10k scale-up. No runtime freeze.**
