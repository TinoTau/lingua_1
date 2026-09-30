# SINGLE_CHAR_COLLECTOR_TRACE_V1

Observation-only. Attached to `dialog200_path_trace.single_char_collector` when `MODEL2_DIALOG200_TRACE=1`.

Collector **always** classifies after the live decision. TRACE_ON only **attaches** the already-computed snapshot. It must not re-query, re-sort, re-materialize, or change object identity of Candidates / FineSpans / Assembly input.

## Window identity

`run_id`, `dialog_id`, `utterance_id` are joined at analysis time from the utterance record.

Per window (runtime):

- `windowId`, `rawStart`, `rawEnd`, `syllableStart`, `syllableEnd`
- `windowText` (ASR/raw), `windowTextCanonical` (NFKC + OpenCC t→cn, diagnostic only)
- `pinyinKey`, `queryTonePinyinKey`, `tonePattern`, `toneRecallReadiness`
- `queryExecuted`, `querySource` (`live` | `utterance_cache`)
- `sqlLimit` (8), `sqlHitCount`, `preLimitCount`, `postLimitCount`, `truncated`
- `eligibleHitCount`, `toneExactHitCount`, `surfaceExactHitCount`, `uniqueToneExact`
- `minCandidateScore`, `candidateScore`, `chosenSource`, `selectedCandidate`
- `sqlHits[]` (compact, ≤8)
- `blocked`, `boundCandidateCount`
- `terminalReason`

## Terminal taxonomy (mutually exclusive at result)

`NOT_APPLICABLE_WINDOW_LENGTH`  
`NO_QUERY_KEY`  
`SQL_NOT_EXECUTED`  
`SQL_NO_HIT`  
`TONE_READINESS_NOT_READY`  
`NO_TONE_PATTERN`  
`NO_TONE_EXACT_CANDIDATE`  
`MULTIPLE_TONE_EXACT_CANDIDATES`  
`SURFACE_EXACT_MISS`  
`LIMIT_TRUNCATION_REJECT`  
`MIN_SCORE_REJECT`  
`NORMALIZATION_SURFACE_MISMATCH`  
`INVALID_ROW`  
`OTHER_REJECT`  
`ACCEPT_SURFACE_EXACT`  
`ACCEPT_UNIQUE_TONE_EXACT`

Accept terminals imply a returned lexical Candidate. All other terminals imply `hit = null` (window bind yields 0 candidates; Lattice may later inject a fallback FineSpan).
