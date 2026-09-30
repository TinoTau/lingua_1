# Lingua Model3 Error-Text Generator Pilot Development Report

**Date:** 2026-08-23  
**Phase:** `MODEL3_ERROR_TEXT_GENERATOR_PILOT_DEVELOPMENT`  
**Authoritative audit:** `Lingua_Model3_Error_Text_Dataset_PreDevelopment_Audit_2026_08_23.md` (PASS)  
**Verdict:** `PASS_WITH_DATA_QUALITY_GAPS`

---

## 1. Scope

Offline training-data preparation only:

- Implement minimal Model3 Error-Text Generator V1
- Generate pilot from `baseline_v1` GT (~800 bases / target ~3000 samples)
- Validate, split, compare to real ASR unequal pairs, emit human QA package

**Not in scope:** Model3 training, TTS/audio, runtime Model3, KEEP/RETRY Stage2 labels, production behavior change.

---

## 2. Implementation

### 2.1 New package

`training/model3_error_text/`

| Path | Role |
|------|------|
| `generator/run_pilot.py` | Orchestrator: sample bases → annotate → corrupt → validate → split → write |
| `generator/corrupt.py` | Annotate + phonetic / orthographic corruption |
| `generator/families.py` | Thin import of `BOUND_FEATURES_V1` / ACTIVE_SET_V1 |
| `generator/lexicon_resolve.py` | Readonly SQLite lexicon surface resolve |
| `generator/validate.py` | Schema / phonetic replay / lexicon / offset / unicode |
| `generator/split.py` | Group split 80/10/10 + leakage checks |
| `tests/` | Determinism, family, reject paths (unittest runner) |

**New generic framework:** NO

### 2.2 Reuse (no copied family maps)

| Concern | Actual path |
|---------|-------------|
| Pinyin / tone SSOT | `training/model2/phonetic/` → `node_syllables_cli.mjs` → pinyin-pro (`PHONETIC_IMPL_NODE`) |
| ACTIVE_SET_V1 | `training/model2/stage_b/active_feature_mask.py` → `BOUND_FEATURES_V1` |
| Syllable transform | `training/model2/pronunciation/syllable_substitution.py` → `apply_family_to_syllable` |
| Lexicon SSOT | `node_runtime/lexicon/v3/lexicon.sqlite` (readonly) via `lookupBaseByPinyinAndToneKey`-equivalent query |
| Schema / contract | `docs/user_correction/model3/model3_error_text_*` |

### 2.3 Production / runtime

- **Production files modified for this phase:** none (generator-only under `training/model3_error_text/` + docs report)
- **Runtime behavior changed:** NO
- **Model3 / Model2 / Recall / Domain Vote / Assembly / KenLM / JobResult / Single-Char V1:** UNCHANGED

---

## 3. Pilot data

| Metric | Value |
|--------|------:|
| Source corpus | `baseline_v1` GT |
| Base sentences | 800 |
| Samples | 2072 |
| Unique samples | 2072 |
| Target | ~3000 (±10%) |
| dialog_200 in train | false |

**Why under target:** Many char×family attempts fail lexicon surface realization or family inapplicability (`skip_no_surface_or_inapplicable` ≈ 49k). Validators were **not** relaxed to pad to 3000 → quality-first → `PASS_WITH_DATA_QUALITY_GAPS`.

### Sample types

| Type | Count |
|------|------:|
| CLEAN | 800 |
| PHONETIC_SINGLE | 935 |
| PHONETIC_DOUBLE | 302 |
| HARD_NEGATIVE_UNREACHABLE | 306 |
| NON_PHONETIC_ORTHOGRAPHIC | 35 |
| CONTRAST_MEMBER (all samples in contrast groups) | 2072 |

### Corruption count

| Count | Samples |
|------:|--------:|
| 0 | 800 |
| 1 | 970 |
| 2 | 302 |
| >2 | 0 |

### Families

| Family | Count |
|--------|------:|
| sh_s | 380 |
| eng_en | 264 |
| ch_c | 263 |
| in_ing | 215 |
| z_zh | 164 |
| h_f | 129 |
| n_l | 124 |
| ORTHOGRAPHIC_DE_DI_DE | 35 |
| CONTROLLED_OPTIONAL_TONE | 0 |

Tone: not safely lexicon-realized at scale → **tone samples = 0** (allowed).

Random Hanzi replacement: **0**  
Max corruptions: **2**

### Split (group by sourceSentenceId / contrastGroupId)

| Split | Count |
|-------|------:|
| train | 1668 |
| dev | 179 |
| test | 225 |

Leakage:

- `sourceSentenceId`: train↔dev / train↔test / dev↔test = **0**
- `contrastGroupId`: **0**
- Surface-pair cross-split: train_dev 48, train_test 50, dev_test 32 → **SURFACE_PAIR_LEAKAGE_RISK** (reported; not acceptance fail)

---

## 4. Validation

| Check | Result |
|-------|--------|
| Schema pass rate | 100% (2072/2072) |
| Phonetic replay | enforced; failures.jsonl empty |
| Lexicon provenance | enforced; failures.jsonl empty |
| Offset replay | enforced; failures.jsonl empty |
| Unexplained duplicates | 0 (dedup in=out=2072) |
| Deterministic reproduction | true (`pilot_deterministic_check.json`) |

Artifacts: `training/model3_error_text/pilot_v1/`

---

## 5. Skips

| Reason | Count / note |
|--------|----------------|
| Polyphonic / align unresolved at sentence annotate | 0 on selected bases |
| No surface / family inapplicable | ~49297 attempt-level skips |
| Same surface | folded into no-surface path / rejected |
| Other | double-apply skips rare |

---

## 6. Real ASR comparison

- **Measurement:** `MEASURED_PARTIAL`
- Unequal pairs flagged in scan: ~8793
- Checked subset for ACTIVE_SET applicability: 1500 → ~1401 (~93%) had planned/applicable family signal
- **Interpretation:** ACTIVE_SET_V1 covers a meaningful phonetic subset of real ASR unequal pairs; not all real errors are pronunciation-family explainable. Synthetic does not need to match non-phonetic ASR noise.

See: `pilot_vs_real_asr_error_comparison.md`, `pilot_vs_real_asr_error_stats.json`

---

## 7. Human QA

- Package: `pilot_human_review_200.csv` (stratified; includes clean / hard-neg / contrast)
- Review columns left blank
- **Human Review:** `HUMAN_QA_PENDING` (no fabricated scores)

---

## 8. Acceptance mapping

PASS criteria 1–24: met except absolute ~3000 sample count (quality-first shortfall).  
→ **`PASS_WITH_DATA_QUALITY_GAPS`**

Gaps:

1. Sample count 2072 < ~2700 lower band of ±10% around 3000
2. Tone optional = 0
3. Type-B contrast volume limited / surface-pair cross-split risk
4. Real-ASR coverage MEASURED_PARTIAL only

---

## 9. Decision

| Item | Value |
|------|--------|
| Pilot Generator Ready | YES |
| Pilot Data Ready For Human QA | YES |
| Safe To Scale Dataset | NO |
| Recommended Next Phase | `MODEL3_ERROR_TEXT_PILOT_HUMAN_QA_AND_ACCEPTANCE` |

**STOP** after this report. Do not scale to 100k, TTS, BiGRU train, Stage2 labels, or runtime retry.
