# Lingua Model2 V3 — Restored Joint P-Preservation
# Date: 2026-08-18

**Stage:** `MODEL2_V3_STAGE_J_RESTORED_JOINT_P_PRESERVATION`  
**Primary question:** ONE RetrievalPolicyV3 能否在不改架构的前提下保住 Stage P，同时保留可用的 Stage D？  
**Answer:** **YES**（实验 A：冻结 shared trunk + P heads）

**Stage J P-Preservation: PASS**  
**Selected experiment: A**  
**Shared trunk: FROZEN**  
**B / C: NOT_RUN**（A 已满足，提前停止）  
**Runtime swap: NO**

---

## What was frozen (untouched)

RetrievalPolicyV3、MODEL2_FEATURE_HASH_V1、Stage D retrieval contract / executor、FineSpan、action IDs、`domain_none`、union/dedup/budget、KenLM/Tone/runtime skeleton。

无新模型、router、gate、rule、fallback。固定 38 / V2 / V3 **未进入** loss、early stop、sampling、checkpoint 选择。

---

## V2 packing fix (before training)

`p_only.jsonl` 1123/1123 行缺 `n_applicable` / `applicability` / `base_pool`。

从 `policy_phase2/rows.jsonl` 按 `row_id` **只补这三字段**。未改 FineSpan、target、teacher、labels。

Version: `STAGE_J_PRODUCTION_BENCHMARK_V2_PACKING_V1`  
完成于任何模型训练与 blind 之前。

上一轮 V2 P RR 0.368 是 harness packing bug。本轮同一 699 HARD_P_FROZEN：**RR 0.954**，与 phase2 hard 一致。

---

## Experiment A

Init: restored Stage D controlled checkpoint（P trunk = P1-derived，D head = restored-trained）。

Joint exposure: `STAGE_J_RESTORED_TRAINSET_V1` train 的 D_ONLY + D_NONE_NEGATIVE + 800 P_ONLY（`domain_none` 标签）。

Trunk / P heads / budget heads: **FROZEN**。仅 domain head 可训练。

Val-only 选择：继续训练把 val Domain Top1 从 **0.304 降到 ≤0.15**（P_ONLY `domain_none` 过推）。选择器回退到 **epoch 0 = D-controlled init**。

结论：在固定 P representation 下，D 能力可以**保持**（不要用大量 P_ONLY 再推 domain head）。问题确实是上一轮的 **shared-trunk update**，不是架构不能共存。

B/C 未跑。

---

## P (authoritative)

| | RR | Top1 | Top2 | N |
|--|--:|--:|--:|--:|
| P1 baseline | 0.955 | 0.915 | 1.0 | 699 |
| A / this checkpoint | **0.954** | 0.912 | 1.0 | 699 |
| Held-out | **0.939** | 0.902 | 1.0 | 439 |
| P1 held-out ref | 0.941 | — | — | 439 |

**P Regression: NO**（≥0.945，目标 ≥0.95；0.954 可接受）。`query_budget=1`。

Relation RR（subsample n=120）：sh_s 0.983 · h_f 0.965 · n_l 0.948 · z_zh 0.931 · eng_en 0.931 · ch_c 0.922 · **in_ing 0.907**（最弱，非崩溃）。

Top1–Top2 margin mean 0.261 / p50 0.172。Teacher Top1 on 400-cap = 0.915。

---

## D validation (selection)

| Metric | Value |
|--------|------:|
| Domain Top1 / Top2 | 0.304 / 0.348 |
| Correct / Empty / Wrong / Swapped | 0.304 / 0.000 / 0.196 / 0.174 |
| Correct−Empty | +0.304 |
| Held-out term/span/profile | 0.304 |
| Empty expansion | 0.065 |
| Generic TIR (overbias) | 0.239 |
| REAL | 1.0 n=1 VERY_LOW_SUPPORT |
| DERIVED_REAL | 0.50 n=8 |
| SYNTHETIC | 0.24 n=37 |

Empty 保持。Wrong/Generic 过扩仍是 **KNOWN_LIMITATION**（无外部 gate）。

Synthetic Pattern Bias: **NO**（synthetic 不高于 derived-real）。

---

## Blind (after candidate hash freeze)

Candidate sha256 `d66847be010f0953…` 冻结后才跑 V2/V3。未用于选择。

| Set | Result |
|-----|--------|
| V2 P HARD | RR **0.954** n=699（packing 修复后） |
| V2 D CLEAN | TIR 0.05 n=20 VERY_LOW_SUPPORT |
| V3 D | TIR 0.222 n=72；Correct 0.222 · Empty 0.000 · Wrong 0.181 · Swapped 0.194 |
| V3 Empty expansion | 0.056 |
| Fixed 38 | **38/38** executor only |

V3 Correct 仍 > Empty。Correct−Wrong 在 V3 上变薄。V2 D CLEAN n=20 不能当生产 D 分数。

---

## Freeze

满足本轮主问题与 P 硬约束。Checkpoint = 实验 A 选中的 D-controlled 权重（47210 params）。

详见 `Lingua_Model2_V3_StageJ_Model_Freeze_Report_2026_08_18.md`。

**Runtime swap 本轮仍为 NO。**
