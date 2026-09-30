# Lingua Model3 V1 — Retry-Region Controlled Validation Report

**Phase:** `MODEL3_V1_RETRY_REGION_CONTROLLED_VALIDATION`  
**Date:** 2026-08-28  
**Mode:** READ-ONLY / TEST-ONLY  
**Result:** **PASS_WITH_LIMITATIONS**

---

## Purpose

Isolate **ASR postprocess retry-region capability** from Model3 trigger accuracy by injecting audited RETRY targets into the **same** production:

`deriveRetryRegions` → `routeModel3Retry` → pool refresh → `completeDomainAwareAssemblyFromVote`

No production logic was modified.

---

## Environment limitation (critical)

Live Lexicon / lattice re-segmentation **could not execute** in this Jest process:

```
better-sqlite3 NODE_MODULE_VERSION 119 vs required 137
```

Consequences:

| Stage | Status |
|-------|--------|
| Controlled RETRY injection | OK (fixture) |
| Region derivation (production) | **VALIDATED** |
| Adjacent RETRY merge | **VALIDATED** |
| Lattice local re-segmentation | **NOT EXECUTED** (fallback = per-source-span) |
| recallSpanTopKV2 | **NOT EXECUTED** |
| Assembly path with real retry hits | **NOT EXECUTED** on real cases |
| Unit/integration fixture path (mainline) | **PASS** (12/12) |

Reachability numbers below therefore mean:

> reference candidate was **not observed** through retry recall in this run — **not** a proven lexicon miss.

---

## Controlled setup

| Item | Value |
|------|------:|
| Unique cases | 16 |
| Controlled RETRY cases | 13 |
| Prior SEGMENTATION_LOCKED | 6 |
| NO_REPAIRABLE_TARGET (skipped force) | 3 |
| Cross-Anchor merge violations | 0 |
| Cross-KEEP merge violations | 0 |

RETRY spans: mapped from audited proxy surfaces onto FineSpan sequences; adjacent RETRY merged by production `deriveRetryRegions`.

---

## Region derivation

| Metric | Result |
|--------|--------|
| Correct region derivation | **13 / 13** |
| Adjacent merge correct | **8 / 8** |
| Cross-Anchor | **0** |
| Cross-KEEP | **0** |

Example (d179): controlled RETRY on `限|计|划|意|境|全|任` → **one** region, `regionMergedFromAdjacentRetry=YES`.

**Verdict:** bounded region postprocess mechanism is **VALID** for derivation/merge.

---

## Resegmentation

| Metric | Result |
|--------|--------|
| Segmentation unlocked (multi-span region) | **6 / 6** prior locked |
| Segmentation **changed** (new local surfaces ≠ old) | **0 / 13** |
| Still SEGMENTATION_LOCKED | **0** |
| latticeResegmentOk | **false** (env) |

Unlock = region covers multi-char proxy (no longer single frozen 1-char recall unit).  
Actual alternative lattice segmentation was **not** observed this run.

---

## Six critical (prior SEGMENTATION_LOCKED)

| Class | Count | Cases |
|-------|------:|-------|
| FULLY_REPAIR_CAPABLE | 0 | — |
| RESEGMENTED_BUT_RECALL_FAILED | **6** | d179,d142,d099,d131,d160,d176 |
| RECALL_SUCCEEDED_BUT_CANDIDATE_LOST | 0 | — |
| CANDIDATE_REACHED_ASSEMBLY_NOT_SELECTED | 0 | — |
| STILL_SEGMENTATION_LOCKED | **0** | — |
| NO_REPAIRABLE_TARGET | 0 | — |

Interpretation of `RESEGMENTED_BUT_RECALL_FAILED` here:

1. Region unlocked (A/B mechanism OK)
2. Live Recall empty due to **ABI env block**
3. Therefore **cannot** yet claim recall coverage failure vs env failure

---

## Reference reachability (this run)

| Class | Count |
|-------|------:|
| REFERENCE_REACHABLE | 0 |
| REFERENCE_PARTIALLY_REACHABLE | 0 |
| REFERENCE_NOT_REACHABLE | 13 |
| NOT_APPLICABLE | 3 |

Strict rule: reachable only if retry recall / `m3r:` candidates contain reference tokens (base ASR pool ignored).

---

## Candidate lifecycle

| Stage | Count |
|-------|------:|
| Correct candidate produced | 0 |
| Survived local cap | 13/13 (no violations; no retry hits) |
| Survived pool replacement | n/a |
| Survived global budget | n/a |
| Reached Assembly | 0 |

Loss points: none attributable (no candidate ever produced).

**Assembly path via fixture (mainline K/L):** PASS — when recall returns hits, pool refresh + same vote assembly works.

---

## Final repair

| Class | Count |
|-------|------:|
| FULL_RESCUE | 0 |
| PARTIAL_RESCUE | 0 |
| MECHANISM_REACHABLE_BUT_NOT_SELECTED | 0 |
| NO_RESCUE | 13 |
| NOT_EVALUABLE | 3 |

---

## dialog_200 regression

| Item | Result |
|------|--------|
| Full dialog_200 re-run this phase | **NO** (ASR/node live batch not required for mechanism isolation; env ABI also blocks) |
| Prior acceptance baseline | PASS; RETRY=0; regressionRate=0 |
| KEEP-only unit (mainline J/L) | **PASS** |
| Extra Recall on KEEP | **0** (KEEP path unchanged in tests) |
| Domain Vote once / Model3 once | **PASS** (unit) |
| Candidate ≤16 / second vote / recursive | **PASS** (unit + prior) |

KEEP-only unexpected change: **NO** evidence.

---

## Performance

| Metric | Value |
|--------|-------|
| Controlled Retry median overhead | **893 ms** |
| Controlled Retry P95 | **991 ms** |
| KEEP-only Retry overhead | **~0** when no RETRY (unit) |
| Performance regression | **INCONCLUSIVE** (includes Jest/setup; no live lattice) |

No optimization performed.

---

## Root cause

**Primary:** `MULTIPLE_GAPS`

1. **Env:** better-sqlite3 ABI → live Recall + lattice resegment **unproven** on real cases  
2. **Mechanism proven:** region derivation + adjacent merge + unlock of prior segmentation lock  
3. **Likely residual (prior audit, not re-proven):** even with unlocked windows, many multi-char `proxy_reference` strings may remain out of lexicon → `RECALL_COVERAGE_INSUFFICIENT` remains a **hypothesis**, not sealed this run  
4. Assembly integration with fixture recall: **OK** (not the current blocker)

---

## Training gate

| Gate condition | Status |
|----------------|--------|
| SEGMENTATION_LOCKED = 0 (mechanism) | YES |
| Region derivation correct | YES |
| Local re-segmentation functional | **PARTIAL** (fallback only; lattice not live) |
| Useful repair reachability | **NO** (unproven this run) |
| Candidate → Assembly functional | YES (fixture); unproven on real retry hits |
| KEEP regression | NO |

**MODEL3 TRAINING GATE: HOLD**

Do **not** train Model3 yet: postprocess region layer is directionally valid, but controlled real-case rescue capability through Recall was **not** demonstrated.

---

## Recommended next step

**Blocking layer:** `ENVIRONMENT_LEXICON_ABI` (+ optional follow-on `RECALL_COVERAGE` audit once ABI fixed)

**Recommended next:**

1. Rebuild `better-sqlite3` for current Node / run controlled validation under production node binary that already loads lexicon  
2. Re-run this same controlled suite with live `resegmentRetryRegionWithLattice` + `recallSpanTopKV2`  
3. Only if REFERENCE_REACHABLE ≥ useful bar → open  
   `MODEL3_V1_TRAINING_COVERAGE_FOR_RETRYABLE_LOCAL_REGIONS`

---

## Ownership of failures (no fix this phase)

| Issue | Ownership | Severity |
|-------|-----------|----------|
| better-sqlite3 ABI in Jest | Tooling / env | Blocks live Recall validation |
| Lattice reseg not changing surfaces | Env (not executed) | Unknown |
| NO_REPAIRABLE deletions | Known product limit | Preserve |
| Model3 RETRY=0 on dialog_200 | Training (later) | Out of scope |

---

## Artifacts (5)

1. This report  
2. `model3_v1_retry_region_controlled_cases.csv`  
3. `model3_v1_retry_region_candidate_lifecycle.csv`  
4. `model3_v1_retry_region_controlled_validation.json`  
5. `model3_v1_retry_region_validation_governance.json`

Test harness (not a report artifact): `model3-retry-region.controlled-validation.test.ts`
