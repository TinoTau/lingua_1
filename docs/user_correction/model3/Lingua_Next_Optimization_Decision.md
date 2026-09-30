# Lingua — Next Optimization Decision

Phase: `MODEL3_FULL_ASR_PIPELINE_FREEZE_AND_NEXT_OPTIMIZATION_AUDIT`  
Date: 2026-09-10

---

## ONE_NEXT_AUDIT

```text
PARTIAL_IMPROVEMENT_TO_FULL_RESCUE_AUDIT
```

Scope: **10–20** cases from `LINGUA_DIALOG200_BASELINE_V1` with outcome `PARTIAL_IMPROVEMENT`.  
Mode: read-only / offline on existing fresh RUN_ID.  
**No production code** in that audit.

Allowed residual classes only:

```text
remaining lexical error
remaining phonetic error
wrong candidate selection
incomplete local repair
multi-error sentence
ASR information loss
unknown
```

---

## WHY_THIS

Baseline shows **60 partial improvements** vs **6 full rescues**.  
That is the clearest, already-measured quality phenomenon.  
A narrow sample audit asks only: *what still blocks exact match after the pipeline already helped?*  
Highest expected information gain; smallest blast radius; dialog_200 comparable.

---

## WHY_NOT_MODEL3

Model3 V2 frozen; TEXT_ONLY KEEP/RETRY; no proven Model3-owned first breakpoint requiring reopen.

---

## WHY_NOT_RETRY_ARCHITECTURE

Retry ACTIVE+FROZEN; Delta1/2 CLOSED. Effectiveness questions must not reopen architecture.

---

## WHY_NOT_LEXICON

`Lexicon=143` is STALE. Corrected evaluator showed **0** proven lexicon gaps. No expansion without new direct missing-term evidence.

---

## WHY_NOT_KENLM

KenLM role frozen as sentence scorer. Cap≤16 retained (pool max 8). No proven KenLM wrong-selection owner as next work.

---

## EXPECTED_INFORMATION_GAIN

Identify whether partial→exact failures cluster into **one** small owner (e.g. incomplete local repair vs multi-error vs ASR loss), enabling a single future semantic delta — or remain `unknown` / multi-error without inventing a new subsystem.

---

## Explicitly not selected (this cycle)

| Candidate | Why deferred |
|-----------|--------------|
| LOCAL_QUERY_EFFECTIVENESS_TARGETED_AUDIT | Needs better query-window evidence first; not the strongest current signal |
| RECALL_MATCHING_TARGETED_AUDIT | No four-condition proven failures |
| FINESPAN_TARGETED_QUALITY_AUDIT | No proven FineSpan bottleneck |
| ASR_UNRECOVERABLE_ERROR_SAMPLE_AUDIT | Useful later; RTF already audited; not first after freeze |
