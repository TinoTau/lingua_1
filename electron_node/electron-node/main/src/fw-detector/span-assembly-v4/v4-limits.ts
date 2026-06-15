/** FW Repair V4 — single source of frozen limits (Rev2 §十八). */
export const V4_LIMITS = {
  windowMinSyllables: 2,
  windowMaxSyllables: 5,
  maxBoundaryCrossCount: 1,
  maxGlobalWindowCount: 120,
  maxBoundaryWindowCount: 40,
  maxSqlPerUtterance: 150,
  boundaryPenalty: 0.85,
  asrWordGapMs: 400,
  anchorStrategy: 'right_preferred' as const,
  incompatibleAction: 'drop' as const,
  exactTopK: 2,
  parentFragmentTopK: 3,
  perParentTermPerWindow: 1,
} as const;

/** V4 diagnostics trace size caps (P0 Supplement Freeze). */
export const V4_TRACE_LIMITS = {
  maxTraceWindows: 200,
  maxTraceRecallHits: 500,
  maxTraceCandidates: 500,
  maxTraceEdges: 500,
  maxTracePaths: 100,
  maxTraceBeamSpans: 32,
  maxTraceSentenceCandidates: 32,
  maxTraceCombinations: 32,
  maxTraceCoarseSpans: 32,
} as const;
