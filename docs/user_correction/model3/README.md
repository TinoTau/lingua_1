# Model3 README (Synthetic V1)

**Current status:** `MODEL3_SYNTHETIC_V1_FROZEN` (2026-08-26)  
**Role:** Anchor-Conditioned **Text** Repair Trigger (text-only; corrected 2026-08-26)

## Role

Post-ASR **text** trigger: given FineSpan + upstream **Anchor** mask, decide **KEEP / RETRY** on **non-anchor** spans.

`RETRY` = request **one bounded local re-recall** (not corrected text).

**Selective:** lightweight decision always; expensive work only on `RETRY`.

## Inputs (TEXT_ONLY)

- ASR-derived FineSpan surfaces + geometry  
- Upstream Anchor mask (`DOMAIN` / `MODEL2` / `DOMAIN_AND_MODEL2`)  
- Model-visible allowlist only: `MODEL3_V1_MODEL_VISIBLE_FEATURE_ALLOWLIST` (**ACOUSTIC = 0**)

**Not inputs:** raw audio · FW timestamps · acoustic Tone tensors · TTS metadata.

## Outputs

Per eligible non-anchor span: `KEEP` | `RETRY`  
(Mainline: direct integration active as of 2026-08-27; dialog_200 acceptance is the effectiveness gate.)

## Does not own

ASR, Anchor detection, Domain Vote, Model2, Tone, candidate generation, assembly, KenLM, re-recall execution (RETRY only *requests* it).

## Training contracts

| Item | Path / ID |
|------|-----------|
| Architecture | `MODEL3_ARCHITECTURE_CONTRACT_V1.md` |
| Freeze SSOT | `MODEL3_SYNTHETIC_V1_FROZEN.md` |
| Dataset | `MODEL3_TRAINING_DATASET_V1_CONTRACT.md` |
| Schema | `MODEL3_TRAINING_SAMPLE_V1_SCHEMA.json` |
| Strict Pair | `STRICT_ANCHOR_CONTRAST_PAIR_V1` |
| Hard KEEP | `ANCHOR_CONDITIONED_HARD_KEEP_V1` |
| Config SSOT | `training/model3_dataset/configs/model3_v1_training_config.json` |
| Authoritative trainer | `training/model3_dataset/train/train_full100k_strict_integration.py` |

## Checkpoint

- Pointer: `training/model3_dataset/model3_v1_synthetic_v1_frozen/POINTER.json`
- Weights: `…/full100k_strict_integration_ckpts/seed_2026082520/weights.pt`
- Seal: `MODEL3_SYNTHETIC_V1_ACCEPTANCE_SEAL.json`
- Freeze doc: `MODEL3_SYNTHETIC_V1_FROZEN.md`

## Recovery

See `RECOVERY.md`.

## Next stage / roadmap

```text
Synthetic V1 Frozen
  → Runtime Integration Audit
  → Direct Mainline Integration
  → dialog_200 Full Pipeline Acceptance
  → Acceptance Freeze OR targeted audit OR rollback decision
```

**Superseded:** Shadow Integration as default next step.

TTS Model3 training is **not** the default next phase.  
Historical TTS audit: `MODEL3_TTS_READINESS_AUDIT_2026_08_26.md` → **`SUPERSEDED_FOR_MODEL3`** (`ROLE_DRIFT_CORRECTED`).

## Historical reports

Phase reports under `Lingua_Model3_V1_*` are **evidence only**. See `documentation_authority_matrix.csv`.
