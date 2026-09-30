# Model3 Minimum Trace Contract (proposal — audit only)

**Contract id:** `MODEL3_RETRY_TRACE_V1`  
**Scope:** internal / env-gated (mirror Model2 dialog200 pattern). **Not JobResult by default.**

## Per utterance

- `utteranceId`, `sessionId`, `retryPassId` (0 | 1)
- `model3TriggerGate`: `{ fired: boolean, reasons: string[] }`
- `model3Invoked`: boolean (max 1)
- `retainedDomains[]`

## Per span (`fineSpanId`)

- `surface`, `rawStart`, `rawEnd`, `syllableStart`, `syllableEnd`
- `anchor`: boolean
- `anchorSource`: `DOMAIN` | `MODEL2` | null
- `domainBucket`: string | null
- `pinyinEvidence`: `{ windowPinyinKey, textDerived: true }`
- `toneEvidence`: `{ readiness, acousticTonePattern?, toneCompatible?, tonePenalty? }`
- `model2Evidence`: `{ selectedActions?, retrievalProvenance?, originSpanId? }`
- `model3Decision`: `KEEP` | `RETRY` | `SKIPPED_ANCHOR` | `NOT_RUN`
- `reRecall`: `{ ran: boolean, candidateSurfaces?: string[] }`

## Post-retry

- `assemblyCandidateCount`
- `kenlmInputCount` (≤16)
- `kenlmPickText`
- `finalText`

## Training export

Offline JSONL builder reads `MODEL3_RETRY_TRACE_V1` + dialog_200 reference → KEEP/RETRY labels.
