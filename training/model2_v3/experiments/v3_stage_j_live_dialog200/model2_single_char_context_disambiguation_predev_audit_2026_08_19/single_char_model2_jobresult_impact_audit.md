# JobResult impact audit

**JobResult change required:** NO

`inference-service.ts` `JobResult` is cross-service transport (`text_asr`, translation, TTS, quality extras). Model2 runtime types are already documented as internal-only.

Single-char disambiguation state (candidate set, selected index, abstain) must not be added to JobResult for convenience.

| Consumer | Needs candidate set? |
|----------|----------------------|
| Agent result sender | NO |
| NMT | NO (uses repaired `text_asr`) |
| TTS | NO |
| Quality extras | NO |

**Proposal:** internal types only. Observation traces may mirror existing `MODEL2_DIALOG200_TRACE` pattern (pass-through, no identity/ranking change) under a later observation ACP — not this round.
