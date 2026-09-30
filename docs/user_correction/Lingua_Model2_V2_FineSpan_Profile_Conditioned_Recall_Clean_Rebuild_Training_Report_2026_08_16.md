# Lingua Model2 V2 — Clean Rebuild Training Report (2026-08-16)

Markers: `MODEL2_V2_RECALL` / `CLEAN_REBUILD` / `SUPERSEDES_MODEL2_V1_CLOSED_SET`

## Intent

Stop patching Stage A/B closed-set ranking. Rebuild Model2 as:

```text
FineSpan + UserProfile → expansion activation → lexicon/FuzzyPool → introduce absent targets
```

## What was built

| Artifact | Path |
|----------|------|
| Contracts | `training/model2_v2/contracts/` |
| Dataset | `training/model2_v2/dataset/recall_v1/` |
| Runtime controller | `training/model2_v2/runtime/` |
| Neural activator | `training/model2_v2/model/relation_activator.py` |
| Experiments | `training/model2_v2/experiments/v2_recall_v1/` |

## Dataset

- Primary positives: **target absent from Base FuzzyPool** on FineSpan windows (`NATURAL_BASE_MISS`)
- Provenance: **REAL_ASR** (reported separately; no mixed overall)
- Counterfactuals: Correct / Empty / Wrong / Swapped
- Active set: `ACTIVE_SET_V1` = BOUND; `DEFERRED_RELATIONS` = WEAK + REVERSED (not deleted)
- n_primary=132, n_total_rows=1328

Funnel: `{"raw": 9968, "lexicon_covered": 9968, "finespan_exists": 9968, "target_in_base": 6335, "target_absent_base": 3633, "profile_not_active_set": 2198, "relation_not_applicable": 1303, "relation_applicable": 132}`

## Training

- Objective: multi-label relation activation (not term_id classification)
- Params: 9799 (&lt;500k)
- Tiny overfit: {"final_loss": 8.759880074649118e-06, "eng_en_prob": 0.9999864101409912, "overfit_ok": true, "param_count": 9799}
- Checkpoint: `model2_v2_recall_activator_v1.pt` (does not overwrite Stage A/B)

## Baselines

| Baseline | Correct TIR | Empty TIR | Wrong TIR | Swapped TIR |
|----------|-------------|-----------|-----------|-------------|
| B0 Empty | 0.0000 | — | — | — |
| B1 Deterministic | 0.1750 | 0.0000 | 0.0000 | 0.0000 |
| B2 Neural gate | 0.0000 | 0.0000 | 0.0000 | 0.0000 |

Neural vs deterministic: **NO** → `MODEL2_NEURAL_COMPONENT_NOT_NEEDED`

## Legacy

- Stage A: **ARCHIVED** (not in V2 acceptance path)
- Stage B: **DEFERRED** (post-recall binding only if needed later)
- No legacy checkpoint load / no shadow fallback / no whole-utterance query

## HOLD

Tone / Node / 50k remain HOLD.
