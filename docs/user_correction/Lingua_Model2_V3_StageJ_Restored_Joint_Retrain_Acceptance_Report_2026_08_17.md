# Lingua Model2 V3 — Restored Stage J Joint Retrain
# Acceptance Report
# Date: 2026-08-17

**Stage:** `MODEL2_V3_STAGE_D_STAGE_J_RETRAIN_AND_FREEZE`  
**Restored Stage D Retrain:** PASS  
**Restored Stage J Joint Retrain:** **HOLD**  
**Architecture:** FROZEN  
**Stage D retrieval contract:** FROZEN  
**Old shared-pool rerank:** RETIRED  
**ONE checkpoint:** YES（权重 **HOLD**，不冻结为生产）  
**Runtime swap:** **NO**  
**Production candidate:** **NO**

未写 PASS 冻结报告：模型权重不符合冻结条件。架构冻结已在 `STAGE_D_RETRIEVAL_RESTORATION_FREEZE_V1` 完成。

---

## Why HOLD

Joint 后 Stage P 从 P1 **0.955** 降到 **0.902**（n=699 phase2 hard）。规则：RR < 0.93 → **HOLD**。未使用 `query_budget=2` 补分。

同时：

- Wrong / Generic 仍高 unnecessary expansion（test ~0.85–0.96）
- REAL test N = 0（VERY_LOW_SUPPORT）；DERIVED_REAL test n=9 TIR 0.33
- V2 P frozen slice Teacher Top1 0.354 / RR 0.368（见局限：部分 V2 行缺少 `applicability` 字段，与 phase2 全字段评估不可直接等同；即使忽略该切片，0.902 已触发 HOLD）
- 不得因 training loss 好看而冻结 checkpoint

Failure class 优先：**LOSS**（joint 干扰 P）+ **DATA**（REAL 过少）+ **PROFILE_SIGNAL**（wrong/generic 过扩）。**不是**检索架构问题。禁止加新模块。

---

## Joint recipe

| Item | Value |
|------|-------|
| Architecture | RetrievalPolicyV3 `with_domain_head=True` UNCHANGED |
| Init | restored Stage D controlled (P1 trunk + trained domain head) |
| Phase 1 | P-anchor 3 ep, lr 3e-4, W_D=0 |
| Phase 2 | balanced P+D 6 ep, lr 2e-4 |
| Weights | W_P=1.25, W_D=0.55, W_QB=0.25 |
| Dataset | `STAGE_J_RESTORED_TRAINSET_V1`（test 排除） |
| Params | 47210 |
| Empty-profile gate | NO |

无 per-slice auxiliary loss。无新模型 / router / gate / rule。

---

## Stage P

| | RR | Teacher Top1 | Teacher Top2 |
|--|--:|--:|--:|
| P1 baseline | 0.955 | 0.915 | 1.0 |
| Post-D (shared frozen) | 0.954 | 0.912 | 1.0 |
| Post-J (phase2 hard n=699) | **0.902** | 0.858 | 0.987 |

**P Regression after J: SIGNIFICANT**（相对 0.93 闸门）。Joint interference: **SIGNIFICANT**。

---

## Stage D after joint (test / V3, frozen before eval)

V3 在训练开始前从 candidate **copy-freeze**，评估前未改定义。

| Metric | Value |
|--------|------:|
| Domain Top1 | 0.333 |
| Domain Top2 | 0.500 |
| D TIR / RR vs oracle | 0.458 (33/72) |
| Correct TIR | 0.458 |
| Empty TIR | 0.000 |
| Wrong TIR | 0.236 |
| Swapped TIR | 0.139 |
| Generic TIR (expansion) | 0.250 |
| Correct−Empty | +0.458 |
| Correct−Wrong | +0.222 |
| Correct−Swapped | +0.319 |
| Empty unnecessary expansion | **0.000** |
| Wrong unnecessary expansion | 0.958 |
| Held-out term/span/profile | 0.458（term-exclusive test） |
| Multi-domain | 0.839 (n=31) |
| P+D Full TIR | 0.333 (n=9, VERY_LOW_SUPPORT) |
| True synergy | 0（非 blocker） |

Empty 监督成功。Wrong/Generic 仍过扩。D held-out 有非零 recoverability，但不足以抵消 P 回归。

### Source (test)

| Slice | N | TIR | Support |
|-------|--:|----:|---------|
| REAL | 0 | — | VERY_LOW_SUPPORT |
| DERIVED_REAL | 9 | 0.333 | VERY_LOW_SUPPORT |
| SYNTHETIC | 63 | 0.476 | LOW_SUPPORT |

Synthetic 略高于 derived-real，未达「synthetic 很高 + real/derived 明显低」的硬判定。**Synthetic Generator Overfit: UNCLEAR**。REAL 不能解释为 production。

Failure taxonomy（V3 D miss）：`SYNTHETIC_MISS` 29 / `D_ACTION_MISS` 6 / `D_NONE_WHEN_EXPAND_NEEDED` 4。

---

## Blind

| Item | Value |
|------|-------|
| V2 modified | **NO** |
| V2 P (HARD_P_FROZEN n=699) | TIR_V3 0.353 / RR 0.368 — 见局限 |
| V2 D CLEAN | TIR 0.65 (n=20, VERY_LOW_SUPPORT) |
| V2 held-out term | 0.50 (n=6) |
| V2 held-out span | 0.73 (n=26) |
| V2 generic | 1.0 (n=14) |
| V2 multidomain | 0.74 (n=47) |
| V3 frozen before eval | **YES** |
| V3 D | TIR 0.458 (n=72) |
| Fixed 38 used for training | **NO** |
| Fixed 38 executor regression | **38/38 raw, 38/38 final**（非 production score） |

固定 38 只回答：restored executor 没有再退化。

---

## Latency

D action select P50 ~3 ms。P execute P50 ~54 ms（与历史 P1 评估同量级）。非本轮 blocker。

---

## Freeze decision

| Item | Status |
|------|--------|
| Stage D executor | FROZEN（架构/合同，上一轮已 restore） |
| Stage D teacher / dataset contract | FROZEN |
| Stage J training recipe | 记录在案，**不作为生产 recipe 冻结** |
| Stage J checkpoint | **HOLD** |
| Production candidate | NO |
| Node runtime swap | NO |

---

## Known limitations

1. REAL D eligible 仅 7；test REAL = 0。
2. Domain Top1 ~0.33，D RR 0.46：有泛化信号，不够强。
3. Wrong/Generic 过扩未解决（必须靠监督，禁止新 gate）。
4. Joint 破坏 P（shared trunk drift）。
5. V2 P 行可能缺 `n_applicable` / `applicability` / `base_pool`，与 phase2 全字段 RR 不可直接比；生产仍以 HOLD 为准。
6. P+D n=9，TRUE SYNERGY=0 保持。

---

## Recommended next phase

**不要改 Stage D retrieval architecture。不要 runtime swap。不要 case-driven patch。**

分类后下一步：

1. **LOSS**：加强 P-anchor / 降低 joint 对 trunk 的扰动（例如更长 phase1，或 joint 时继续 freeze 部分 P heads）——仍是同一 RetrievalPolicyV3。
2. **DATA**：优先真实 / derived-real diversity，禁止堆近重复 synthetic。
3. **PROFILE_SIGNAL**：加强 `D_NONE_NEGATIVE` 中 Wrong/Generic，而不是外部规则。

下一轮名称建议：`MODEL2_V3_STAGE_J_RESTORED_JOINT_P_PRESERVATION`（仍无 runtime swap）。
