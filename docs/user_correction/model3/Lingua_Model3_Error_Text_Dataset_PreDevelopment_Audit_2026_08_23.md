# Lingua Model3 — Error-Text Dataset Pre-Development Audit

**Date:** 2026-08-23  
**Stage:** `MODEL3_ERROR_TEXT_DATASET_PREDEVELOPMENT_AUDIT`  
**Verdict:** **PASS**

**Artifacts:** `training/model2_v3/experiments/model3_error_text_dataset_predevelopment_audit_20260823/`  
**Contracts:** `docs/user_correction/model3/model3_error_text_*` + `model3_corruption_taxonomy_v1_proposal.md`

**Scope:** Audit + dataset/generator design only.  
**Not done:** large corpus · TTS · audio · Model3 training · runtime changes.

Model3 role remains: **Anchor-Conditioned Acoustic-Linguistic Repair Trigger** (`KEEP`/`RETRY` only). Error-text corpus is **TRAINING MATERIAL**, not a runtime rule table.

---

## Q1–Q20

**Q1. Clean Chinese dialogue corpora?**  
Primary: `baseline_v1` gt (~10k / ~9775 unique). Also `training_scale_v1`, accent_scale, `carrier_templates_v3`. dialog_200 ~65 unique clean (eval only). Wiki/news for scale only (poor dialogue fit).

**Q2. Real ASR raw ↔ reference?**  
Yes: `baseline_v1/results.jsonl` (~10k, ~8761 unequal), scale/accent/probe sets, dialog_200 Stage-J (~175/200 unequal, **eval**). Model2 `rows.jsonl` are span window↔target, not sentence ASR pairs.

**Q3. Reusable Model2/TTS pronunciation corruption?**  
Reuse: `ACTIVE_SET_V1` (7) + `syllable_substitution` / Node `applyFamilyToSyllable`. Modify: `PronunciationCorruptorV1` shape with sqlite surface resolve. Do not use pypinyin TTS resolver as authority; do not use WEAK/REVERSED/FuzzyPool as V1 primary.

**Q4. Authoritative pinyin/tone tool?**  
`lexicon/phonetic/pinyin.ts` + `tone-pinyin.ts` (**pinyin-pro**). Training must call Node SSOT.

**Q5. Lexicon for corrupted pronunciation → surface?**  
Yes — offline `base_lexicon` via `lookupBaseByPinyinAndToneKey` (readonly). No Model3 lexicon.

**Q6. V1 corruption families?**  
`n_l`, `z_zh`, `ch_c`, `sh_s`, `eng_en`, `in_ing`, `h_f`; optional tagged orthographic 的/地/得; tone only as controlled optional subset with lexicon realization.

**Q7. Historical confusion not to continue?**  
WEAK/REVERSED as primary; tone_bias HOLD as engine; deleted pinyin-probe; pypinyin authority; FuzzyPool; random Hanzi; unverified d/t invent.

**Q8. Polyphonic?**  
Tag + explicit source/target pronunciation provenance; no silent random reading.

**Q9. Avoid random Hanzi?**  
Phonetic-first pipeline + lexicon replacement only; validators reject random/synonym swaps.

**Q10. Phonetic explanation?**  
Each corruption records family + source/target pinyin/tone + replacementSource + generationReason.

**Q11. Clean KEEP samples?**  
`corruptionCount=0` required; `expectedRepairClass=CLEAN`.

**Q12. Non-repairable hard negatives?**  
Keep wrong text with `referenceReachable=NO` / `NON_PHONETIC` / not under retry policy — Stage2 maps to KEEP, not auto-RETRY.

**Q13. Contrast pairs?**  
First-class `contrastGroupId`; same surface / different context; same context ± phonetic corruption.

**Q14. Same-sentence variant leakage?**  
`splitGroupKey` binds `sourceSentenceId` + contrast group; no random row split.

**Q15. Pilot size?**  
**~3000 samples / ~800 base sentences** — quality/QA gate, not final train.

**Q16. 100k / 1M base need?**  
~15–25k bases for 100k; ~80–150k spoken-like (or filtered wiki+) for 1M — dialogue quality remains binding.

**Q17. Minimum new files (future)?**  
`training/model3_error_text/generator/` orchestrator + validators + split assigner (CREATE); thin wrappers only.

**Q18. Must reuse not copy?**  
pinyin/tone SSOT, ACTIVE_SET_V1, direction contract, syllable apply, LexiconRuntime/sqlite lookups.

**Q19. TTS / real ASR bridge?**  
Keep referenceText + corrupted pinyin fields; set `evidenceLevel`; future paths `TTS_ASR` / `HUMAN_ASR` distinct from `SYNTHETIC_TEXT`.

**Q20. Change Model3 runtime contract?**  
**NO.**

---

## Required Verdict Block

```
MODEL3_ERROR_TEXT_DATASET_PREDEVELOPMENT_AUDIT:
PASS
```

```
Model3 Error-Text Dataset Audit:
PASS


================================================
SOURCE DATA
================================================

Clean Corpora:
baseline_v1 gt (~10k); scale/accent; carrier_templates_v3; dialog_200 eval-only (~65 unique)


Real ASR Error Pairs:
baseline_v1 results (~10k); scale/accent/probes; dialog_200 Stage-J (eval)


Usable Base Sentences:
~9775 unique baseline gt (primary)


================================================
PRONUNCIATION
================================================

Authoritative Pinyin Tool:
electron_node/.../lexicon/phonetic/pinyin.ts (+ tone-pinyin.ts) via pinyin-pro


Reusable Confusion Families:
ACTIVE_SET_V1: n_l, z_zh, ch_c, sh_s, eng_en, in_ing, h_f


New Families Required:
d_t / tone map — CREATE later only with evidence (not V1 required)


Polyphonic Strategy:
Tag + explicit source/target pronunciation; no silent random reading


================================================
CORRUPTION V1
================================================

Tone:
OPTIONAL controlled subset with lexicon realization; not Model2 ACTIVE


Initial:
n_l, z_zh, ch_c, sh_s, h_f


Final/Nasal:
eng_en, in_ing


Other:
Optional ORTHOGRAPHIC 的/地/得 tagged non-phonetic


Random Character Replacement:
FORBIDDEN


================================================
DATASET
================================================

Schema:
ERROR_TEXT_SAMPLE_V1


Clean Samples:
REQUIRED


Wrong Samples:
REQUIRED


Non-Repairable Negatives:
REQUIRED


Contrast Pairs:
REQUIRED


Evidence Level:
SYNTHETIC_TEXT


================================================
LABEL
================================================

Error == RETRY:
NO


Final KEEP/RETRY Label:
STAGE2


Repairability:
REQUIRED (referenceReachable YES/NO/UNKNOWN prep)


================================================
GENERATOR
================================================

Existing Code Reusable:
ACTIVE_SET_V1; syllable apply; G2P SSOT; LexiconRuntime/sqlite; CorruptorV1 shape (MODIFY)


New Generator Required:
YES (thin Model3 error-text package)


Runtime Dependency:
NO


Deterministic Seed:
YES


================================================
SPLIT
================================================

Random Row Split:
FORBIDDEN


Group Split:
sourceSentenceId + contrastGroupId (+ domain/family axes)


Dialog200 Training:
NO


================================================
SCALE
================================================

Pilot:
~3000 samples / ~800 bases


100k Plan:
~15k–25k bases from baseline+scale+regen


1M Plan:
~80k–150k spoken-like bases; quality-gated


================================================
TTS
================================================

Current Round:
NO AUDIO


Future Bridge:
READY (schema preserves reference + corrupted pronunciation; evidenceLevel)


================================================
RUNTIME
================================================

Model3 Runtime:
UNCHANGED


Model2:
UNCHANGED


Recall:
UNCHANGED


Domain Vote:
UNCHANGED


Single-Char V1:
UNCHANGED


JobResult:
UNCHANGED


================================================
DECISION
================================================

Safe To Develop Error-Text Generator:
YES


Required Gaps:
None blocking pilot (surface resolve must use sqlite SSOT not pypinyin; Model2 offline Anchor remains UNAVAILABLE — do not forge)


Recommended Next Phase:
MODEL3_ERROR_TEXT_GENERATOR_PILOT_DEVELOPMENT
```

---

## Hard Stop

Audit + design complete. **Do not implement generator / generate 100k / TTS / train / change runtime** until user approval for pilot development.
