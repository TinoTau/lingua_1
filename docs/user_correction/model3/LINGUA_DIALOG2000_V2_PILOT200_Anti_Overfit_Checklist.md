# LINGUA_DIALOG2000_V2_PILOT200 — Anti-Overfit Checklist

**Status:** FROZEN with Pilot200 SSOT  
**Dataset:** `LINGUA_DIALOG2000_V2_PILOT200` V1  

Use this checklist at **dataset build validation** and again before **baseline run**. Any FAIL blocks baseline.

---

## 1. Lexical isolation (HARD)

- [ ] `PROFILE_BUILD_TERMS ∩ EVALUATION_TARGET_TERMS = ∅` for every Model2 generalization-eligible case
- [ ] Holdout evaluation target terms do not appear in any Pilot profile history build sets
- [ ] Intersection non-empty → `DATASET_BUILD_FAIL`

## 2. No known-answer / reference gaming

- [ ] No `expectedWrongAsrText` / `expectedReplacement` / `expectedFinalText` in schema or fixtures
- [ ] No known-answer correction map
- [ ] No reference-driven candidate injection in production or Pilot harness
- [ ] Reference texts frozen **before** ASR; no rewrite-after-ASR loop

## 3. No production / harness test leaks

- [ ] No `caseId` branches in production Model2/Recall/Assembly/KenLM paths
- [ ] No dataset-specific lexicon patch from Pilot failures
- [ ] No `testOnlyModel2Profile` / `model2ProfileOverride` bypass of SessionBootstrap
- [ ] `training/model3_error_text` not used as Pilot main audio path

## 4. Relation / domain / user / speaker decoupling

- [ ] No relation↔domain 1:1 binding (each used relation spans ≥2–3 domains)
- [ ] No userId↔domain monopoly
- [ ] No userId reduced to a single lexical dictionary
- [ ] If multi-voice: no relation↔voice binding; if single voice: record `SPEAKER_GENERALIZATION_NOT_TESTED`

## 5. Wrong-profile control integrity

- [ ] Wrong profile never contains evaluation answer term
- [ ] Wrong profile does not share the case’s target dominant relation (else invalid → re-pick)
- [ ] Wrong profiles preferentially taken from other simulated users (U001–U005)

## 6. Clean controls

- [ ] ≥20% CLEAN / NON-TARGET (~40/200)
- [ ] Clean cases exercised under NO / CORRECT / WRONG profile sampling for overcorrection checks

## 7. Holdout / train isolation

- [ ] Split DEV120 / VAL60 / HOLD20 tagged in manifest
- [ ] Holdout used aggregate-only during any tuning (no case-answer rules)
- [ ] Pilot200 **never** enters Model2 training / finetune / hard-negative mining

## 8. ASR / audio validity

- [ ] Main path = reference → pronunciation tool → TTS → real Faster-Whisper
- [ ] No regenerate-until-desired-ASR-error
- [ ] Audio identity (`sha256`, size, rate, channels, duration) complete
- [ ] Same-seed metadata assignment deterministic; audio_hash recorded if TTS nondeterministic

## 9. Lexicon freeze

- [ ] Lexicon unchanged during Pilot build and baseline
- [ ] Missing targets → `TARGET_NOT_IN_LEXICON` / not eligible for useful-expansion metric — **no auto-add**

## 10. Metric honesty

- [ ] No pre-set PROFILE_GAIN / FULL_RESCUE numeric pass gates before first baseline
- [ ] Useful expansion requires Base-miss + Lexicon-present + relation-relevant + Model2-add
- [ ] Quality gain with pool explosion reported as `QUALITY_GAIN_WITH_EXPANSION_COST`

## 11. Old dialog_200 quarantine

- [ ] Old `dialog_200` not mutated into Pilot corpus
- [ ] Old baseline identity preserved as P0/regression only

## 12. Sign-off

| Gate | Pass? | Owner | Date |
|------|-------|-------|------|
| MANIFEST_VALID | | | |
| PROFILE_LEXICAL_ISOLATION_PASS | | | |
| RELATION_DISTRIBUTION_PASS | | | |
| DOMAIN_DECONFOUND_PASS | | | |
| NO_KNOWN_TEST_LEAK | | | |
| AUDIO_IDENTITY_COMPLETE | | | |
| REFERENCE_FROZEN | | | |

```text
RELATION GENERALIZATION > LEXICAL MEMORIZATION
DATASET VALIDITY > MODEL SCORE
```
