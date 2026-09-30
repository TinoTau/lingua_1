# Controlled Stage P V1 Reproduction Plan (Experiment P1)

**Goal:** Change **only** legacy hash → `MODEL2_FEATURE_HASH_V1`, keep frozen Stage P refine recipe otherwise identical.  
**No joint training. No architecture change. No runtime change.**

## Must match frozen recipe

1. Dataset: `policy_phase2/rows.jsonl` + same baseline candidate index  
2. Train construction: `train` + hard_any_recover **×3** concat; weights hard=5 else 1; sampler cap 8000  
3. Labels: `top1_labels` from refine script (teacher soft) — **not** raw multi-hot `label_actions`  
4. Loss: BCE(pos≤30) + **1.25×pairwise(margin=0.75)** + **0.25×CE(qb)**  
5. Model: `RetrievalPolicyV3(with_domain_head=False)`  
6. Init: Phase2 ckpt if available, else random (document); **do not** load Stage J domain-head weights  
7. Optim: Adam **lr=3e-4**, **12 epochs**, CPU  
8. Decode: qb=1, no applicability bonus  
9. Feature pack: `pack_batch_inputs(..., feature_hash="v1")` **only intentional change**

## Evaluation contract (must be dual-reported)

Report **both** denominators:

| Slice | Definition |
|-------|------------|
| A_freeze_parity | `is_hard_multi && any_recover` (all splits) — historical freeze shape |
| B_heldout | variant∈HARD_VARIANTS && split∈{test,val} — Stage J shape |

Use Stage P metric formulas:

- Hit = `tid ∈ new_ids`
- RR = TIR_V3 / TIR_B1
- B1 queries = sum `execute_action.n_queries`
- E2E = Q + 0.2C + 0.001*Latency_P50

## Success / failure interpretation

| Outcome | Conclusion |
|---------|------------|
| A_freeze_parity RR ≥ 0.95 under V1 | Hash migration alone is viable; Stage J gap was **reproduction**, not hash collapse |
| A fails, B fails, Top2≫Top1 | Still Top-1 ranking / recipe issue under V1 |
| Unique/entropy collapse in features | Revisit FEATURE_HASH_INFORMATION_LOSS (current audit: **NO**) |

## Explicitly out of scope for P1

- D rows / domain head  
- Joint loss  
- Capacity increase  
- Runtime wiring  

## Then Experiment D1 (no model train)

1. Align hit semantics: document tid vs surface  
2. Measure teacher execution hit under both  
3. Decide FuzzyPool surface-dedup policy for `domain:` vs `base:` siblings  
4. Rebuild eligible D-only slice: base-absent ∧ domain-relevant ∧ execute-recoverable  
5. Only then allow Experiment J1 joint training
