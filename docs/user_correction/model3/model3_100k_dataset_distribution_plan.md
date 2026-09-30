# Model3 100k Dataset Distribution Plan

**Status:** PLAN (blocked on `BASE_CORPUS_GAP`)  
**Sample unit:** `MODEL3_TRAINING_SAMPLE_V1` utterance sequences

---

## 1. Soft target

~100,000 samples (± quality-first; **do not** relax validators to hit exact count).

---

## 2. Evidence-level mix (intent)

| evidenceLevel | First 100k intent | Note |
|---------------|-------------------|------|
| `SYNTHETIC_TEXT` | Majority allowed for bootstrap | Acoustic channels ABSENT + masks |
| `TTS_ASR` | Planned minority / next corpus | Required before “full” Model3 claim |
| `HUMAN_ASR` | Optional early / later | Same schema |

**DATASET_LIMITATION:** first labeled synthetic batch may be **Domain-anchor primary** with `model2AnchorStatus=UNAVAILABLE`.

---

## 3. Label mix (intent — not forced balance)

| Class | Intent |
|-------|--------|
| RETRY | Phonetic repairable positives with reachability YES |
| KEEP | Clean + non-repairable + hard negatives |
| MASKED | All Anchors |
| EXCLUDE | Unknown / unprobeable |

Rough research guidance (not quotas): prefer **more KEEP than RETRY**; retain hard negatives & contrast groups; single corruption > double; corruptionCount ≤ 2 for synthetic text track unless later contract expands.

---

## 4. Corruption families

Reuse `ACTIVE_SET_V1` / `BOUND_FEATURES_V1` only for V1 phonetic track.  
Optional small `ORTHOGRAPHIC_DE_DI_DE` as NON_PHONETIC KEEP material.  
Tone optional only when lexicon-realizable — do not force.

---

## 5. Split

| Split | Approx share |
|-------|--------------|
| train | 80% |
| dev | 10% |
| test | 10% |

Group by `sourceSentenceId` / `contrastGroupId`.  
dialog_200: **EVALUATION_ONLY**.

### Held-out axes (tag when feasible)

- held_out_source_sentence  
- held_out_surface_pair  
- held_out_corruption_variant  
- held_out_domain  
- held_out_anchor_combination  
- held_out_pronunciation_family (subset OOD if enough volume)

---

## 6. Unique base plan

| Phase | Unique bases | Samples |
|-------|--------------|---------|
| Blocked | ~9.8k only | Do not scale to 100k |
| After remediation | ≥15k–25k | Then scale variants toward ~100k |

Max average variants per base should stay modest; report duplication / surface-pair leakage.

---

## 7. Local-LM risk mitigation (distribution)

1. Reserve budget for future TTS_ASR shards in the same schema.  
2. Cap pure SYNTHETIC_TEXT as the **only** long-term train diet.  
3. Include NON_REPAIRABLE / orthographic KEEP hard negatives.  
4. Train recipe: channel masks + optional text-channel dropout (Stage3).
