# Lingua — Model3 V2 RealDist Acceptance & Promotion Audit

**Phase:** MODEL3_V2_REALDIST_ACCEPTANCE_AND_PROMOTION_AUDIT  
**Date:** 2026-08-29  
**Training / weights modified:** NO  
**Architecture modified:** NO  
**Auto-promoted:** NO

---

## MAIN VERDICT

| Field | Value |
|-------|-------|
| Candidate | **MODEL3_V2_REALDIST_V1** |
| Checkpoint acceptance | **REALDIST_CHECKPOINT_REJECTED** |
| Ready for production promotion | **NO** |
| Full Electron mainline executed | **YES** |
| Failure classification | **MULTI_FACTOR** |
| Next phase | **MODEL3_V2_FEATURE_CAPACITY_AUDIT** |

Controlled candidate loading path works (exact SHA). Full anchored dialog_200 mainline runs without invariant violations or final-text regressions. However, live Model3 RETRY does **not** deliver business improvement: among 13 HIGH inventory cases only **1** fires RETRY, and that RETRY targets an **unrelated** correct region (`一杯…`) rather than the suspicious `背→杯` error. Offline 7/13 case-level RETRY does **not** reproduce on live ASR FineSpans.

---

## CHECKPOINT IDENTITY

| Field | Value |
|-------|-------|
| Model ID | MODEL3_V2_REALDIST_V1 |
| Checkpoint path | `training/model3_dataset/model3_v2_realdist_v1_ckpts/seed_2026082903` |
| Expected SHA | `fbb8d85dc4bec117af510a9d8f0a5021a86187a1e1490ee63f9b66831bad648e` |
| Actual SHA | `fbb8d85dc4bec117af510a9d8f0a5021a86187a1e1490ee63f9b66831bad648e` |
| Config seal | sha256(config.json)=`2a235106436b7a5bf23ab19ba8b55587df8a3bf5dfb874ac0df03c56b3eacfe7` |
| Identity validation | **PASS** |
| Electron load log | pid 46852 — label MODEL3_V2_REALDIST_V1 role=CANDIDATE |

---

## HASH LOCK / PROMOTION PATH AUDIT

### Ownership classification

| Class | Applies? |
|-------|----------|
| CHECKPOINT_INTEGRITY_GUARD | **YES** (exact weights SHA required) |
| MODEL_RUNTIME_COMPATIBILITY_GUARD | **YES** (feat allowlist + config seal) |
| PRODUCTION_IDENTITY_SEAL | **YES** (default identity = MODEL3_SYNTHETIC_V1) |
| TEST_ENVIRONMENT_IDENTITY_SEAL | **YES** (harness preflight + same SHA) |
| ACCIDENTAL_HARDCODED_COUPLING | **YES historically** — production SHA was also the only loadable identity |
| OTHER | — |

### Call chain (before → after)

1. `run-model3-path-step.ts` → `getModel3InferenceHost()`
2. `model3-inference-client.ts` → `getActiveModel3Identity()` from `MODEL3_CHECKPOINT_IDENTITY` (default `MODEL3_SYNTHETIC_V1`)
3. Client pre-checks `sha256(weights.pt) == identity.expectedWeightsSha256` (fail-fast)
4. Spawns `model3_inference_host.py` with `load{label, checkpoint_dir, expected_weights_sha256, expected_config_hash, config_hash_mode}`
5. Host re-validates weights SHA + config seal (`config_field` for V1 / `config_file_sha256` for RealDist) + feature allowlist
6. ONE singleton infer path unchanged

### Existing candidate mechanism

**NO** (prior to this phase). Production SHA was hardcoded in client + host defaults.

### Required validation-path change

Minimal infrastructure registry + explicit identity env (still exact SHA). **Integrity protection weakened: NO.** Production default unchanged.

---

## CONTROLLED VALIDATION PATH

| Item | Detail |
|------|--------|
| Files changed | `model3-checkpoint-registry.ts` (new); `model3-inference-client.ts`; `model3-types.ts` (comment); `model3_inference_host.py`; `span-assembly-v4-orchestrator.ts` (observation `retry_regions` only); `run-dialog200-model3-acceptance.mjs` |
| Why required | Load sealed candidate without disabling hash checks or replacing production default |
| Activation | `MODEL3_CHECKPOINT_IDENTITY=MODEL3_V2_REALDIST_V1` (harness `--checkpoint-identity`) |
| Production default checkpoint changed | **NO** |

Forbidden patterns avoided: no hash bypass, no warn-and-continue, no latest-checkpoint discovery, no dual business pipeline.

---

## FULL DIALOG_200

Harness: existing `run-dialog200-model3-acceptance.mjs --anchored-only` (same `/run-pipeline-with-audio` mainline).  
Runner note: use system `node` (ELECTRON_RUN_AS_NODE electron.exe aborted after case 1 — harness infra only).

| Metric | RealDist | V1 baseline (prior accepted) |
|--------|----------|------------------------------|
| Cases | 51 anchored | 53 anchored |
| Passed (completed/failed) | 51 / 0 | 53 / 0 |
| IMPROVED | **15** | 15 |
| UNCHANGED | 36 | 38 |
| REGRESSED | **0** | 0 |

---

## MODEL3 RETRY

| Class | Count |
|-------|-------|
| RETRY cases (batch) | **3** (d002, d017, d137) |
| TARGET_REGION_RETRY (13-inv) | **0** |
| ADJACENT_VALID_REGION_RETRY (13-inv) | **0** |
| UNRELATED_REGION_RETRY (13-inv) | **1** (d002) |
| NO_RETRY (13-inv) | **12** |

Offline probe previously reported 7/13 case-level RETRY on **stored** FineSpans. Live ASR FineSpans differ; offline recall does not transfer.

---

## RETRY FUNNEL

| Stage | Count |
|-------|-------|
| dialog cases | 51 |
| RETRY_TRIGGERED | 3 |
| REGION_DERIVED | 3 |
| LOCAL_HYPOTHESES_AVAILABLE | 3 |
| RECALL_CANDIDATES_AVAILABLE | 3 |
| ASSEMBLED_CANDIDATES_AVAILABLE | 3 |
| FINAL_OUTPUT_CHANGED (RETRY subset) | **0** |
| IMPROVED (RETRY subset) | **0** |
| UNCHANGED (RETRY subset) | **3** |
| REGRESSED (RETRY subset) | **0** |

All three Model3-triggered utterances remain **UNCHANGED** after Retry (Recall returned some candidates; Assembly/KenLM did not change final text). Failure ownership marks these as `DOWNSTREAM_SELECTION_ERROR` for attribution of non-improvement — but the upstream RETRY targets were also wrong-region for the inventory errors.

---

## 13-CASE REAL RETRY INVENTORY

| case | RETRY spans | attribution | region | candidate | final change | outcome |
|------|-------------|-------------|--------|-----------|--------------|---------|
| d002 | 烦,做,一,杯 | **UNRELATED_REGION_RETRY** | 烦; 做\|一\|杯 | yes (2) | no | UNCHANGED |
| d003 | — | NO_RETRY | — | no | no | UNCHANGED |
| d019 | — | NO_RETRY | — | no | yes* | IMPROVED |
| d049 | — | NO_RETRY | — | no | no | UNCHANGED |
| d099 | — | NO_RETRY | — | no | no | UNCHANGED |
| d131 | — | NO_RETRY | — | no | yes* | IMPROVED |
| d139 | — | NO_RETRY | — | no | yes* | IMPROVED |
| d142 | — | NO_RETRY | — | no | no | UNCHANGED |
| d160 | — | NO_RETRY | — | no | no | UNCHANGED |
| d176 | — | NO_RETRY | — | no | yes* | IMPROVED |
| d179 | — | NO_RETRY | — | no | yes* | IMPROVED |
| d181 | — | NO_RETRY | — | no | yes* | IMPROVED |
| d195 | — | NO_RETRY | — | no | no | UNCHANGED |

\*IMPROVED without Model3 RETRY — pre-existing non-Model3 repair path (same as V1 baseline pattern).

**d002 detail:** probe error is `背` (大背→大杯). Live RETRY fired on correct `一杯` neighborhood, **not** on `背`. Not credited as successful trigger.

---

## FALSE RETRY SAFETY

| Item | Value |
|------|-------|
| NO_ERROR KEEP controls (6) | **0** false RETRY |
| Extra RETRY outside 13-inv | d017, d137 |
| d137 | same 大背 pattern as coffee orders; RETRY again on `一杯/热` not `背` — unrelated |
| d017 | `川|错` — unrelated to expected 七点 repair |
| False final modifications from Model3 RETRY | **0** (all RETRY cases UNCHANGED) |
| False regressions | **0** |

---

## BASELINE VS REALDIST

| metric | baseline V1 | RealDist | delta |
|--------|-------------|----------|-------|
| cases completed | 53 | 51 | −2 (filter source) |
| IMPROVED | 15 | 15 | 0 |
| REGRESSED | 0 | 0 | 0 |
| Model3 RETRY cases | 0 | 3 | +3 |
| meaningful 13-inv RETRY | 0 | 0 | 0 |
| candidate >16 | 0 | 0 | 0 |
| model3 latency p50 ms | 8 | 9 | +1 |

---

## MAINLINE INVARIANTS

| Invariant | Result |
|-----------|--------|
| Model3 ≤1 / path | **PASS** (no second Model3 in Retry) |
| Domain Vote once | **PASS** (second_vote_violations=0) |
| Retry ≤1 op semantics | **PASS** (no recursive Retry) |
| recursive Retry = 0 | **PASS** |
| ASR rerun = 0 | **PASS** |
| second mainline = 0 | **PASS** |
| Anchor crossing = 0 | **PASS** |
| retainedDomains reused | **PASS** |
| candidate ≤16 | **PASS** (global_gt16=0) |

---

## PERFORMANCE

| | V1 baseline | RealDist |
|--|-------------|----------|
| model3 p50 / p95 | 8 / 16 | 9 / 35 |
| retry p50 / p95 | 0 / 1 | 0 / 1 |
| post-ASR delta p50 | 20 | 24 |

No significant regression requiring redesign. p99 model3=247ms is first-load / cold path noise.

---

## ARCHITECTURE GOVERNANCE

| Component | Changed? |
|-----------|----------|
| Model3 architecture / features / labels / threshold | **NO** |
| FineSpan / Retry / Recall / Lattice | **NO** |
| Domain Vote / Model2 / Assembly / JobResult | **NO** |
| Production business files | **0** (inference identity registry only) |
| Checkpoint hash integrity | **NOT weakened** |

---

## PROMOTION DECISION

**REALDIST_CHECKPOINT_REJECTED** (for production promotion).

Reasons:

1. Live meaningful RETRY coverage on the 13-case inventory ≈ **0/13** (offline 7/13 not reproduced).
2. Observed RETRYs are **UNRELATED_REGION_RETRY** and yield **0** IMPROVED finals.
3. Overall dialog IMPROVED equals baseline; Model3 RETRY adds no business win.
4. Safety is acceptable (no REGRESSED; KEEP controls clean) — rejection is for **promotion readiness**, not for catastrophic breakage.

---

## PROMOTION PLAN

Not applicable — acceptance for promotion **failed**.

If a future candidate passes, the minimal production cutover would be:

| Step | Action |
|------|--------|
| old identity | MODEL3_SYNTHETIC_V1 / SHA `9d25234a…24b815` |
| new identity | register as PRODUCTION in `model3-checkpoint-registry.ts` + flip default `MODEL3_PRODUCTION_IDENTITY_ID` |
| files | registry; optionally sync production constants in `model3-types.ts` / host defaults |
| verify | harness with default identity (no env override); SHA preflight; smoke dialog cases |
| rollback | restore prior registry default + redeploy; exact previous SHA required |

Do **not** retain dual-model runtime fallback.

SSOT docs to update only in a future promotion phase: `MODEL3_SYNTHETIC_V1_FROZEN.md` / acceptance seal / README status — **not updated now**.

---

## MULTI_FACTOR FAILURE BREAKDOWN

| Factor | Evidence |
|--------|----------|
| RETRY_REGION_ATTRIBUTION_FAILURE | d002/d137 RETRY on `一杯…` not on `背` |
| Offline→live FineSpan gap | Offline 7/13 vs live 1/13 unrelated |
| RETRY_CONSUMER / selection non-win | 3/3 RETRY cases UNCHANGED despite some Recall returns |

Preferred next work is **feature capacity / live FineSpan evidence audit**, not another RealDist retrain from the same expansion recipe.

---

## NEXT PHASE

**MODEL3_V2_FEATURE_CAPACITY_AUDIT**

Do **not** execute in this phase. Do not retrain. Do not auto-promote.

---

## ARTIFACTS

1. `docs/user_correction/model3/Lingua_Model3_V2_RealDist_Acceptance_Promotion_Audit_2026_08_29.md`
2. `docs/user_correction/model3/model3_v2_realdist_mainline_results.csv`
3. `docs/user_correction/model3/model3_v2_realdist_retry_funnel.csv`
4. `docs/user_correction/model3/model3_v2_realdist_acceptance_summary.json`
5. `docs/user_correction/model3/model3_v2_realdist_acceptance_governance.json`

Supporting (≤10): `model3_v2_realdist_inventory13_attribution.csv`, `model3_v2_realdist_dialog200_raw_cases.jsonl`, `model3_v2_realdist_dialog200_run.log`

---

## HARD STOP

Candidate path audited; RealDist identity verified; full Electron dialog_200 executed; RETRY attribution/funnel/outcomes recorded; promotion denied; next phase not started.
