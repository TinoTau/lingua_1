# Single-char disambiguation observation-only trace

Fields (internal / V4 diagnostics only — not JobResult):

- singleCharAmbiguityInvoked
- candidateCount
- requestId
- candidateIds / surfaces (diagnostic)
- decision
- selectedIndex
- abstainReason
- modelHeadAvailable
- latencyMs

Do not expand long-term conversation storage. Reuse existing diagnostics policy (`MODEL2_DIALOG200_TRACE` style: observation-only).
