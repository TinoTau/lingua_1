# Lingua Model3 V1 Loss Weight & Effective Gradient Audit

**Date:** 2026-08-25  
**Phase:** `MODEL3_V1_LOSS_WEIGHT_AND_EFFECTIVE_GRADIENT_AUDIT`  
**Verdict:** `PASS_FINDING`

## Parameter drift

| Item | Value |
|------|------:|
| Strict Reconstruction `class_weight_retry` | 2.616099 |
| HardKeep Balance `class_weight_retry` | 3.0 |
| Formula | `min(3.0, max(1.5, sqrt(n_keep/n_retry)*0.35))` |
| Raw on HardKeep train | 4.0035 → capped **3.0** |
| Raw on Strict-only train | 2.6161 → 2.6161 |

**3.0 Source:** hardcoded formula cap in `train_strict_hardkeep_balance.py` (same as Pilot/Strict recon).  
**Intentional user decision:** **NO** · **Unauthorized drift:** **YES** (`UNAUTHORIZED_TRAINING_PARAMETER_DRIFT`)

Adding ~48k Hard KEEP increased `n_keep`, so the auto formula hit the 3.0 ceiling—despite the balance phase instruction to keep the current retry weight first.

## Loss equation (from code)

```
Main batch:
  L_ce = mean_eligible CrossEntropy(logits, y; weight=[1.0, w_retry])

Per epoch after all batches (up to 800 pairs):
  L_pair = CE(keep_logit, KEEP)*1.0
         + CE(retry_logit, RETRY)*w_retry
         + 0.35 * relu(P_retry(keep) - P_retry(retry) + 0.25)
  → separate Adam step per pair
```

**Critical:** STRICT RETRY is optimized by weighted CE in the main loop **and again** in pair CE (same `w_retry`). Hard KEEP only sees CE×1.0 once.

## Effective sample weight (ordinary KEEP = 1.0)

| Type | w=3.0 + pair | w=2.616 + pair |
|------|-------------:|---------------:|
| Ordinary / Hard / Natural / NO_ANCHOR KEEP | 1.0 | 1.0 |
| Strict KEEP | 1.171 | 1.171 |
| Strict RETRY | 3.514 | 3.065 |

## Sampler (Balance D mix)

Configured: STRICT 30% / Hard KEEP 30% / NATURAL 25% / NO_ANCHOR 15%

Actual row shares (1 epoch): `{"STRICT_RETRY": 0.3009, "ANCHOR_HARD_KEEP": 0.2992, "NO_ANCHOR": 0.1495, "NATURAL": 0.2504}`

**Critical sampler bug:** `STRICT_KEEP` share = **0**. STRICT KEEP members were also registered in the Hard KEEP sidecar, and `build_index` prioritizes Hard KEEP → they are **removed from the STRICT bucket**. Configured “30% STRICT” is effectively **~30% STRICT RETRY only**. Pair fine-tune still sees KEEP sides, but main CE sampling does not co-emit them as STRICT pairs.

## Prior chain

| Stage | RETRY mass/ratio |
|-------|-----------------:|
| Raw eligible | 0.007585 |
| Sampled | 0.018399 |
| Class-weighted share | 0.0532 |
| Pair-adjusted share | 0.0553 |

## Gradients (random init, one batch)

Dominant component: **RETRY_CE**  
KEEP CE total=2.6227 · RETRY CE=7.2967 · Pair CE=4.6490 · Margin=0.1700

## Logit shift

| Bucket | Strict Recon mean / p90 | HardKeep Winner mean / p90 |
|--------|------------------------:|---------------------------:|
| STRICT RETRY logit | 2.85 / 3.32 | **5.92 / 6.25** |
| Natural KEEP | -0.79 / 0.64 | -1.41 / **1.60** (max 2.76→5.65) |
| NO_ANCHOR KEEP | -0.84 / -0.46 | -0.87 / 0.66 (max 0.05→**2.58**) |

Diagnosis: **GLOBAL_RETRY_PRIOR_SHIFT** (RETRY head amplified; KEEP tails / NO_ANCHOR max RETRY logit explode)

## Ablations (subset, 2 epochs, same mix)

| Ablation | Precision | False RETRY | Strict Pair | Strict Zero | Hard KEEP Acc |
|----------|----------:|------------:|------------:|------------:|--------------:|
| current 3.0+pair | 0.0110 | 0.0362 | 0.9950 | 0.0000 | 0.0000 |
| 2.616+pair | 0.0095 | 0.0484 | 0.0000 | 0.0000 | 0.0000 |
| 1.0+pair | 0.0138 | 0.0509 | 0.9950 | 0.0000 | 0.0000 |
| 2.616 no-pair | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 |
| 1.0 no-pair | 0.5870 | 0.0002 | 0.2050 | 0.0000 | 0.0000 |
| 2.616 pair margin0.1 | 0.0066 | 0.2466 | 0.8675 | 0.0000 | 0.0000 |

Best diagnostic: **w1.0_pair_off**

## Root cause

- **Primary:** `COMBINED_OBJECTIVE_OVERWEIGHT` / `CONFIG_DRIFT_PLUS_DOUBLE_COUNTING`
- **Secondary:** unauthorized 3.0 cap · pair CE double-counts main CE · **STRICT KEEP swallowed into Hard KEEP bucket** · Hard KEEP CE under-powered vs STRICT RETRY
- Hard KEEP volume/quality: **NOT** the primary failure mode
- Ablation signal: `w=1.0 + pair OFF` raises Precision to ~0.59 (subset) but collapses Strict Pair → need **rebalance**, not delete pair loss

## Decision

- Balance failure explained: **YES**
- Safe to fix without architecture change: **YES**
- Small BiGRU problem: **NO**
- Next: `MODEL3_V1_OBJECTIVE_REBALANCE`

## STOP

No full retrain · No new Hard KEEP · No mix retune · No TTS · No runtime change. Awaiting user review.
