# Model3 Synthetic V1 — Recovery / Identity Check

**Status:** `HISTORICAL / SUPERSEDED` for runtime default (2026-09-08).  
**Current runtime default:** `MODEL3_V2_S3_RANDOM_INIT_V1`  
**This document:** Synthetic V1 freeze identity + text-only role checklist.  
**Synthetic role now:** `EXPLICIT_ROLLBACK_MODEL` only (`MODEL3_CHECKPOINT_IDENTITY=MODEL3_SYNTHETIC_V1`).

~~Not: a runtime enablement guide (production RETRY remains OFF).~~ — **SUPERSEDED**; `PRODUCTION_RETRY_ENABLED = YES`.

## 1. Quick identity checklist

| Check | Expected |
|-------|----------|
| Model ID | `MODEL3_SYNTHETIC_V1` |
| Status | `MODEL3_SYNTHETIC_V1_FROZEN` |
| Role | Anchor-Conditioned **Text** Repair Trigger |
| Input modality | `TEXT_ONLY` |
| Acoustic model-visible inputs | **0** |
| Seed | `2026082520` |
| Checkpoint dir | `training/model3_dataset/model3_v1_full100k_strict_integration_ckpts/seed_2026082520/` |
| Pointer | `training/model3_dataset/model3_v1_synthetic_v1_frozen/POINTER.json` |
| Acceptance seal | `docs/user_correction/model3/MODEL3_SYNTHETIC_V1_ACCEPTANCE_SEAL.json` |

## 2. Required hashes

Compute / compare against seal:

```text
config_sha256  = f32e3de456696798e71a1b28287a19beed7ff0905ec2056282c9b65c16222830
  (via training.model3_dataset.train.config_loader.load_training_config()["config_hash"])

model_sha256   = 9d25234a5be81aa7281687e90612c6aa17322e23ec4c8be6861c72999524b815
  (SHA256 of seed_2026082520/weights.pt)

dataset_sha256 = b028a8f63385d04331186369f47d6cfaed9ca07474a7137d2b4bf0b96c395432
  (integration_split_manifest.json → manifest_hash)
```

## 3. Contracts that must match

- `MODEL3_ARCHITECTURE_CONTRACT_V1` (text-only role)
- `STRICT_ANCHOR_CONTRAST_PAIR_V1`
- `ANCHOR_CONDITIONED_HARD_KEEP_V1`
- `MODEL3_V1_MODEL_VISIBLE_FEATURE_ALLOWLIST` — 6 dims, no acoustic
- `MODEL3_TRAINING_SAMPLE_V1` / dataset contract
- Training objective: PURE_MARGIN · λ=0.2 · margin=0.25 · cw=1.0 · Pair CE OFF · Auto weight OFF · sampling 30/30/25/15

## 4. Role gates

| Gate | Expected |
|------|----------|
| Audio input | NO |
| Tone direct input | NO |
| FW timestamp direct input | NO |
| TTS required for Model3 V1 | NO |
| Model3 discovers Anchor | NO |
| Next phase | `MODEL3_V1_RUNTIME_TEXT_PIPELINE_INTEGRATION_AUDIT` |

## 5. Automated gate

```bash
python -m unittest training.model3_dataset.train.test_synthetic_v1_freeze_governance
python -m unittest training.model3_dataset.train.test_full100k_strict_integration_governance
```

## 6. Authoritative vs historical

| Use | Do not use as current |
|-----|------------------------|
| `MODEL3_SYNTHETIC_V1_FROZEN.md` | Acoustic / TTS Model3 roadmap |
| `MODEL3_ARCHITECTURE_CONTRACT_V1.md` | `MODEL3_TTS_READINESS_AUDIT_2026_08_26.md` as next phase |
| `MODEL3_SYNTHETIC_V1_ACCEPTANCE_SEAL.json` (hashes/metrics) | Diet_B / HardKeep_Broken / leaked F1=1.0 |
| Role correction report 2026-08-26 | Seal `nextStageBoundary` TTS wording (historical; do not retune seal) |

## 7. If hashes diverge

Treat as **FREEZE_IDENTITY_BROKEN**. Do not silently retune.  
Restore from seal paths or open an Architecture / Training Change Proposal.

If Model3 is described as acoustic / Tone-input / TTS-required without ACP → **ROLE_DRIFT**.
