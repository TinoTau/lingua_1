# Lingua Model2 V3 — Stage J Model Freeze
# Date: 2026-08-18

**MODEL_FREEZE: YES**  
**Production candidate: YES**  
**Runtime swap: NO**  
**Checkpoint:** `training/model2_v3/experiments/v3_stage_j_p_preservation/training/expA_frozen_trunk.pt`  
**sha256:** `d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda`  
**Parameters:** 47210  
**Experiment:** A (frozen shared trunk; val-selected = restored Stage D controlled weights)

本轮冻结的是 **P-preserving ONE Model2 权重**，不是 Node runtime。下一阶段才是 `STAGE_J_RUNTIME_CHECKPOINT_SWAP` + REAL NODE E2E。

---

## Why freeze

| Gate | Result |
|------|--------|
| P RR vs P1 0.955 | 0.954 (≥0.945 acceptable) |
| Held-out P RR | 0.939 (P1 ref 0.941) |
| D held-out (val) | 0.304 > 0 |
| Correct > Empty | 0.304 vs 0.000 |
| Correct > Wrong (val) | 0.304 vs 0.196 |
| Empty behavior | expansion 0.065, TIR 0 |
| Synthetic-only | NO |
| Leakage | PASS |
| Architecture | UNCHANGED |
| ONE checkpoint | YES |
| Latency | P P50 52 ms / P95 71 ms；D select P50 ~3 ms |

上一轮 unfrozen-trunk joint 把 P 打到 0.902。本 checkpoint 证明：**不更新 shared trunk 时 P 与 D 可共存。**

---

## What is frozen

- RetrievalPolicyV3 architecture
- Restored Stage D executor + contract
- This weight file (P1 trunk + restored domain head)
- Feature hash V1 / profile / identity contracts
- V2 packing version V1（字段补全，非 case 修改）

Stage J **unfrozen-trunk** recipe 明确失败，**不**冻结为生产训练配方。生产权重对应实验 A：trunk frozen。

---

## Known limitations (do not add gates)

1. D 仍 modest（val Top1 0.304，V3 TIR 0.222）。本轮目标不是把 D 拉到 0.9。
2. Wrong / Generic 过扩：KNOWN_LIMITATION。禁止 `if empty/wrong: disable domain`。
3. REAL D N=7 / test REAL N=0。VERY_LOW_SUPPORT。
4. V2 D CLEAN TIR 0.05（n=20 VERY_LOW_SUPPORT）不作为生产 D 分数。
5. V3 Correct−Wrong/Swapped 变薄。
6. 用大量 P_ONLY `domain_none` 再训 domain head 会伤害 D；不要那样做。

---

## Explicitly not frozen as production behavior

- 上一轮 joint unfreeze-trunk recipe
- query_budget=2
- 任何 case-specific patch
- Node runtime checkpoint（下一轮）

---

## Next phase

`STAGE_J_RUNTIME_CHECKPOINT_SWAP` + REAL NODE E2E ACCEPTANCE。

不要再为了 V2 D n=20 或固定 38 打开 trunk。
