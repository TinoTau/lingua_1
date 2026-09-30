# Lingua — Model3 V2 RealDist Model Training & Validation

**Phase:** MODEL3_V2_REALDIST_MODEL_TRAINING  
**Date:** 2026-08-29  
**Production architecture changed:** NO  
**V1 / V2 baselines overwritten:** NO  
**RealDist auto-promoted:** NO

---

## MAIN VERDICT

| Field | Verdict |
|-------|---------|
| **Checkpoint verdict** | **REALDIST_MODEL_ACCEPTED_CANDIDATE** |
| **Distribution hypothesis** | **SUPPORTED** |
| **Ready for promotion** | **NO** |
| **Full Electron mainline** | **FULL_MAINLINE_VALIDATION_PENDING_CHECKPOINT_PROMOTION_PATH** |
| **Next phase** | **MODEL3_V2_REALDIST_ACCEPTANCE_AND_PROMOTION_AUDIT** |

Correcting the known TRAIN RETRY HEAD/MID distribution gap **materially** improved real RETRY case recall (**1/13 → 7/13**) while KEEP controls stayed clean (**0/6** false RETRY). No HEAD/MID “RETRY everywhere” shortcut observed. Synthetic test metrics remained strong and slightly improved. Promotion path still blocked by production checkpoint hash lock — offline acceptance only in this phase.

---

## CONTROLLED EXPERIMENT

| Variable | Status |
|----------|--------|
| Only major changed variable | **TRAINING DATA DISTRIBUTION** |
| Architecture | NO |
| Features (6) | NO |
| Labels (V2 contract) | NO |
| Class weight | NO (`class_weight_retry=1.0`) |
| Threshold | NO |
| Sampling | NO (`uniform_shuffle_utterance`) |
| Pair loss | OFF |
| Init | random from scratch (new seed) |

---

## TRAINING

| Item | Value |
|------|-------|
| Dataset | `MODEL3_V2_REALDIST_EXPANDED_V1` |
| Path | `training/model3_dataset/model3_v2_realdist_expanded_v1/` |
| Samples | **119,318** (train 84,203 / dev 12,175 / test 22,940) |
| Expansion | +4,900 (~4.28%) over V2 labeled |
| Model | **MODEL3_V2_REALDIST_V1** |
| Seed | **2026082903** |
| Architecture | Small BiGRU (emb 64 / hidden 128 / feat 6) |
| Epochs | 8 (best by dev RETRY F1 = **epoch 6**) |
| Batch / Opt / LR | 64 / Adam / 0.001 |
| Class weight RETRY | 1.0 |
| Duration | ~1292 s CPU (~21.5 min) |
| Checkpoint | `training/model3_dataset/model3_v2_realdist_v1_ckpts/seed_2026082903` |
| Weights SHA256 | `fbb8d85dc4bec117af510a9d8f0a5021a86187a1e1490ee63f9b66831bad648e` |

Preserved:

- V1: `MODEL3_SYNTHETIC_V1` / `seed_2026082520`
- V2: `MODEL3_V2_REGION_LABEL_V1` / `seed_2026082901`

---

## TEST METRICS (RealDist held-out test)

| Metric | Value |
|--------|-------|
| KEEP precision | 0.9993 |
| KEEP recall | 0.9998 |
| RETRY precision | 0.9797 |
| RETRY recall | 0.9450 |
| RETRY F1 | **0.9620** |
| Confusion | TP 4912 / FP 102 / FN 286 / TN 414809 |
| true RETRY rate | 0.01237 |
| predicted RETRY rate | 0.01193 |

Classifier behavior:

| Flag | Value |
|------|-------|
| ALL_KEEP | **NO** |
| NEAR_ALL_KEEP | **NO** |
| OVER_RETRY | **NO** |

---

## V2 BASELINE VS REALDIST

| metric | V2 baseline | RealDist | delta |
|--------|-------------|----------|-------|
| test RETRY precision | 0.9714 | 0.9797 | +0.008 |
| test RETRY recall | 0.9370 | 0.9450 | +0.008 |
| test RETRY F1 | 0.9539 | 0.9620 | +0.008 |
| test pred RETRY rate | 0.0105 | 0.0119 | +0.001 |
| real case RETRY | **1 / 13** | **7 / 13** | **+6** |
| real case recall | 0.077 | **0.538** | **+0.462** |
| KEEP false RETRY | 0 / 6 | 0 / 6 | 0 |
| offline latency ms/utt | 4.28 | 4.39 | +0.11 |
| dialog_200 non-anchor +margins | 2 | 26 | +24 |

Diagnostic (same RealDist test labels): V2 weights RETRY F1 = 0.883 vs RealDist 0.962 — expansion samples are what V2 under-covers.

---

## REAL HIGH RETRY

**Cases:** 13 (same inventory; HIGH/MEDIUM eligible)  
**Metric:** case-level any non-anchor RETRY in utterance (primary)

| | Count |
|--|-------|
| V2 baseline RETRY | **1 / 13** (~7.7%) |
| RealDist RETRY | **7 / 13** (~53.8%) |
| Probe-surface RETRY (secondary) | **2 / 13** (d002, d160) |
| Improved vs V2 | d002, d003, d019, d160, d181, d195 (+ d179 retained) |
| Regressed | none |

Per-case (primary path FineSpan probe):

| case | pos | expected | V2 | V2 margin | RD probe | RD margin | RD case RETRY | RD any RETRY |
|------|-----|----------|----|-----------|----------|-----------|---------------|--------------|
| d002 | TAIL | RETRY | KEEP | -11.78 | **RETRY** | **+2.10** | 1 | 背:+2.10 |
| d003 | HEAD | RETRY | KEEP | -13.31 | KEEP | -15.94 | **1** | 烧:+0.82 |
| d019 | HEAD | RETRY | KEEP | -11.95 | KEEP | -12.98 | **1** | 上:+4.42 / 限:+2.31 / 计:+0.09 |
| d049 | HEAD | RETRY | KEEP | -13.05 | KEEP | -2.23 | 0 | — |
| d099 | HEAD | RETRY | KEEP | -3.98 | KEEP | -7.81 | 0 | — |
| d131 | HEAD | RETRY | KEEP | -13.88 | KEEP | -7.37 | 0 | — |
| d139 | MID | RETRY | KEEP | -15.88 | KEEP | -16.24 | 0 | — |
| d142 | MID | RETRY | KEEP | -16.49 | KEEP | -15.87 | 0 | — |
| d160 | MID | RETRY | KEEP | -18.92 | **RETRY** | **+3.26** | **1** | 顺:+3.26 / 向:+1.87 / 木:+1.50 |
| d176 | HEAD | RETRY | KEEP | -13.86 | KEEP | -7.26 | 0 | — |
| d179 | HEAD | RETRY | KEEP* | -12.01 | KEEP | -5.89 | **1** | 全:+3.23 / 四:+1.67 |
| d181 | MID | RETRY | KEEP | -15.56 | KEEP | -9.50 | **1** | 温:+0.92 |
| d195 | MID | RETRY | KEEP | -16.05 | KEEP | -17.16 | **1** | 对:+7.24 |

\*V2 case-level RETRY via other span `四:+4.53` (same methodology as prior phase).

Improved families include PHONETIC, MULTI_CHAR, and INSERTION — not a single-family artifact.

Remaining misses concentrate on several MULTI_CHAR HEAD/MID and some INSERTION probes; margins often moved upward but stayed KEEP.

---

## REAL KEEP CONTROL

| | Value |
|--|-------|
| Controls | 6 |
| V2 false RETRY | 0 |
| RealDist false RETRY | **0 / 6** |
| False RETRY rate | **0%** |

KEEP control margins remain strongly negative (RD p50 ≈ −19.8; all < −5). No evidence that HEAD/MID expansion created a positional KEEP→RETRY shortcut on valid controls.

---

## POSITION BEHAVIOR

Position bins (same as expansion: HEAD ≤0.35, MID, TAIL ≥0.7) on **probe span** of eligible cases:

| bin | cases | case RETRY | case KEEP |
|-----|-------|------------|-----------|
| HEAD | 7 | 3 | 4 |
| MID | 5 | 3 | 2 |
| TAIL | 1 | 1 | 0 |

KEEP controls (first-span / HEAD): 6 spans, **0** false RETRY.

**Positional shortcut:** **NOT detected** — HEAD/MID eligible cases are mixed KEEP/RETRY; KEEP controls stay KEEP.

---

## REAL MARGINS

### All dialog_200 non-anchor FineSpans

| | n | min | p50 | p95 | max | +count | \|m\|&lt;1 | m&lt;−5 |
|--|---|-----|-----|-----|-----|--------|----------|--------|
| V2 | 1280 | −22.10 | −14.88 | −9.48 | +4.53 | 2 | 1 | 1268 |
| RealDist | 1280 | −25.08 | −14.93 | −4.26 | +7.24 | **26** | 15 | 1207 |

### RETRY target probe surfaces (n=13)

| | min | p50 | p95 | max | +count | m&lt;−5 |
|--|-----|-----|-----|-----|--------|--------|
| V2 | −18.92 | −13.86 | −11.78 | −3.98 | 0 | 12 |
| RealDist | −17.16 | **−7.81** | **+2.10** | **+3.26** | **2** | 10 |

### KEEP control first spans (n=6)

| | min | p50 | max | +count |
|--|-----|-----|-----|--------|
| V2 | −17.08 | −16.30 | −13.78 | 0 |
| RealDist | −22.80 | −19.80 | −8.77 | 0 |

Desired pattern observed: RETRY-target margins move toward / across zero; KEEP controls remain safely negative.

---

## DISTRIBUTION HYPOTHESIS

**Hypothesis:** V2 real failure was materially caused by TRAIN RETRY being strongly TAIL-biased and under-covering HEAD/MID real error patterns.

**Evidence:**

1. Real case recall **1/13 → 7/13** (material, not 1→2 noise).
2. Target-probe margin p50 **−13.86 → −7.81**; 2 surfaces cross to RETRY; several near-miss margins rise.
3. Multiple error families improve (PHONETIC / MULTI / INSERTION).
4. KEEP false RETRY remains **0/6**; no HEAD/MID RETRY-everywhere pattern.
5. Synthetic F1 stays high (~0.962) — not a synthetic-only win.

**Verdict:** **SUPPORTED**

---

## PERFORMANCE

| Model | offline ms / utterance (n=53) |
|-------|-------------------------------|
| V2 baseline | 4.28 |
| RealDist | 4.39 |

No meaningful latency regression (architecture unchanged).

---

## ARCHITECTURE GOVERNANCE

| Component | Status |
|-----------|--------|
| Model3 architecture | UNCHANGED |
| Feature contract (6) | UNCHANGED |
| Label contract V2 | UNCHANGED |
| FineSpan / Retry / Recall / Lattice | UNCHANGED |
| Domain Vote / Model2 / Assembly / JobResult | UNCHANGED |
| Production business files modified | **0** |
| Checkpoint hash lock | UNCHANGED (not unlocked) |

---

## CHECKPOINT STATUS

| Checkpoint | Status |
|------------|--------|
| MODEL3_SYNTHETIC_V1 | **PRESERVED** |
| MODEL3_V2_REGION_LABEL_V1 | **PRESERVED** |
| MODEL3_V2_REALDIST_V1 | **CANDIDATE** (accepted for promotion audit; not promoted) |

---

## NEXT PHASE

**MODEL3_V2_REALDIST_ACCEPTANCE_AND_PROMOTION_AUDIT**

Do **not** execute in this phase. Scope should cover promotion path / hash lock procedure, FineSpan-alignment nuance (case-level 7/13 vs probe-surface 2/13), and gated full Electron mainline — without reopening architecture or re-expanding training data.

---

## ARTIFACTS

1. `docs/user_correction/model3/Lingua_Model3_V2_RealDist_Training_Validation_2026_08_29.md`
2. `docs/user_correction/model3/model3_v2_realdist_vs_baseline.csv`
3. `docs/user_correction/model3/model3_v2_realdist_real_probe.csv`
4. `docs/user_correction/model3/model3_v2_realdist_training_summary.json`
5. `docs/user_correction/model3/model3_v2_realdist_training_governance.json`

---

## HARD STOP

One RealDist checkpoint trained; held-out + real inventory evaluated; baselines preserved; no retrain / no threshold or class-weight tuning / no promotion / next phase not started. Awaiting user review.
