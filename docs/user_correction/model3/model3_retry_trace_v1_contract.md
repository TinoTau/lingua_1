# MODEL3_RETRY_TRACE_V1 Contract

**Status:** FROZEN (design)  
**Scope:** Internal diagnostic / env-gated only  
**Default JobResult:** **NO CHANGE** — do not embed Model3 fields in cross-service JobResult

---

## Purpose

For every utterance, answer:

> Why was each span Anchor / non-anchor? Why was Model3 invoked? Why did a span RETRY? What did re-recall return? What did KenLM pick?

---

## Utterance-level fields

| Field | Type | Required |
|-------|------|----------|
| `contract` | `"MODEL3_RETRY_TRACE_V1"` | YES |
| `utteranceId` | string | YES |
| `pathId` | string | YES |
| `model3Eligible` | boolean | YES |
| `model3Invoked` | boolean | YES |
| `triggerReasons` | string[] | YES if eligible evaluation ran |
| `retryCycleCount` | 0 \| 1 | YES |
| `retainedDomains` | string[] | YES |
| `finalText` | string | YES when available |
| `kenlmWinnerText` | string \| null | YES when KenLM ran |

---

## Span-level fields

| Field | Type | Required |
|-------|------|----------|
| `spanId` | string | YES |
| `rawSurface` | string | YES |
| `firstPassSurface` | string | YES |
| `isAnchor` | boolean | YES |
| `anchorSource` | NONE \| DOMAIN \| MODEL2 \| DOMAIN_AND_MODEL2 | YES |
| `candidateProvenance` | string \| null | YES |
| `pinyinProvenance` | TEXT_DERIVED_SYLLABLE_KEY \| ABSENT | YES |
| `toneProvenance` | ACOUSTIC_REBIND \| RECALL_CANDIDATE \| ABSENT | YES |
| `toneEvidenceSummary` | object | YES (may be empty) |
| `acousticEvidenceStatus` | AVAILABLE \| PARTIAL \| ABSENT | YES |
| `model2PronunciationEvidence` | object \| null | YES |
| `targetMask` | 0 \| 1 | YES |
| `model3Decision` | KEEP \| RETRY \| SKIPPED_ANCHOR \| NOT_RUN | YES |
| `retryPassId` | 0 \| 1 | YES |
| `reRecallCandidates` | string[] \| null | YES if retry |
| `finalSelectedCandidate` | string \| null | YES when available |

---

## Prohibitions

- No score explosion (`anchorScore`, `suspicionScore`, `contextScore`, …) in V1 business trace.
- Prefer **source / state / action / candidates**.
- Model logits optional under training export only.

---

## KenLM linkage

Trace must reference final sentence candidate set size, winner identity/text, and ranking position when KenLM diagnostics already exist.

---

## Export path

Mirror Model2 dialog200 pattern: env-gated internal JSON / `extra` debug only — **not** JobResult schema change.
