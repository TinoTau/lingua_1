# Lingua1 — Segmentation Path Budget Sensitivity Audit V1

PHASE = `LINGUA_SEGMENTATION_PATH_BUDGET_SENSITIVITY_AUDIT_V1`  
MODE = READ_ONLY · CODE_FROZEN · OFFLINE_COUNTERFACTUAL · NO_PRODUCT_CHANGE

## 0. Research question

Holding LexicalEdges, enumeration algorithm, and structural comparator fixed — only varying audit-only  
`maxActivePathsPerPosition` / `maxCompleteSegmentationPaths` — how does target-containing segmentation  
hypothesis survival change, at what resource cost, and when does further budget increase stop being the right lever?

**This audit does not recommend a production cap number.**

---

## 1. Production algorithm mirror (gate)

| Item | Owner / source |
|------|----------------|
| Enumeration | `enumerateCompleteSegmentationPaths.ts` |
| Per-position prune | `maxActivePathsPerPosition` + `compareBestFirst` |
| Complete prune | `maxCompleteSegmentationPaths` + `compareBestFirst` |
| Comparator | `compareSegmentationPathRankingBestFirst` (fallback↑ fuzzy↑ toneRelaxed↑ exact↓ lexical↓ boundaryKey↑) |
| Default caps | `V4_LIMITS` = **8 / 8 PROBE** |
| Edge input | Model2-merged `candidatesByWindow` → `buildLexicalEdges` + fallback inject |
| Path identity | `boundaryKey` = `start-end\|…` |

### 8/8 mirror vs production (4 G2)

| caseId | mirror loss | expected | retained | prod retained | exact PFS | OK |
|--------|-------------|----------|----------|---------------|-----------|-----|
| p2_u001_003 | per_position_cap | per_position_cap | 8 | 8 | 0 | YES |
| p2_u004_033 | complete_path_cap | complete_path_cap | 8 | 8 | 0 | YES |
| p2_u005_004 | complete_path_cap | complete_path_cap | 8 | 8 | 0 | YES |
| p2_u005_015 | per_position_cap | per_position_cap | 8 | 8 | 0 | YES |

**AUDIT_MIRROR_VALID = YES** — sweep authorized.

---

## 2. Evaluability (Pilot200)

| Population | Count |
|------------|------:|
| Pilot200 cases | 200 |
| Cached CORRECT-profile replays (have `evaluationTargetSurface`) | 158 |
| **EVALUABLE** (target-geometry LexicalEdge exists pre-segmentation) | **17** |
| **NON_EVALUABLE** (no target edge → budget cannot recover) | **183** |

Non-evaluable = no `evaluationTargetSurface` (42) **or** surface present but no candidate-bearing LexicalEdge containing the evaluation target (141).  
Budget sensitivity applies **only** to the 17-edge-present cohort (+ dedicated G2 thresholds).

GT used only offline to identify target surface/geometry. **GT_USED_BY_RUNTIME = NO**.

---

## 3. Symmetric budget sweep (evaluable n=17)

| Budget | Target→DomainVote | Survival % | G2 | peakActive mean/max | completePre mean/max | retained mean |
|--------|------------------:|-----------:|----|---------------------|----------------------|---------------|
| **8/8** | 10 | **58.82** | **0/4** | 19.5 / 24 | 16.8 / 24 | 8 |
| 12/12 | 12 | 70.59 | 2/4 | 27.6 / 36 | 24.4 / 36 | 12 |
| 16/16 | 13 | 76.47 | 3/4 | 35.4 / 48 | 31.2 / 48 | 16 |
| 24/24 | 13 | 76.47 | 3/4 | 50.4 / 72 | 43.4 / 72 | 23.8 |
| 32/32 | 14 | 82.35 | 3/4 | 65.5 / 96 | 54.7 / 96 | 31.3 |
| 64/64 | 16 | 94.12 | 4/4 | 123.8 / 192 | 99.9 / 192 | 54.7 |
| 256/256 (safe ceiling) | 16 | 94.12 | 4/4 | 424.5 / 768 | 362.7 / 768 | 182 |

**UNPRUNED_EXECUTABLE = NO** — used safe ceiling 256/256. Same survival as 64/64 (ceiling on these graphs).

### Marginal survival vs path growth

| Step | +surviving cases | Δ survival pp | Δ retained mean | gain / retained growth |
|------|-----------------:|--------------:|----------------:|-----------------------:|
| 8→12 | +2 | +11.8 | +4.0 | 0.50 |
| 12→16 | +1 | +5.9 | +4.0 | 0.25 |
| 16→24 | +0 | 0 | +7.8 | 0 |
| 24→32 | +1 | +5.9 | +7.5 | 0.13 |
| 32→64 | +2 | +11.8 | +23.4 | 0.09 |

Clear **diminishing return per retained-path growth** after 12–16; 16→24 is pure cost.

---

## 4. Asymmetric caps (active vs complete)

| Setting | Survive (of 17) | Notes |
|---------|----------------:|-------|
| 8/8 | 10 | baseline |
| **8/16** | 12 | complete↑ only |
| **8/32** | 12 | complete↑ only (plateau) |
| **16/8** | 10 | active↑ only — **no gain** |
| **32/8** | 10 | active↑ only — **no gain** |
| 16/16 | 13 | both |
| 32/32 | 14 | both |

| Metric | Value |
|--------|-------|
| gain complete-only (8→32 complete, active=8) | **+2** |
| gain active-only (8→32 active, complete=8) | **+0** |
| gain both (8/8→32/32) | **+4** |

**ACTIVE_CAP_SENSITIVITY = LOW** (cohort aggregate; raising active alone cannot beat complete=8).  
**COMPLETE_CAP_SENSITIVITY = MEDIUM** (complete-only recovers +2).  
**Interaction:** both together recover +4 > +2+0 → **both caps material** on the joint frontier (especially G2).

---

## 5. G2 survival thresholds (counterfactual)

| caseId | term | geom | 8/8 | best rank@8 | FIRST_ACTIVE | FIRST_COMPLETE | FIRST_SYMMETRIC |
|--------|------|------|-----|-------------|----------------|----------------|-----------------|
| p2_u001_003 | 过拟合 | 11:14 | NO | 11 (partial) | **32** | **64** | **64/64** |
| p2_u004_033 | 城门 | 9:11 | NO | 11 | 8 | **12** | **12/12** |
| p2_u005_004 | 水道 | 9:11 | NO | 14 | 8 | **16** | **16/16** |
| p2_u005_015 | 提示符 | 6:9 | NO | 15 (partial) | **12** | **12** | **12/12** |

G2 survive: **0/4 → 2/4 (12) → 3/4 (16–32) → 4/4 (64)**.  
Hardest: **过拟合** (needs large active *and* complete; rank≈35 at 64).

---

## 6. Resource / combinatorial growth

| Ratio vs 8/8 | peakActive mean | completePre mean | retained mean |
|--------------|----------------:|-----------------:|--------------:|
| →16/16 | **1.81×** | **1.86×** | **2.0×** |
| →32/32 | **3.36×** | **3.25×** | **3.91×** |
| →64/64 | **6.36×** | **5.94×** | **6.84×** |
| →256/256 | **21.8×** | **21.6×** | **22.8×** |

Growth tracks the cap (more partials → more completes), not an uncontrolled factorial blow-up below 64.  
At 256, peakActive max **768** — steep; **UNPRUNED not safe**.

**RESOURCE_EXPLOSION_RISK = MEDIUM** (controllable through 32–64; steep beyond).

Downstream hypothesis multiplier ≈ retained-path multiplier (Domain Vote runs per retained path).

---

## 7. Ranking reopen gate

- At **64/64**: 16/17 evaluable survive; **1 residual** (`p2_u003_017` 护士长) still dies at `per_position_cap` even at 256/256.
- **过拟合** survives only when budget ≥ its structural rank (~35+).
- Cohort survival approaches a **high ceiling (94%)** with budget alone.

| Gate | Result |
|------|--------|
| PATH_CAP_INCREASE_ALONE_INSUFFICIENT | **NO** (for G2 and 16/17 evaluable) |
| STRUCTURAL_RANKING_POLICY_AUDIT_REQUIRED | **NOT_PROVEN** (1 residual + hard-rank G2 case; not yet dominant cohort failure mode) |

---

## 8. Owner classification

| Role | Owner | Evidence |
|------|-------|----------|
| **PRIMARY** | **P1_CURRENT_8_8_BUDGET_TOO_RESTRICTIVE** | G2 0/4 at 8/8; evaluable survival 58.8%→76.5% by 16/16 and 94% by 64/64 |
| **SECONDARY** | **P4_BOTH_PATH_CAPS_MATERIAL** | G2 split (2× active-bound, 2× complete-bound); asymmetric interaction (+4 both vs +2 complete-only) |

Not selected as primary: P5/P6 (budget still recovers nearly all); P7 (growth medium, not blocking measurement); P9 (mirror valid).

---

## 9. What this audit does **not** decide

- Production cap value (8→12/16/32/…)
- Comparator / exactEdgeCount weights
- Length bonuses, KenLM/Domain Vote in segmentation
- Removing pruning

---

## 10. Final verdict

```text
AUDIT_VALID = YES

PRODUCT_RUNTIME_CODE_CHANGED = NO
PRODUCTION_CONFIG_CHANGED = NO
ARCHITECTURE_CHANGED = NO

GT_USED_BY_RUNTIME = NO
GT_USED_BY_AUDIT = YES

AUDIT_MIRROR_VALID = YES

CURRENT_ACTIVE_PATH_CAP = 8
CURRENT_COMPLETE_PATH_CAP = 8

CURRENT_CAP_AUTHORITY = PROBE / NOT_FINAL
CANDIDATE_CAP_AND_PATH_CAP_ARE_SAME_CONTRACT = NO

G2_TOTAL = 4

G2_SURVIVE_AT_8_8 = 0/4
G2_SURVIVE_AT_12_12 = 2/4
G2_SURVIVE_AT_16_16 = 3/4
G2_SURVIVE_AT_24_24 = 3/4
G2_SURVIVE_AT_32_32 = 3/4
G2_SURVIVE_AT_64_64 = 4/4

PILOT_TARGET_SURVIVAL_8_8 = 58.82% (10/17 evaluable)
PILOT_TARGET_SURVIVAL_12_12 = 70.59% (12/17)
PILOT_TARGET_SURVIVAL_16_16 = 76.47% (13/17)
PILOT_TARGET_SURVIVAL_24_24 = 76.47% (13/17)
PILOT_TARGET_SURVIVAL_32_32 = 82.35% (14/17)
PILOT_TARGET_SURVIVAL_64_64 = 94.12% (16/17)

ACTIVE_PATH_GROWTH_8_TO_16 = 1.81× mean peakActive
ACTIVE_PATH_GROWTH_8_TO_32 = 3.36×
ACTIVE_PATH_GROWTH_8_TO_64 = 6.36×

COMPLETE_PATH_GROWTH_8_TO_16 = 1.86× mean completePre
COMPLETE_PATH_GROWTH_8_TO_32 = 3.25×
COMPLETE_PATH_GROWTH_8_TO_64 = 5.94×

ACTIVE_CAP_SENSITIVITY = LOW
COMPLETE_CAP_SENSITIVITY = MEDIUM

PATH_CAP_INCREASE_ALONE_INSUFFICIENT = NO
STRUCTURAL_RANKING_POLICY_AUDIT_REQUIRED = NOT_PROVEN
RESOURCE_EXPLOSION_RISK = MEDIUM

IMPLEMENTATION_DEFECT_FOUND = NO
MODEL2_CHANGE_REQUIRED = NO
MODEL3_CHANGE_REQUIRED = NO
QUERY_EVIDENCE_CHANGE_REQUIRED = NO
RETRY_REGION_CHANGE_REQUIRED = NO
DOMAIN_VOTE_CHANGE_REQUIRED = NO
SAMEDOMAIN_CHANGE_REQUIRED = NO
KENLM_CHANGE_REQUIRED = NO

PRODUCTION_PATH_CAP_CHANGE_REQUIRED = NOT_DECIDED_IN_THIS_AUDIT
ACP_REQUIRED = NOT_DECIDED_IN_THIS_AUDIT

PRIMARY_OWNER = P1_CURRENT_8_8_BUDGET_TOO_RESTRICTIVE
SECONDARY_OWNER = P4_BOTH_PATH_CAPS_MATERIAL

ONE_NEXT_OWNER = Path-budget PROBE finalization (architecture/product policy)
ONE_NEXT_DELTA = Use this sensitivity table to decide whether/how to freeze path budgets — do not change production caps or ranking in-code yet
```

---

## Artifacts

1. `LINGUA_SEGMENTATION_PATH_BUDGET_SENSITIVITY_AUDIT_V1.md` (this file)  
2. `segmentation_budget_sweep_summary.csv`  
3. `segmentation_budget_g2_thresholds.csv`  
4. `segmentation_budget_pilot_case_matrix.csv`  
5. `segmentation_budget_resource_growth.csv`  
6. `segmentation_budget_audit_manifest.json`

Diagnostic only (not counted): `_path_budget_edge_cache.json`, `tests/audit-segmentation-path-budget-sensitivity.mjs`.
