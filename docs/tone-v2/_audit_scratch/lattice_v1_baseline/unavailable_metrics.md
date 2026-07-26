# Unavailable Metrics (Phase 0.5)

Honest gaps — not fabricated. Production instrumentation was forbidden this phase.

| Metric | Status | Reason | Follow-up |
|--------|--------|--------|-----------|
| Per-stage ms: coordinate / coarse / LTR Fine Span separately | NOT AVAILABLE | Orchestrator metrics expose assemblyMs, lexiconRecallTotalMs, domainVoteMs; not split LTR-only | Phase 1+ diagnostics may add path-aware timers without changing decisions |
| lookupTermDomainTagsInScope call count | NOT AVAILABLE | No dedicated counter; calls increment tierSqlQueries with other tier SQL | Phase 5 before/after can add temporary probe counter in harness only |
| Parent Candidate count (dedicated) | PARTIAL | Parent ngram SQL delta recorded as parentNgramSqlDelta; not candidate cardinality | Harness-only in Phase 5 |
| Full WAV/ASR/Tone dialog_200 E2E | NOT RUN | This seal uses offline GT text + Electron ABI assembly + KenLM scoreBatch (same post-ASR assembly surface) | Optional later E2E under separate report; not required to unblock Phase 1 lattice harness |
| GPU identity | NOT AVAILABLE | Offline CPU assembly path; GPU unused | N/A |
| Single-case peak heap | NOT AVAILABLE | Recorded process peak over full 200-pass | Acceptable per Phase 0.5 wording |
