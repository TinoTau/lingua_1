# MODEL3 Synthetic V1 — FROZEN

**Status:** `MODEL3_SYNTHETIC_V1_FROZEN`  
**Frozen:** 2026-08-26  
**Role correction:** 2026-08-26 — `MODEL3_V1_TEXT_ONLY_ROLE_FREEZE_CORRECTION`  
**Seal:** `MODEL3_SYNTHETIC_V1_ACCEPTANCE_SEAL.json` (checkpoint / metrics identity unchanged)

---

## 1. Role (frozen — text-only)

**Model3 = Anchor-Conditioned Text Repair Trigger**  
(equivalently: **Anchor-Conditioned Span Retry Trigger**)

Model3 is a **TEXT-ONLY** post-ASR repair trigger.

It consumes:

- ASR-derived text / FineSpan representation  
- upstream-provided **Anchor** markings  

It outputs, for **NON-ANCHOR** spans only:

- `KEEP` — leave span as-is  
- `RETRY` — request **one bounded local re-recall** attempt  

### Model3 does NOT

| Forbidden | Note |
|-----------|------|
| Consume raw audio | Not an acoustic model |
| Consume FW audio timestamps | Upstream only |
| Consume acoustic Tone tensors | Tone stays upstream (Recall / Tone contracts) |
| Require TTS training | TTS is **not** a Model3 V1 stage |
| Discover / modify / remove Anchors | Upstream ownership |
| Promote non-anchor → Anchor | Forbidden |
| Output corrected text / candidates / domain / sentence | Not a corrector |

Tone / pronunciation / acoustic evidence may influence **upstream** ASR post-processing / Recall per those modules’ contracts. They are **not** Model3-owned inputs.

### Selective cost

Model3 is a **lightweight** KEEP/RETRY decision. It must **not** make every utterance slower. Expensive work happens **only** when `RETRY` is emitted (bounded local re-recall).

### Anchor ownership

| Plane | Allowed sources |
|-------|-----------------|
| Runtime | `MODEL2` only (= authorized **PROFILE_PRONUNCIATION**; ACP `LINGUA-ACP-ANCHOR-DOMAIN-EVIDENCE-AUTHORITY-V1`) |
| Training construction only | `SIMULATED_TRAINING` (provenance — **never** runtime enum / JobResult / model-visible) |

Domain / SameDomain / PROFILE_DOMAIN do **not** create Anchors. Domain candidates remain for Vote / SameDomain / Assembly / KenLM.

Anchors are marked **before** Model3. Model3 receives the mask; it does not re-select Anchors.

### Authoritative pipeline (mainline — 2026-08-27)

```text
Audio
  → ASR
  → ASR raw text
  → FineSpan / first Recall
  → Compatibility
  → Model2 expansion
  → build PRE-RETRY FineSpan candidate pool
  → Domain Vote (ONCE — frozen)
  → retainedDomains / SameDomain
  → materialize Model3 Anchors (MODEL2 = PROFILE_PRONUNCIATION only; ACP Domain Evidence Authority V1)
  → Model3 KEEP / RETRY (text + Anchor mask; ONE infer / path)
  → RETRY spans only: ONE bounded local re-recall (recallSpanTopKV2;
       domainIds = vote.retainedDomains; Anchor never RETRY)
  → rebuild / refresh candidate pool if mutated
  → Domain-aware Assembly using SAME frozen Domain Vote
  → buildSentenceCandidates
  → cross-path merge ≤16
  → KenLM
  → Apply
```

**Mainline status:** Direct integration active (`MODEL3_V1_MAINLINE_INTEGRATION`).  
**No shadow / dual pipeline / permanent enable flag.**  
**Vote frozen / pool refreshable** after RETRY.  
**Rollback:** `MODEL3_V1_MAINLINE_INTEGRATION_ROLLBACK_MANIFEST.json` (manual; no auto-rollback).

Domain candidate ≠ Domain Anchor. **Domain evidence does not create Model3 Anchors** (ACP Domain Evidence Authority V1). Domain Vote `retainedDomains` remain for SameDomain / Assembly.

---

## 2. Model identity (unchanged)

| Field | Value |
|-------|-------|
| Model ID | `MODEL3_SYNTHETIC_V1` |
| Architecture | Small BiGRU |
| Parameters | 237,698 |
| Size / RAM | ~0.91 MB / ~8.91 MB |
| Authoritative seed | **2026082520** |
| Checkpoint | `training/model3_dataset/model3_v1_full100k_strict_integration_ckpts/seed_2026082520/` |
| Pointer | `training/model3_dataset/model3_v1_synthetic_v1_frozen/POINTER.json` |
| Weights SHA256 | `9d25234a5be81aa7281687e90612c6aa17322e23ec4c8be6861c72999524b815` |
| Config SSOT | `training/model3_dataset/configs/model3_v1_training_config.json` |
| Config hash | `f32e3de456696798e71a1b28287a19beed7ff0905ec2056282c9b65c16222830` |
| Dataset manifest | `…/model3_v1_full100k_strict_integration/integration_split_manifest.json` |
| Dataset hash | `b028a8f63385d04331186369f47d6cfaed9ca07474a7137d2b4bf0b96c395432` |

**Selection rule:** multi-metric (Precision / Recall / F1 / Strict Pair / Strict−Shuffle gap / Heldout Family). Seed `2026082521` rejected (Strict Pair 0.7443 < 0.80) despite highest Precision.

---

## 3. Training SSOT (frozen — unchanged)

| Knob | Frozen value |
|------|--------------|
| Main CE | unweighted (`class_weight_retry=1.0`) |
| Auto class weight | **OFF** |
| Pair CE | **OFF** |
| Pair loss | **PURE_MARGIN** |
| λ / margin | **0.2 / 0.25** |
| Sampling | STRICT 30% · Hard KEEP 30% · NATURAL 25% · NO_ANCHOR 15% |
| Hardcoded critical params | **NONE** |
| Silent defaults | **NONE** |

Trainer may only read `model3_v1_training_config.json`. No silent fallback / dataset-count-driven objective rewrite.

STRICT exposure must include KEEP+RETRY with symmetric member exposure.  
**Regression:** STRICT KEEP that also carries Hard KEEP tag **must retain STRICT membership**.

---

## 4. Data contracts (frozen — unchanged)

| Contract | Identity |
|----------|----------|
| Strict Pair | `STRICT_ANCHOR_CONTRAST_PAIR_V1` |
| Hard KEEP | `ANCHOR_CONDITIONED_HARD_KEEP_V1` |
| Feature allowlist | `MODEL3_V1_MODEL_VISIBLE_FEATURE_ALLOWLIST` (6 dims — **ACOUSTIC count = 0**) |
| Sample schema | `MODEL3_TRAINING_SAMPLE_V1` |
| Label | RETRY only via Stage2 + production-equivalent Recall + `referenceReachable=YES` |

**Model plane:** text / Anchor-derived allowlist only.  
**Label/QA plane only:** reference, reachability, repairability, corruption metadata, intendedRole, provenance, any acoustic/Tone fields stored in schema.

---

## 5. Acceptance baseline (unchanged)

`SYNTHETIC_V1_ACCEPTANCE_BASELINE` (Full100K Strict Integration, 3-seed mean):

| Metric | Mean |
|--------|-----:|
| Precision | 0.9921 |
| Recall | 0.9457 |
| F1 | 0.9683 |
| False RETRY | 0.000034 |
| Strict Pair | 0.8358 |
| Anchor Zero | 0 |
| Anchor Shuffle | 0.1668 |
| Hard KEEP | 1.0 |
| NO_ANCHOR FP | 0 |
| Heldout Family F1 | 0.5794 |
| Unseen Surface F1 | 0.9916 |
| Unseen Context F1 | 1.0 |
| CPU p95 | ≈4.55 ms |

Authoritative checkpoint (seed 2026082520): F1 0.9688 · Strict Pair 0.8979 · Heldout Family 0.6142 · False RETRY 4.98e-5.

---

## 6. Closed governance issues (anti-regression only)

1. Label leakage  
2. Anchor-not-used / weak causality  
3. Fake Strong  
4. Pair CE double-count  
5. STRICT KEEP swallowed by Hard KEEP  
6. Auto class-weight drift  
7. **Role drift:** interpreting Model3 as acoustic / TTS / Tone-input model — **REJECTED** (2026-08-26)

---

## 7. Known limitations

- Heldout pronunciation family remains the primary residual gap (~0.58 F1 mean).  
- Training evidence is synthetic **text** / phonetic construction — not a claim of acoustic Model3.  
- **Mainline wiring (2026-08-27):** Model3 is **directly integrated** into the authoritative post-ASR path (`MODEL3_V1_MAINLINE_INTEGRATION`). Production KEEP/RETRY decisions are active. Full-pipeline effectiveness is validated via dialog_200 acceptance (not offline F1).
- **Runtime feature contract (2026-08-27):** `pinyin_channel_avail` = utterance-level `pinyinTextDerived` (`globalSyllables.length > 0`); `first_pass_cand_log1p` = `log1p(PathFineSpan.candidates.filter(!isCovered).length)`. Per-span logit trace (`keep_logit`, `retry_logit`, `margin`) exposed in Model3 diagnostics. **Effectiveness remains UNPROVEN** (dialog_200 real errors score strongly KEEP after contract correction).

---

## 8. Roadmap (current authority)

```text
Synthetic V1 Frozen
  → Runtime Integration Audit
  → Direct Mainline Integration
  → dialog_200 Full Pipeline Acceptance
  → Runtime Trigger Error Audit
  → Runtime Feature Contract Correction + Trace Validation
  → Real ASR Error Dataset Audit
  → Real-distribution RETRY pilot dataset (recommended; no large-scale gen yet)
```

**Superseded (do not use):** Shadow Integration as the default next step.

**Not** the default next phase: TTS Model3 / `MODEL3_V1_TTS_ASR_PILOT_DATASET_DEVELOPMENT`.

TTS may remain relevant to Model2 / ASR / Tone experiments — **not** as required Model3 V1 progression.

Changing input modality (e.g. adding acoustic Tone tensors), Anchor ownership, KEEP/RETRY semantics, or Recall ownership requires an **Architecture Change Proposal** + explicit user approval.

**Forbidden:** overwrite Synthetic V1 checkpoint; retune V1 objective in place; invent alternate Model3 roles without ACP.

---

## 9. How to verify freeze identity

See `RECOVERY.md` — confirm config hash, model hash, dataset hash, contracts, allowlist (ACOUSTIC=0), and `MODEL3_SYNTHETIC_V1_ACCEPTANCE_SEAL.json`.
