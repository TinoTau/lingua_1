# Lingua Model2 — Piper Phoneme Realization Audit

| Field | Value |
|-------|-------|
| Date | 2026-08-13 |
| Scope | Training-only accent / non-lexical pronunciation |
| Production voice | `zh_CN-huayan-medium` |
| Production contract | `POST /tts` **unchanged** |

---

## 1. Current Piper service version

- Service: `electron_node/services/piper_tts`
- Production voice config: `phoneme_type = espeak`, `espeak.voice = cmn`
- `piper_version` in onnx.json: `1.0.0`
- Sample rate: 22050

## 2. HTTP contract (production)

`POST /tts` body:

```json
{ "text": "...", "voice": "zh_CN-huayan-medium" }
```

Returns WAV. No phoneme / SSML / lexicon override fields.

## 3. ChinesePhonemizer implementation

`chinese_phonemizer.py` + `lexicon.txt` path exists for **vits-zh-aishell3** style models:

```text
char → [initial, final, #0] → sil + … + sp + … + eos → phoneme_id_map → VITS ONNX
```

**Important:** production huayan voice does **not** use this path.  
`synthesis.py` only enters ChinesePhonemizer when model path contains `vits-zh-aishell3`.  
Current `/voices` lists only huayan → **espeak frontend**.

## 4. Phoneme sequence representation (huayan)

`PiperVoice.phonemize(text)` returns espeak-ng CMN tokens, e.g.:

| Char | Pinyin | Espeak phonemes |
|------|--------|-----------------|
| 奶 | nai3 | `n ˈ a i 2` |
| 来 | lai2 | `l ˈ a i ɜ` |
| 乃 | nai3 | `n ˈ a i 2` |
| 中 | zhong1 | `t s . ˈ o n ɡ 5` |
| 宗 | zong1 | `t s ˈ o n ɡ 5` |

Tone markers are **espeak tone symbols**, not pinyin tone digits (`2` ≈ pinyin tone 3 for these probes).

## 5. Tone representation

- Stored in espeak stream as tone symbols (`2`, `ɜ`, `5`, …) interleaved with phones
- Not a separate model input channel
- Accent generator V1 policy: **PRESERVE** tone markers when swapping initials/finals

## 6. Inference input

Huayan / standard Piper:

```text
phonemes → phonemes_to_ids (with PAD) → phoneme_ids_to_audio → WAV
```

VITS-aishell3 (not production):

```text
phoneme_ids → ONNX inputs x / x_length / sid / noise scales
```

## 7. Bypass text frontend?

**Yes**, for training:

```text
phoneme_ids_to_audio(phonemes_to_ids(custom_phonemes))
```

PoC: replace `n`→`l` in `请读奶` phonemes → ASR `請讀來` vs canonical containing 奶.

## 8. Minimal training-only implementation

Added (production `/tts` untouched):

| Endpoint | Role |
|----------|------|
| `POST /tts-phonemize` | text → espeak sentences |
| `POST /tts-pronunciation` | phonemes → WAV |

Also: local fallback in `PhonemeRealizer` loading the same onnx (training process), so probe works even before HTTP service restart.

## 9. Production contract impact

| Item | Impact |
|------|--------|
| `POST /tts` | **None** |
| Web / Node TTS callers | **None** |
| New endpoints | training-only; not required for runtime |

## 10. nai3 → lai3 PoC feasibility

| Result | Value |
|--------|-------|
| Feasible? | **YES — PHONEME_REALIZED** |
| Method | Espeak initial swap on huayan |
| Lexical char for lai3 | Not required |
| ASR evidence (carrier) | canonical≈奶 / corrupted≈来 |

`lai3` is `LEXICALLY_UNREALIZABLE` as a common surface, but **not** `ACOUSTICALLY_INVALID`.

## 11. Risks

1. Espeak tone marker mapping is empirical; tone corruption still DEFER
2. Final transforms (an↔ang) via token rewrite are heuristic — need per-family validation
3. HTTP training endpoints require Piper service reload to become live
4. Local PiperVoice load may contend GPU with the running service
5. ChinesePhonemizer/aishell3 must not be confused with production huayan path

## 12. Recommended implementation

1. **KEEP** ChineseSurfaceRealizer for stable lexical corruptions  
2. **USE** PhonemeRealizer (espeak override) for non-lexical / rare-surface cases  
3. **DO NOT** gate transforms on dictionary presence  
4. **DO NOT** change production `/tts`  
5. Prefer restarting Piper once so `/tts-pronunciation` is available; until then local fallback is acceptable for offline probes  

---

## Verdict

Phoneme-level realization on **current production huayan model** is feasible without rewriting production TTS.  
`nai3→lai3` PoC: **PHONEME_REALIZED**.
