# Lingua Model2 V3 — Restored Stage D Controlled Retrain
# Date: 2026-08-17

**Stage:** `MODEL2_V3_STAGE_D_STAGE_J_RETRAIN_AND_FREEZE`  
**Experiment:** `training/model2_v3/experiments/v3_stage_d_stage_j_restored_retrain/`  
**Freeze:** `STAGE_D_RETRIEVAL_RESTORATION_FREEZE_V1`  
**Runtime swap:** **NO**

---

## Verdict

**Restored Stage D Retrain: PASS**

Gate is val-only (term-exclusive). Test / V2 / V3 / 固定 38 未参与调参。

| Check | Result |
|-------|--------|
| Init | P1 + fresh domain head |
| Shared trunk frozen during D | YES |
| Correct ≫ Empty | 0.304 vs 0.000 |
| Correct > Wrong / Swapped | 0.304 vs 0.196 / 0.174 |
| Held-out recoverability | TIR 0.304 (non-zero) |
| Train-high / val-poor overfit | NO |
| P regression after D | NO (RR 0.954 vs P1 0.955) |
| Empty-profile external gate | NO（监督学会 `domain_none`） |
| Architecture / retrieval contract | FROZEN / unchanged |

Domain Top1 仍低（val 0.304）。这是 **PASS-with-modest-head**，不是生产冻结。允许进入 Stage J joint，不构成模型权重冻结。

---

## Freeze (before training)

已确认正确部分标记 **FROZEN / KEEP**：

- RetrievalPolicyV3 / ONE Model2 / ONE checkpoint target
- `MODEL2_FEATURE_HASH_V1`
- `StageDProfileContractV1`
- `StageDRetrievalTargetIdentityV1`
- `stage_d_domain_conditioned_retrieval_contract_v1`
- domain-conditioned FuzzyPool ∪ unchanged base ∪ single budget
- action IDs: `domain_soft:{slot}` + `domain_none`
- 旧 shared-pool rerank：**RETIRED** / NOT_ACTIVE / NOT_SELECTABLE

文档：`docs/user_correction/STAGE_D_RETRIEVAL_RESTORATION_FREEZE_V1.md`

后续修改必须经过 Architecture / Contract Change Proposal。

---

## Data (not an exam set)

Eligible D = **404** unique FineSpan / **281** terms。term-exclusive：train 286 / val 46 / test 72。

| Source | N | Share |
|--------|--:|------:|
| REAL | 7 | 1.7% |
| DERIVED_REAL | 57 | 14.1% |
| SYNTHETIC | 340 | 84.2% |

REAL = **VERY_LOW_SUPPORT**。不得把 synthetic 分数读成 production。

`STAGE_D_RESTORED_TRAINSET_V1` 训练行：train **1430** / val **230**（含 `D_NONE_NEGATIVE`）。test labels 未进入 loader。固定 38：**未进入训练**。Leakage：**PASS**。

本轮未再扩数据（禁止为了 N 堆近重复 synthetic）。

---

## Initialization

**P1_PLUS_FRESH_DOMAIN_HEAD**（主实验）。

旧 J1 domain head 与新 teacher 仅 0.225 对齐，不得作为唯一主初始化。Controlled init A/B（J1 fine-tune）因 D→J 串行成本 **SKIPPED**；选择不看 V2 blind。

P1 load `strict=False`：missing=2（fresh domain head）。params：P-only 45533 → combined **47210**。

---

## Training

- 共享 trunk / P heads：**frozen**
- teacher：仅 **EXECUTE_VALIDATED**
- loss：BCE + pairwise + listwise + CORRECT>WRONG/SWAPPED/EMPTY contrast
- hard mining：仅 TRAIN split（top1 miss / empty 误扩 / REAL 轻度加权）
- 无 empty-profile 外部 gate
- early stop：epoch 11，restore best val DomainTop1（epoch 7 = 0.304）

---

## Val metrics (D pass gate)

| Metric | Value |
|--------|------:|
| Domain Top1 | 0.304 |
| Domain Top2 | 0.348 |
| D Recall Retained vs oracle | 0.304 (oracle TIR 1.0) |
| Correct TIR | 0.304 |
| Empty TIR | 0.000 |
| Wrong TIR | 0.196 |
| Swapped TIR | 0.174 |
| Correct−Empty | +0.304 |
| Correct−Wrong | +0.109 |
| Correct−Swapped | +0.130 |
| Empty unnecessary expansion | 0.065 |
| Held-out term/span/profile TIR | 0.304 |
| Multi-domain TIR | 0.222 (n=9, VERY_LOW_SUPPORT) |
| Generic TIR (expansion) | 0.239 (n=46) |

Empty profile：模型学会几乎不扩（expansion 0.065）。Wrong / Swapped / Generic 仍几乎总是扩（expansion ≈ 1.0）——这是 **PROFILE_SIGNAL / LOSS** 问题，不是检索执行器问题。禁止加 `if empty: disable domain`。

### Source (val CORRECT)

| Slice | N | TIR | Support |
|-------|--:|----:|---------|
| REAL | 1 | 1.00 | VERY_LOW_SUPPORT |
| DERIVED_REAL | 8 | 0.50 | VERY_LOW_SUPPORT |
| SYNTHETIC | 37 | 0.24 | LOW_SUPPORT |

Synthetic 并不高于 derived-real。**Synthetic Generator Overfit: UNCLEAR / 倾向 NO**。禁止用更多同类 synthetic 去抬分。

---

## Stage P after D

P1 baseline RR = **0.955**。Post-D RR = **0.954**（n=699 hard）。Teacher Top1 0.912 / Top2 1.0。**P Regression: NO**。

---

## What this PASS does not mean

- 不是 404 case 背下来
- 不是 Domain Top1 已够生产
- 不是可以 freeze Stage J checkpoint
- 只表示：fresh domain head 能学新 teacher；Correct 明显优于 Empty；held-out 有非零 recoverability；P 未被 D 训练破坏

下一闸门是 joint P+D，见 Stage J 报告。
