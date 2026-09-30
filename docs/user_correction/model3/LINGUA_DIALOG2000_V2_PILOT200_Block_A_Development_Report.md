# LINGUA_DIALOG2000_V2_PILOT200 — Block A Development Report

**Phase:** `LINGUA_DIALOG2000_V2_PILOT200_BLOCK_A_DATASET_BUILDER_DEVELOPMENT`  
**Verdict:** `LINGUA_DIALOG2000_V2_PILOT200_BLOCK_A_DATASET_FROZEN`  
**Build ID:** `build_20260911_010554`  
**Seed:** `20260911`  
**Generator:** `pilot200-builder-v1`

---

## Scope executed

```text
BLOCK A ONLY — dataset built + validated + frozen
Block B / Block C / profile-aware baseline = NOT RUN
MODEL2 / MODEL3 / RETRY / LEXICON = UNCHANGED
```

---

## Files added

| Path | Role |
|------|------|
| `training/dialog2000_v2_pilot200/` | Offline Pilot Dataset Builder package |
| `…/constants.py` | Dataset identity, seed, user assignments |
| `…/allocation_loader.py` | Frozen CSV → 200 slots |
| `…/term_banks.py` | Build/eval disjoint lexical banks + templates |
| `…/profile_delta_offline.py` | Gateway-matching EMA ProfileDelta apply |
| `…/profile_builder.py` | P0–P3 correction-history profiles |
| `…/lexicon_readonly.py` | Read-only sqlite lookup / mutation guard |
| `…/audio_pipeline.py` | Corruptor → Piper / PhonemeRealizer fallback |
| `…/validators.py` | Freeze gates |
| `…/build.py` | CLI materializer |
| `…/tests/test_block_a.py` | Block A validity tests |
| `test wav/LINGUA_DIALOG2000_V2_PILOT200/**` | Frozen dataset corpus |

## Files modified

```text
NONE in production Model2 / Model3 / Retry / Lexicon paths
```

Design freeze docs under `docs/user_correction/model3/` were **inputs**, not rewritten except this Block A report + summary.

---

## Reused assets

| Asset | Path |
|-------|------|
| PronunciationCorruptorV1 | `training/model2/pronunciation/corruptor.py` |
| PhonemeRealizer / PronunciationRealizer | `training/model2/pronunciation/` |
| ACTIVE_SET_V1 | `training/model2_v2/runtime/active_set.py` + relation-direction SSOT |
| Piper TTS HTTP | `electron_node/services/piper_tts` `:5009` |
| restore-dialog200 pattern | `scripts/test-corpus/restore-dialog200-full.py` (16k mono + identity) |
| ProfileDelta EMA semantics | mirrored from `central_server/api-gateway/src/profile_delta.rs` |
| UserProfileV1 shape | production schema fields only |
| Lexicon sqlite | `node_runtime/lexicon/v3/lexicon.sqlite` **read-only** |
| Allocation / Schema / SSOT | frozen Pilot200 design artifacts |

---

## Generator architecture

```text
Case_Allocation.csv
        ↓
  200 AllocationSlots
        ↓
reference materializer (domain templates + eval terms)
        ↓  REFERENCE FROZEN
profile history → offline ProfileDelta EMA → UserProfileV1 (P0–P3)
        ↓
audio: reference → Corruptor/PhonemeRealizer → Piper → wav + sha256
        ↓
manifest + validators (hard gates)
```

No new service / DB / queue / production API.

---

## Profile-history construction

- Preferred path: **synthetic correction events → offline ProfileDelta EMA → UserProfileV1**
- P0 = empty profile
- P1/P2/P3 = increasing distinct lexical terms × repeats on dominant relations only
- Strength weights: mild=0.40 / moderate=0.70 / strong=1.00 (EMA weight, not hand-written bias floats as sole definition)
- Build terms come from per-relation **build** banks; eval terms from disjoint **eval** banks

---

## Audio generation path

```text
CLEAN: reference → Piper /tts
TARGET: Corruptor surface (preferred) → Piper /tts
        else PhonemeRealizer HTTP → wav
```

Observed backends:

| Backend | Count |
|---------|------:|
| CORRUPTOR_SURFACE_PIPER | 135 |
| PHONEME_REALIZER | 23 |
| PIPER_TTS_SURFACE (clean) | 42 |
| perturbationFailed | 0 |

No regenerate-until-ASR-error loop. No text-only ASR injection main path.

---

## Dataset identity

```text
dataset_id = LINGUA_DIALOG2000_V2_PILOT200
version    = V1
build_id   = build_20260911_010554
seed       = 20260911
output     = test wav/LINGUA_DIALOG2000_V2_PILOT200/
```

---

## Counts

| Metric | Value |
|--------|------:|
| CASE_COUNT | 200 |
| U001–U005 | 40 each |
| DEV / VALIDATION / HOLDOUT | 120 / 60 / 20 |
| CLEAN_PRESERVE | 42 |
| PROFILE_TARGET | 117 |
| WRONG_PROFILE_CONTROL | 26 |
| ASR_RESILIENCE_CONTROL | 15 |
| P0 / P1 / P2 / P3 | 42 / 52 / 53 / 53 |

### Relations

`n_l=33, z_zh=20, ch_c=20, sh_s=39, eng_en=20, in_ing=13, h_f=13`

### Domains

`general_daily=43, food_cafe=36, software_meeting=33, travel_hotel=32, medical=30, retail_service=26`

---

## Audio identity status

```text
AUDIO_IDENTITY_COMPLETE = PASS
wav_count = 200
fields = audioId, byte_size, sha256, sample_rate, channels, duration
SPEAKER_GENERALIZATION_NOT_TESTED (single Piper voice)
```

---

## Validator results

All hard gates **PASS**:

- MANIFEST_VALID
- PROFILE_LEXICAL_ISOLATION_PASS (`build=42`, `eval=96`, intersection=0)
- RELATION_DISTRIBUTION_PASS
- DOMAIN_DECONFOUND_PASS (≥2–6 domains per relation)
- NO_KNOWN_TEST_LEAK
- AUDIO_IDENTITY_COMPLETE
- REFERENCE_FROZEN

Also PASS: CASE_COUNT_STRUCTURE, SPLIT_COUNTS, CLEAN_MIN, ACTIVE_RELATIONS_ONLY, WRONG_PROFILE_VALID, HOLDOUT_ISOLATION, OLD_DIALOG200_UNCHANGED

---

## Lexical isolation / holdout

```text
PROFILE_BUILD_TERMS ∩ EVAL_TARGET_TERMS = ∅  (case + global)
HOLDOUT eval terms ∩ profile build universe = ∅
```

---

## Lexicon / production freezes

| Check | Result |
|-------|--------|
| LEXICON_MUTATION | 0 (query_only; mutation attempt blocked) |
| TARGET_NOT_IN_LEXICON_COUNT | 89 (retained; not eligible for future USEFUL_EXPANSION) |
| MODEL2_CHANGE | 0 |
| MODEL3_CHANGE | 0 |
| RETRY_CHANGE | 0 |
| PRODUCTION_SEMANTIC_CHANGE | 0 |
| OLD_DIALOG200_CHANGED | NO |

---

## Tests

```text
python -m unittest training.dialog2000_v2_pilot200.tests.test_block_a -v
→ 10 OK (allocation, isolation fail-gate, generalization structure, lexicon RO, seed determinism, …)
```

---

## Known limitations

1. Single Piper voice → mechanism dataset only; speaker generalization not tested  
2. Offline ProfileDelta is EMA-parity helper (not live Gateway process); blobs are valid UserProfileV1 JSON for SessionBootstrap  
3. 89 eval targets missing from lexicon — expected under Lexicon freeze; flagged, not auto-added  
4. `in_ing` / `h_f` opportunity counts lower than largest relations (allocation-driven; still multi-domain)  
5. No ASR smoke baseline in this phase (`SMOKE_ONLY_NOT_BASELINE` N/A — audio compatibility via successful TTS write only)

---

## Final verdict

```text
LINGUA_DIALOG2000_V2_PILOT200_BLOCK_A_DATASET_FROZEN

DATASET BUILT
DATASET VALIDATED
DATASET FROZEN

ONE_NEXT_PHASE =
LINGUA_DIALOG2000_V2_PILOT200_BLOCK_B_PROFILE_AWARE_RUNNER_DEVELOPMENT
```

Do **not** modify this dataset to chase Model2 scores.
