# Model3 V2 Frozen Architecture SSOT (Index)

**Authority class:** `FROZEN ARCHITECTURE`  
**Freeze version:** `MODEL3_V2_FREEZE_20260907_V1`  
**Runtime promotion:** `MODEL3_V2_RUNTIME_DEFAULT_PROMOTION_DELTA` (2026-09-08)  
**Status:** `MODEL3_V2 = FROZEN` · `MODEL3_RETRY_SUBCHAIN = ACTIVE + FROZEN` · `MODEL3_DEVELOPMENT_PHASE = CLOSED`

This document is the **index** for Model3 V2 freeze + runtime default alignment. It does **not** replace Level-1 companion contracts.

---

## Document classes

| Class | Meaning |
| ----- | ------- |
| **FROZEN ARCHITECTURE** | Must not be changed implicitly; ACP + user approval required |
| **ACCEPTED IMPLEMENTATION** | Current code accepted against frozen contracts |
| **EVIDENCE** | Audits, counts, dumps — observations only |
| **DEFERRED ISSUE** | Known external/residual items; not Model3 reopen triggers by themselves |
| **HISTORICAL / SUPERSEDED** | Old seals/reports; not active SSOT |

---

## Terminology (required)

| Term | Value after promotion |
| ---- | --------------------- |
| `AUTHORITATIVE_MODEL_ARTIFACT` | `MODEL3_V2_S3_RANDOM_INIT_V1` |
| `RUNTIME_DEFAULT_MODEL` | `MODEL3_V2_S3_RANDOM_INIT_V1` |
| `EXPLICIT_ROLLBACK_MODEL` | `MODEL3_SYNTHETIC_V1` (via `MODEL3_CHECKPOINT_IDENTITY` only) |

Do **not** use bare `AUTHORITATIVE_MODEL` without artifact/runtime context.

---

## Authoritative frozen documents

| Document | Class | Role |
| -------- | ----- | ---- |
| `MODEL3_ARCHITECTURE_CONTRACT_V1.md` | FROZEN ARCHITECTURE | Model3 role, limits, Retry ACTIVE, ACP |
| `model3_retry_contract_v1.md` | FROZEN ARCHITECTURE | Retry meaning; ACTIVE + FROZEN |
| Companion anchor/input/output contracts | FROZEN ARCHITECTURE | Unchanged neighbor contracts |
| `model3_v2_freeze_manifest.json` | ACCEPTED IMPLEMENTATION | Artifact identity + gates |
| `model3_v2_runtime_promotion_acceptance.json` | ACCEPTED IMPLEMENTATION | Runtime default promotion seal |
| `Model3_V2_Final_Acceptance_and_Freeze_Report.md` | ACCEPTED IMPLEMENTATION | Responsibility freeze narrative |

---

## Identity seal

```text
modelId:          MODEL3_V2_S3_RANDOM_INIT_V1
weightsSha256:    f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1
configSha256:     8c181cb95ab159f5c35c47dc417e527946bf5d0f9614cb83b37a62ab7f01f221
datasetId:        MODEL3_V2_PRODUCTION_CORE_S3
datasetBuildId:   prod_core_s3_build_20260830_v1
seed:             2026083013
```

A1: **REJECTED / NON-PROMOTED**.  
Load failure: **FAIL_CLOSED** (no silent Synthetic fallback).

---

## Runtime Retry SSOT

```text
PRODUCTION_RETRY_ENABLED = YES
MODEL3_RETRY_SUBCHAIN = ACTIVE + FROZEN
```

On legal non-anchor RETRY: one bounded local reinterpretation. No ASR / second Model3 / second Domain Vote / Anchor cross / second mainline.

~~Production RETRY remains OFF~~ — **SUPERSEDED** (not active SSOT).

---

## Evidence (not architecture)

Causal audits, Delta acceptances, promotion audit — **EVIDENCE**.

---

## Post-freeze / post-promotion protection

Downstream Lexicon / Recall / FineSpan / Assembly / KenLM / ASR / Model2 changes **must not** automatically retrain or expand Model3.

Model3 reopen requires `PROVEN_MODEL3_OWNED_BREAKPOINT` + ACP when ownership/semantics change.

Retry architecture reopen (Delta1/Delta2) **FORBIDDEN** without independent architecture evidence + ACP. Query effectiveness ≠ architecture reopen.

---

## Full ASR postprocess pipeline freeze (2026-09-10)

| Item | Status |
| ---- | ------ |
| Phase | `MODEL3_FULL_ASR_PIPELINE_FREEZE_AND_NEXT_OPTIMIZATION_AUDIT` |
| Verdict | `MODEL3_FULL_ASR_PIPELINE_FREEZE_PASS_NEXT_AUDIT_SELECTED` |
| Full mainline architecture | **FROZEN** |
| FineSpan / Domain flow / KenLM responsibilities | **FROZEN** |
| Candidate cap ≤16 | **RETAINED** |
| Quality baseline | `LINGUA_DIALOG200_BASELINE_V1` (`RUN_ID=dialog200_full_pipeline_20260909_001141`, RAW 25 → FINAL 31, +6, CER↓, CORRECT_BROKEN=0) |
| Stale attributions (do not use) | Lexicon=143 · Query=100 · NO_LOCAL=59 · Recall=14 · Assembly=2 |
| Next ONE audit | `PARTIAL_IMPROVEMENT_TO_FULL_RESCUE_AUDIT` |
| Refs | `Model3_Full_ASR_Pipeline_Final_Freeze_Audit.md` · `Lingua_Dialog200_Baseline_V1.json` · `Lingua_Next_Optimization_Decision.md` |

**No production code** in the freeze phase. Future deltas: one module · one semantic change · compare to BASELINE_V1.
