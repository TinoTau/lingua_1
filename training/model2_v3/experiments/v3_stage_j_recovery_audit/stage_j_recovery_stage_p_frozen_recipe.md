# Stage J Recovery — Frozen Stage P Exact Recipe

**Source of truth:** code + artifacts under `training/model2_v3/experiments/v3_phase3_stage_p/`  
**Authoritative freeze path:** `scripts/run_v3_phase3_stage_p_refine.py` (NOT the initial ranking-comparison loop alone)

## Dataset

| Item | Value |
|------|--------|
| Rows | `training/model2_v3/dataset/policy_phase2/rows.jsonl` |
| Index | `training/model2/dataset/baseline_v1/stage_b_trainrows/candidate_index.jsonl` (+ meta) |
| Train pool | `split==train` **plus** hard-recoverable rows **concatenated ×3** (includes held-out hard → leakage into train) |
| Hard definition (train oversample) | `is_hard_multi && teacher.any_recover` (all splits) |
| Sample weights | hard=5.0 else 1.0 |
| Sampler | `WeightedRandomSampler`, `num_samples=min(len(weights), 8000)`, replacement=True |
| Batch | 64 |

## Feature pack / hash

| Item | Value |
|------|--------|
| Feature pack | `pack_batch_inputs` default |
| Hash | **legacy Python `hash()`** via `hash_span` |
| `feature_hash=` | **not passed** (legacy) |
| Profile | `profile_phonetic` only (no lexical/domain items on frozen Stage P) |
| Applicability in state | ACTIVE_SET_V1 bitmask from profile |

## Model config

| Item | Value |
|------|--------|
| Class | `RetrievalPolicyV3()` |
| `with_domain_head` | **False** |
| Init | Phase2 `model2_v3_phase2_policy.pt`, `strict=True` |
| Params | ~45533 |

## Labels (Top-1 refine)

From `run_v3_phase3_stage_p_refine.py` `top1_labels`:

1. Primary positive: first `single:*` in `teacher.best_utility_actions` → else `best_recall_actions` → else `best_actions` → one-hot **1.0**
2. Up to 2 additional teacher singles soft **0.35**
3. Fallback: original multi-hot `label_actions`

## Loss / objective

**Mode name:** `bce_pairwise_top1` (custom in refine script, not generic `action_objective("bce_pairwise")`)

```
BCEWithLogits(pos_weight clamp ≤ 30)
+ 1.25 * pairwise_action_ranking_loss(logits, ya>0.5, margin=0.75)
+ 0.25 * CrossEntropy(query_budget_logits, label_query_budget_class)
```

Compare generic `bce_pairwise`: pairwise_weight=0.5, margin=0.5.

## Optim / epochs / checkpoint selection

| Item | Value |
|------|--------|
| Optimizer | Adam **lr=3e-4** |
| Epochs | **12** |
| Device | CPU |
| Early stopping | **None** — last epoch weights saved |
| Output | `experiments/v3_phase3_stage_p/training/stage_p_checkpoint.pt` |
| Meta | `phase=stage_p_top1_refine`, `ranking_mode=bce_pairwise_top1` |

Note: `checkpoint_manifest.json` still listing `bce_pairwise` is **stale** relative to the real `.pt` meta.

## Decode / applicability / budgets

| Item | Value |
|------|--------|
| Decode | `sigmoid(action_logits)`; only `kind==single` with all profile relations > 0; sort by raw prob; take Top-`qb` |
| `applicability_bonus` | **False** (removed as HARDCODED_POLICY_OVERRIDE) |
| Operating point | **query_budget=1** |
| Candidate budget | 8 |
| ProfileRetrievalConfig | max_total=8, max_new=8, max_phonetic_queries=1 |
| Hit | `target_term_id ∈` executed `new_ids` (cap 8), not `base∪new` |

## Freeze evaluation slice (RR≈1.0)

| Item | Value |
|------|--------|
| Definition | `is_hard_multi && teacher.any_recover` |
| Variant filter | **None** |
| Split filter | **None** (includes train) |
| Historical n | **197** |
| Metric | `RecallRetained = TIR_V3 / TIR_B1` |
| Frozen metrics | RR≈1.005 (reported as 1.0), QR≈0.517, CR≈0.367, E2E≈0.470 |
| E2E formula | `Q + 0.2C + 0.001*Latency_P50` |
| B1 queries | sum of `execute_action.n_queries` |

## Path that produced freeze

1. Phase2 / Stage P initial training → Top-1 weak (~0.7 RR)
2. Ranking objective comparison in `run_v3_phase3_stage_p.py` (selected `bce_pairwise` early — **not** final freeze point)
3. **`run_v3_phase3_stage_p_refine.py`** Top-1 refine → overwrites checkpoint → freeze artifacts (`stage_p_final_metrics.json`, `go_summary_stage_p.json`, `stage_p_freeze_decision.json`)
