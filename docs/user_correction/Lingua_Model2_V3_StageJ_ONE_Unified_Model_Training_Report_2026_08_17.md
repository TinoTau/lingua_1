# Lingua Model2 V3 Stage J — ONE Unified Model Training Report
# Date: 2026-08-17
# Label: MODEL2_V3_STAGE_J_ONE_UNIFIED_MODEL_TRAINING

**Mode:** Training + evaluation only. Runtime Skeleton **not** wired. No architecture redesign.

**Artifacts:** `training/model2_v3/experiments/v3_stage_j_unified/`  
**Checkpoint:** `training/stage_j_checkpoint.pt` (ONE file; candidate, not production-ready)

---

## 1. Architecture compatibility

| Check | Result |
|-------|--------|
| Reuse `RetrievalPolicyV3(with_domain_head=True)` | YES |
| New router / gate / MoE / dual Model2 | NO |
| Action space expansion | NO (50 P + 13 D) |
| Parameter increase | **+3.68%** (45533 → 47210) |
| STAGE_J_ARCHITECTURE_COMPATIBILITY_BLOCKER | **NOT raised** (joint training fits current arch) |

---

## 2. Feature contract

- Switched training pack to **`MODEL2_FEATURE_HASH_V1`** via `pack_batch_inputs(..., feature_hash="v1")`.
- Stage P frozen checkpoint remains **legacy-hash BASELINE ONLY** (incompatible with V1).
- Train/prod feature matrix: `stage_j_train_prod_feature_matrix.csv` — session_domain_prior **EXCLUDED**.
- StageDProfileContractV1 (EMA / multitag / TopK lexical) used for synthetic D / P+D rows.

---

## 3. Dataset composition

| Family | Role |
|--------|------|
| P_ONLY | Phase2 subsample (hard-weighted) |
| D_ONLY | Stage D2 rows |
| P_PLUS_D | Hard P + derived multitag domain evidence (EMA confirms 1/5/20) |
| NEUTRAL | Empty profile / domain_none labels |

Manifest: `stage_j_dataset_manifest.json`  
Rows: `training/model2_v3/dataset/policy_stage_j/rows.jsonl`

---

## 4. Training procedure

1. Joint curriculum (P-heavy early epochs → balanced) — 10 epochs / 10k P-train.
2. Recovery: P-only V1 (8 epochs) → short joint (4 epochs).

Loss (centralized): `W_P=1.25`, `W_D=0.55`, `W_QB=0.35` + domain_none pos-weight boost.

---

## 5. Results (headline)

| Gate | Result |
|------|--------|
| ONE checkpoint | YES |
| FEATURE_HASH_V1 | PASS |
| Train/prod parity | PASS |
| Stage P RecallRetained | **0.813** (gate ≥0.95) → **FAIL** |
| Stage P QueryReduction | **0.535** (positive) |
| Stage P CandidateReduction | **0.435** (positive) |
| Stage D real target introduction | **0.0** on D2 slice → **FAIL** (sensitivity was vacuous when both zero) |
| P+D combined proxy | Stronger than empty on combined slice (prior run TIR≈1.0) |
| Param increase | +3.7% (OK, ≪2×) |
| Runtime wired | NO |

Frozen Stage P baseline (legacy hash): RR≈1.0, QR≈51.7%, CR≈36.7%, E2E≈47.0%.

---

## 6. Failure classification (no new modules)

| Class | Evidence |
|-------|----------|
| **FEATURE_CONTRACT** | V1 hash forces full retrain; legacy Stage P weights do not transfer |
| **TRAINING_OBJECTIVE** | Under V1, hard multi-relation Top-1 recover stalls ~0.81 RR after P-only + joint |
| **PROFILE_SIGNAL / RETRIEVAL** | D2 domain execute path yields TIR=0 for selected soft actions on this index |

**Not claimed:** architecture insufficiency. Capacity only +3.7%. No Architecture Change Proposal executed.

---

## 7. Ablation table (systems)

| System | P | D | Trainable | One model |
|--------|---|---|-----------|-----------|
| Base | No | No | No | - |
| Exhaustive (B1) | Yes | - | No | - |
| Stage P Frozen | Yes | No | Yes | Yes (legacy hash) |
| Stage J P-only V1 | Yes | No | Yes | Yes |
| Stage J Full | Yes | Yes | Yes | Yes |

---

## 8. Known limitations

1. Stage P regression not recovered under FEATURE_HASH_V1 within current epochs/capacity.
2. Stage D target-introduction metric is currently non-informative (0/0).
3. Soft domain often appears in top-2 even when top-1 is `domain_none` (budget=2).
4. Wrong/Swapped budget selectivity not optimized (secondary).

---

## 9. Recommended next steps (DATA/LOSS only)

1. Port Stage P **Top-1 refine** procedure under FEATURE_HASH_V1 (same ranking objective family as freeze).
2. Audit D2 teacher `any_recover` vs `execute_domain_action` hit rate (data/retrieval).
3. Rebalance joint loss / sampling after P V1 recovers ≥0.95.
4. Only if (1–3) fail with evidence → `ARCHITECTURE_CHANGE_PROPOSAL` for user approval.
