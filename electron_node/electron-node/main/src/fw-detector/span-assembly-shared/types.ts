import type { WindowCandidateSource } from '../../lexicon/window-candidate-source';

export type CoarseAssemblyToneExampleWindow = {
  text: string;
  pinyinKey: string;
  windowTimeRange?: { start: number; end: number };
  acousticTonePattern?: number[];
};

export type CoarseAssemblyToneDiagnostics = {
  tonePayloadAvailable: boolean;
  toneEnabled: boolean;
  toneSkippedReason?: string;
  toneSliceCount: number;
  wordTimeSpanCount: number;
  windowTimeAttemptCount: number;
  windowTimeHitCount: number;
  toneOverlapHitCount: number;
  toneOverlapMissCount: number;
  toneOverlapSyllableMismatchCount: number;
  ngramTonePatternAttemptCount: number;
  ngramTonePatternHitCount: number;
  ngramTonePatternMissCount: number;
  recallToneCompatibleCount: number;
  recallToneFallbackCount: number;
  /** SQL tone_exact stage hit count (utterance aggregate). */
  toneExactHitCount: number;
  /** SQL plain_fallback stage hit count (utterance aggregate; excludes plain_only_no_pattern). */
  plainFallbackHitCount: number;
  exampleToneWindows?: CoarseAssemblyToneExampleWindow[];
};

export type CoarseBoundarySource =
  | 'ime_token_boundary'
  | 'raw_ime_aligned_boundary'
  | 'proposal_active_boundary'
  | 'asr_word_boundary'
  | 'punctuation_fallback';

/** @deprecated Use CoarseBoundarySource */
export type CoarseSpanSource = CoarseBoundarySource;

export type CoarseSpan = {
  id: string;
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  text: string;
  source: CoarseBoundarySource;
  boundaryConfidence: number;
};

export type GraphEdgeSource =
  | 'base_term'
  | 'domain_term'
  | 'oral_function'
  | 'oral_particle'
  | 'passive_domain_weak'
  | 'unknown'
  | 'noise';

export type GraphEdgeHitKind = 'exact_term' | 'parent_fragment' | 'parent_span_candidate';

export type ParentTermEvidence = {
  coarseSpanId: string;
  parentTermId: string;
  parentTerm: string;
  parentPinyinKey: string;
  parentTermSyllableCount: number;
  domainId?: string;
  score: number;
  repairTarget: boolean;
  matchedTermStart: number;
  matchedTermEnd: number;
  rawStart: number;
  rawEnd: number;
  windowSyllableStart: number;
  windowSyllableEnd: number;
  fragmentTonePinyinKey?: string;
  source: GraphEdgeSource;
  windowSource?: 'in_span_window' | 'boundary_window';
  windowId?: string;
};

export type ParentSpanCandidate = {
  coarseSpanId: string;
  parentTermId: string;
  parentTerm: string;
  replacement: string;
  syllableStart: number;
  syllableEnd: number;
  rawStart: number;
  rawEnd: number;
  coverageRatio: number;
  rawCoverageRatio: number;
  evidenceCount: number;
  parentTermLength: number;
  isFullCoverage: boolean;
  repairTarget: boolean;
  score: number;
  domainId?: string;
  source: GraphEdgeSource;
  parentPinyinKey: string;
};

export type GraphEdge = {
  coarseSpanId?: string;
  syllableStart: number;
  syllableEnd: number;
  rawStart: number;
  rawEnd: number;
  replacement: string;
  source: GraphEdgeSource;
  domainId?: string;
  score: number;
  ngramKey: string;
  variantKind?: string;
  recallSource: WindowCandidateSource;
  repairTarget: boolean;
  hitKind?: GraphEdgeHitKind;
  parentTerm?: string;
  parentTermId?: string;
  matchedTermStart?: number;
  matchedTermEnd?: number;
  fragmentPinyinKey?: string;
  fragmentTonePinyinKey?: string;
  domainEvidenceTerm?: string;
};

export type CoarseSpanPath = {
  coarseSpanId: string;
  edges: GraphEdge[];
  score: number;
};

export type CoarseAssemblyInternalResult = {
  coarseSpans: CoarseSpan[];
  graphEdges: GraphEdge[];
  utteranceDomain: string;
  coarsePaths: CoarseSpanPath[];
  sentenceCandidates: string[];
};
