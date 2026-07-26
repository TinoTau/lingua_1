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
  /**
   * Legacy alias of `recallToneFallbackCount` for experiment/trace consumers.
   * Formal Tone metric SSOT remains `recallToneFallbackCount`.
   * BLOCKED FOR SEPARATE Tone Contract Audit (rename/retire alias).
   */
  recallToneIncompatibleCount?: number;
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

export type CoarseAssemblyInternalResult = {
  coarseSpans: CoarseSpan[];
  retainedDomains: readonly string[];
  /** Diagnostic primary retained domain (or general). */
  utteranceDomain: string;
  sentenceCandidates: string[];
};
