# Model2 V3 Development Report (2026-08-16)

## Architecture correction

User-confirmed: **Trainable Model2 core is REQUIRED**.

Previous `MODEL2_NEURAL_COMPONENT_NOT_NEEDED` is reclassified as:

`CURRENT_RELATION_ACTIVATOR_FAILED_TO_ADD_VALUE` / `SUPERSEDED_BY_USER_ARCHITECTURE_DECISION`

Deterministic expansion = primitive + teacher + baseline — **not** a replacement for Model2.

## What was built

- Contracts under `training/model2_v3/contracts/`
- Action space + teacher utility search
- Profile-set encoder policy model (`RetrievalPolicyV3`)
- Dataset with SAME_SPAN_DIFFERENT_USER / multi / high-cardinality slices
- Cost & scalability evaluation vs exhaustive B1

## Key metrics

| | TIR | Query mean | Cand mean | Lat P50 |
|--|-----|------------|-----------|---------|
| B0 | 0.0 | 0.0 | 0.0 | 0.0012999807950109243 |
| B1 exhaustive | 1.0 | 1.0 | 3.2413793103448274 | 46.732199989492074 |
| V3 policy | 1.0 | 1.0 | 3.2413793103448274 | 59.989400004269555 |

Recall retained: 0.681  
Query reduction: 0.347  
E2E cost proxy reduction: 0.326

SameSpanDifferentUser: PASS  
Params: 28354

## HOLD

Tone / Node / 50k / Stage B remain HOLD.
