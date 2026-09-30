# Lingua1 — Path Budget Capacity Increase & Bottleneck Remeasure V1

```text
PHASE = LINGUA_PATH_BUDGET_CAPACITY_INCREASE_AND_BOTTLENECK_REMEASURE_V1
MODE  = CONTROLLED_EXPERIMENT · SINGLE_VARIABLE · NO_ALGORITHM_CHANGE
```

## 0. Question answered

> If Multi-Path is given more capacity (symmetric 8→32), does the Segmentation bottleneck shrink, where does pressure move, and at what measured cost?

**Short answer:** Segmentation target→DomainVote survival rises **10/17 → 14/17** by 32/32 (known-7 seg recovery **0→4/7**). **16→24 adds zero** survival while path volume keeps growing (`DIMINISHING_RETURN_STARTS_AT = 16/16`). For recovered known-7 geometries, **final text stays wrong** — bottleneck **moves past segmentation** into downstream Model3/Assembly/KenLM selection (not fixed by path cap alone). Production default caps remain **8/8 UNCHANGED**.

---

## 1. Experiment integrity

| Item | Value |
|------|-------|
| Single variable | `maxActivePathsPerPosition` / `maxCompleteSegmentationPaths` only |
| Caps tested | 8/8, 12/12, 16/16, 24/24, 32/32 (no 64 in first pass) |
| Offline input | Frozen `_path_budget_edge_cache.json` LexicalEdge graphs (CORRECT_PROFILE capture) |
| Pipeline override | Env `LINGUA_EXPERIMENT_MAX_*` in `defaultLimits` — **unset ⇒ V4_LIMITS 8/8** |
| Algorithm / comparator / Domain Vote / models | Unchanged |
| `PRODUCTION_DEFAULT_PATH_CAPS` | **UNCHANGED** |

```text
SINGLE_VARIABLE_VALID = YES   # offline always; known-7 pipeline after clean restart
BASELINE_REPRODUCTION = PASS  # offline 8/8 = 10/17 & known-7 all pruned (matches prior audit)
```

### Executed vs not executed

| Scope | Status |
|-------|--------|
| Offline 17 evaluable × 5 caps | **DONE** |
| Pipeline known-7 × 5 caps × CORRECT_PROFILE | **DONE** (35 runs; pathCount matched cap) |
| Pipeline full 17 × 5 | **FAILED** first attempt (stale electron / fetch); not re-run in full |
| Full Pilot200 × 3 profiles × 5 = 3000 | **NOT EXECUTED** (cost; Phase-1 first) |

---

## 2. Target → Domain Vote survival (17 evaluable, offline)

| capacity | target→DomainVote | preDomainVoteLoss | known-7 seg recovered |
|----------|------------------:|------------------:|----------------------:|
| **8/8** | **10/17** | **7** | **0/7** |
| 12/12 | 12/17 | 5 | 2/7 |
| 16/16 | 13/17 | 4 | 3/7 |
| 24/24 | 13/17 | 4 | 3/7 |
| 32/32 | 14/17 | 3 | 4/7 |

Matches prior sensitivity table (no 64 in this pass).

### Resource volume (offline, n=17)

| capacity | peakActive mean/max | completeBefore mean/max | completeAfter mean | activeFire cases | completeFire cases |
|----------|---------------------|-------------------------|--------------------|------------------:|-------------------:|
| 8/8 | 19.5 / 24 | 16.8 / 24 | 8 | 17 | 16 |
| 12/12 | 27.6 / 36 | 24.4 / 36 | 12 | 16 | 16 |
| 16/16 | 35.4 / 48 | 31.2 / 48 | 16 | 16 | 16 |
| 24/24 | 50.4 / 72 | 43.4 / 72 | 23.8 | 12 | 15 |
| 32/32 | 65.5 / 96 | 54.7 / 96 | 31.3 | 12 | 15 |

---

## 3. Diminishing returns (offline survival)

| Step | +DomainVote cases | +known-7 seg | Δ completeBefore mean | Δ peakActive mean |
|------|------------------:|-------------:|----------------------:|------------------:|
| 8→12 | +2 | +2 | +7.5 | +8.1 |
| 12→16 | +1 | +1 | +6.9 | +7.8 |
| **16→24** | **+0** | **+0** | **+12.2** | **+15.1** |
| 24→32 | +1 | +1 | +11.3 | +15.1 |

```text
DIMINISHING_RETURN_STARTS_AT = 16/16
```

(First step with **zero** additional target→Vote while work keeps rising.)

---

## 4. Known-7 lifecycle (pipeline CORRECT_PROFILE)

| case | 8 | 12 | 16 | 24 | 32 | first geom→Vote |
|------|---|----|----|----|----|-----------------|
| 过拟合 | PRUNED | PRUNED | PRUNED | PRUNED | PRUNED | **NONE≤32** |
| 城门 | PRUNED | **REACH_VOTE→FINAL_WRONG** | same | same | same | **12/12** |
| 水道 | PRUNED | PRUNED | **REACH_VOTE→FINAL_WRONG** | same | same | **16/16** |
| 提示符 | PRUNED | **REACH_VOTE→FINAL_WRONG** | same | same | same | **12/12** |
| 护士长 | PRUNED | PRUNED | PRUNED | PRUNED | PRUNED | **NONE≤32** |
| 行程图 | PRUNED | PRUNED | PRUNED | PRUNED | **REACH_VOTE→FINAL_WRONG** | **32/32** |
| 黄包车 | PRUNED | PRUNED | PRUNED | PRUNED | PRUNED | **NONE≤32** |

```text
KNOWN_7_RECOVERED_FROM_SEGMENTATION @32 = 4/7
KNOWN_7_FINAL_CORRECT @ any cap ≤32 = 0/7
```

When geometry reaches Domain Vote, finals remain wrong (e.g. 城门→「层门」, 提示符→「提斯福」, 水道→「随道」). Model3 KEEP/RETRY **decision counts scale ~linearly with pathCount**.

---

## 5. Bottleneck transition

```text
SEGMENTATION_BOTTLENECK_REDUCED = YES   # 10→14/17; known-7 0→4/7
BOTTLENECK_MOVED = YES                  # on recovered known-7
NEW_DOMINANT_BOTTLENECK = FINAL_WRONG_DOWNSTREAM_AFTER_DOMAIN_VOTE
  (Model3 RETRY mass ↑ with paths; target surface not selected — NOT proven as sentence-cap≤16 alone)
CANDIDATE_BUDGET_BECAME_BLOCKER = NOT_PROVEN
MODEL3_BECAME_BLOCKER = PARTIAL_YES     # retry/keep units explode with path width
ASSEMBLY_BECAME_BLOCKER = NOT_PROVEN
KENLM_BECAME_BLOCKER = NOT_PROVEN
```

Interpretation: raising path caps **restores hypothesis visibility** as Lattice intended, but **does not** by itself repair these Pilot targets’ final strings.

---

## 6. Runtime (MEASURED_REPLAY_LATENCY)

Known-7 CORRECT_PROFILE `pipeline_ms` (instrumented dialog200 trace — **not** production 1.5s claim):

| capacity | p50 (approx across 7) | max (过拟合) | mean Model3 retry decisions / case |
|----------|----------------------:|-------------:|-----------------------------------:|
| 8/8 | ~8.9s | 18.0s | ~25 |
| 12/12 | ~9.0s | 18.0s | ~37 |
| 16/16 | ~9.5s | 18.6s | ~49 |
| 24/24 | ~9.9s | 18.8s | ~69 |
| 32/32 | ~12.2s | 22.6s | ~82 |

```text
MEMORY_MEASUREMENT = OBSERVABILITY_GAP
RESOURCE_EXPLOSION_OBSERVED = NO         # no OOM in known-7 series
ESTIMATED_OR_PRODUCTION_LATENCY = NOT_CLAIMED_FROM_THIS_REPLAY
```

Path count tracked env override: retained paths == configured complete cap (except graphs with fewer completes, e.g. 提示符 22 @24/32).

---

## 7. Full Pilot200 accuracy

```text
FINAL_ACCURACY_BY_CAPACITY (200×3) = NOT_EXECUTED
```

Do not invent NO/CORRECT/WRONG tables. Phase-1 evidence already shows known-7 **0 final corrects** under all tested caps.

---

## 8. Forbidden directions (confirmed not needed for this measurement)

```text
DOMAIN_GATE_REQUIRED = NO
BOUNDARY_PRESERVATION_REQUIRED = NO / NOT_PROVEN_AS_NEXT
ARCHITECTURE_CHANGE_REQUIRED = NO   # for running larger PROBE caps experimentally
IMPLEMENTATION_DEFECT_FOUND = NO
PATH_CAP_8_8_STATUS = PROBE / NOT_FINAL
PRODUCTION_PATH_CAP_CHANGE_AUTHORIZED = NO
```

---

## 9. Final verdict

```text
AUDIT_VALID = YES
EXPERIMENT_VALID = YES
SINGLE_VARIABLE_VALID = YES

BASELINE_REPRODUCTION = PASS

CAPACITIES_TESTED =
8/8,12/12,16/16,24/24,32/32

TARGET_DOMAINVOTE_SURVIVAL =
8/8 = 10/17
12/12 = 12/17
16/16 = 13/17
24/24 = 13/17
32/32 = 14/17

KNOWN_7_RECOVERED_FROM_SEGMENTATION =
8/8 = 0/7
12/12 = 2/7
16/16 = 3/7
24/24 = 3/7
32/32 = 4/7

FINAL_ACCURACY_BY_CAPACITY =
FULL_PILOT200_NOT_EXECUTED
KNOWN7_CORRECT_PROFILE_FINAL_CORRECT = 0/7 at all tested caps

PIPELINE_P50_BY_CAPACITY (known7 replay ms) ≈
8/8≈8900 · 12/12≈9000 · 16/16≈9500 · 24/24≈9900 · 32/32≈12200

PIPELINE_P95_BY_CAPACITY ≈ max-dominated (~18–23s 过拟合)

PEAK_RSS_BY_CAPACITY = OBSERVABILITY_GAP

SEGMENTATION_BOTTLENECK_REDUCED = YES
BOTTLENECK_MOVED = YES
NEW_DOMINANT_BOTTLENECK = FINAL_WRONG_DOWNSTREAM_AFTER_DOMAIN_VOTE

CANDIDATE_BUDGET_BECAME_BLOCKER = NOT_PROVEN
MODEL3_BECAME_BLOCKER = PARTIAL_YES
ASSEMBLY_BECAME_BLOCKER = NOT_PROVEN
KENLM_BECAME_BLOCKER = NOT_PROVEN

DIMINISHING_RETURN_STARTS_AT = 16/16

RESOURCE_EXPLOSION_OBSERVED = NO

PATH_CAP_8_8_STATUS = PROBE / NOT_FINAL
PRODUCTION_PATH_CAP_CHANGE_AUTHORIZED = NO

DOMAIN_GATE_REQUIRED = NO
BOUNDARY_PRESERVATION_REQUIRED = NO
ARCHITECTURE_CHANGE_REQUIRED = NO
IMPLEMENTATION_DEFECT_FOUND = NO

ONE_NEXT_OWNER = USER_PATH_BUDGET_PROBE_FINALIZATION_DECISION

ONE_NEXT_DELTA =
Decide whether to raise PROBE path caps for hypothesis visibility
knowing 16→24 is pure cost on this cohort and known-7 finals
are not repaired by capacity alone — do not freeze production yet
```

---

## Artifacts

1. `LINGUA_PATH_BUDGET_CAPACITY_BOTTLENECK_REMEASURE_V1.md` (this file)
2. `path_budget_capacity_summary.csv`
3. `path_budget_bottleneck_transition.csv`
4. `known_7_capacity_lifecycle.csv`
5. `path_budget_runtime_resource_summary.csv`
6. `path_budget_capacity_manifest.json`

Diagnostic raw (not counted): `_path_budget_known7_pipeline.json`, env override in `lattice-fine-span-runtime.ts` (defaults unchanged when unset).

**STOP.**
