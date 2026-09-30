# Model3 V2 Runtime Default Promotion — Development Report

**Phase:** `MODEL3_V2_RUNTIME_DEFAULT_PROMOTION_DELTA`  
**Mode:** `CONTROLLED DEVELOPMENT + ACCEPTANCE`  
**Date:** 2026-09-08  
**Verdict:** `MODEL3_V2_RUNTIME_DEFAULT_PROMOTION_PASS_COMPLETE`

---

## Completion seal

```text
MODEL3_V2_DEVELOPMENT = COMPLETE
MODEL3_V2_RUNTIME_DEFAULT = MODEL3_V2_S3_RANDOM_INIT_V1
MODEL3_SYNTHETIC_V1 = EXPLICIT_ROLLBACK_ONLY
MODEL3_RETRY_SUBCHAIN = ACTIVE_AND_FROZEN
MODEL3_ARCHITECTURE = FROZEN
MODEL3_RUNTIME_IDENTITY = ALIGNED
```

---

## Required decisions

| ID | Answer |
| -- | ------ |
| A `S3_IS_NORMAL_ELECTRON_DEFAULT` | **YES** |
| B `SYNTHETIC_REMAINS_EXPLICIT_ROLLBACK` | **YES** |
| C `SILENT_FALLBACK_EXISTS` | **NO** |
| D `LOAD_FAILURE_POLICY` | **FAIL_CLOSED** |
| E `PRODUCTION_RETRY_ENABLED` | **YES** |
| F `RETRY_SEMANTICS_CHANGED` | **NO** |
| G `MODEL3_ARCHITECTURE_CHANGED` | **NO** |
| H `ACTIVE_SSOT_CONFLICT_COUNT` | **0** |
| I `PRODUCTION_BUILD_PASS` | **YES** |
| J `TARGETED_TESTS_PASS` | **YES** |
| K `MODEL3_RUNTIME_PROMOTION_COMPLETE` | **YES** |

---

## Semantic delta (only)

| | Before | After |
|--|--------|-------|
| no-env Electron default | `MODEL3_SYNTHETIC_V1` | `MODEL3_V2_S3_RANDOM_INIT_V1` |

Retry enablement, Retry semantics, Model3 algorithm, weights, threshold: **unchanged**.

---

## Before / after matrix

See `model3_v2_runtime_before_after.csv`.

---

## FILES_MODIFIED

| File | Change |
| ---- | ------ |
| `electron_node/electron-node/main/src/model3-runtime/model3-checkpoint-registry.ts` | Default → S3 PRODUCTION; Synthetic → CANDIDATE rollback |
| `electron_node/electron-node/main/src/model3-runtime/model3-types.ts` | `MODEL3_EXPECTED_*` → S3 seals |
| `electron_node/electron-node/main/src/model3-runtime/model3-inference-client.ts` | Comments + `MODEL3_LABEL` → S3 |
| `electron_node/services/model3_runtime/model3_inference_host.py` | `DEFAULT_*` / omitted-hash mode → S3 |
| `electron_node/electron-node/main/src/model3-runtime/model3-checkpoint-registry.test.ts` | **NEW** promotion identity tests |

**NOT modified:** `model3-retry-router.ts`, Retry geometry, FineSpan, Recall, Lexicon, Domain, Assembly, KenLM, ASR, training, weights.

---

## DOCUMENTS_UPDATED

| Document | Change |
| -------- | ------ |
| `MODEL3_ARCHITECTURE_CONTRACT_V1.md` | Runtime default S3; Retry ACTIVE; RETRY-OFF struck SUPERSEDED |
| `model3_retry_contract_v1.md` | `ACTIVE + FROZEN` / `PRODUCTION_RETRY_ENABLED=YES` |
| `Model3_V2_Frozen_Architecture_SSOT.md` | Terminology + promotion seal |
| `model3_v2_freeze_manifest.json` | Runtime default / rollback / Retry ACTIVE |
| `Model3_V2_Final_Acceptance_and_Freeze_Report.md` | Promotion note; wiring deferred CLOSED |
| `RECOVERY.md` | HISTORICAL; Synthetic = rollback only |
| `MODEL3_SYNTHETIC_V1_ACCEPTANCE_SEAL.json` | `HISTORICAL_SUPERSEDED_FOR_RUNTIME_DEFAULT` |

## DOCUMENTS_SUPERSEDED

| Document / statement | Class |
| -------------------- | ----- |
| “Production RETRY remains OFF until enablement gate” | SUPERSEDED (was active SSOT; now struck) |
| `KNOWN_DEFERRED_ELECTRON_DEFAULT_STILL_SYNTHETIC_V1` | CLOSED |
| Synthetic V1 as Electron production default | SUPERSEDED by S3 runtime default |

Evidence audits (promotion audit, causal audits) remain **EVIDENCE**, not Architecture SSOT.

---

## Acceptance gates

| Gate | Result |
| ---- | ------ |
| `npm run build:main` | PASS |
| Targeted Jest | 9 suites / **61** passed / 0 failed / 0 skipped |
| No-env identity smoke | S3 + weights/config SHA match |
| Retry files untouched | YES |
| Anti-test-gaming | No case-ID / oracle selection added |
| Architecture drift (this delta) | NONE (identity + docs + tests only) |

### Smoke (no-env)

```text
selectedModelId = MODEL3_V2_S3_RANDOM_INIT_V1
weightsSha = f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1
configSha  = 8c181cb95ab159f5c35c47dc417e527946bf5d0f9614cb83b37a62ab7f01f221
```

---

## SSOT conflict check

Active architecture docs: **no** bare active “Production RETRY remains OFF”.  
Only SUPERSEDED strikethrough / historical seal notes remain.

`ACTIVE_SSOT_CONFLICT_COUNT = 0`  
Details: `model3_v2_ssot_consistency_check.csv`

---

## Next phase (do not continue Model3 development)

`LINGUA_ASR_POSTPROCESS_FULL_PIPELINE_QUALITY_ACCEPTANCE_AUDIT`

Lexicon / NO_REPAIRABLE_TARGET / downstream owners surface there — **not** via Model3 reopen.
