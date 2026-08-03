export type CoarseAssemblyToneExampleWindow = {
  text: string;
  pinyinKey: string;
  windowTimeRange?: { start: number; end: number };
  acousticTonePattern?: number[];
  mappingMissReason?: string;
  mappingMissAttribution?: string;
};

export type TonePatternMappingMissReason =
  | 'no_word_timespan_for_slot'
  | 'no_slice_overlap_word_time'
  | 'empty_posterior'
  | 'invalid_posterior';

export type ToneMappingMissAttribution =
  | 'short_duration_skipped'
  | 'feature_extraction_failed'
  | 'inference_output_missing'
  | 'invalid_word_time'
  | 'slice_exists_but_no_overlap'
  | 'word_timespan_mapping_failure'
  | 'unknown';

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
  /** windowTimeRange found but mapToneEvidenceForRecall returned no pattern. */
  tonePatternMappingMissCount: number;
  mappingMissReasonCounts?: Partial<Record<TonePatternMappingMissReason, number>>;
  mappingMissAttributionCounts?: Partial<Record<ToneMappingMissAttribution, number>>;
  evidenceProductionStatusCounts?: Partial<Record<string, number>>;
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
  /** SQL plain_fallback stage hit count — always 0 after Batch 1.1C Mandatory Tone Recall. */
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
