/** Coarse assembly limits — beam, graph, path (shared by V4). */
export const CoarseAssemblyLimits = {
  ngramTopK: 2,
  exactTopK: 2,
  parentFragmentTopK: 3,
  perParentTermPerWindow: 1,
  maxGraphEdgesPerSpan: 20,
  maxSqlPerUtterance: 150,
  maxCoarsePathsPerSpan: 3,
  maxSentenceBeam: 16,
  minNgramSyllables: 2,
  maxNgramSyllables: 5,
} as const;
