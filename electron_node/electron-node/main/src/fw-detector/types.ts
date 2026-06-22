import type { WindowCandidateSource } from '../lexicon/window-candidate-source';
import type { RecallJobV2Diagnostics } from '../lexicon-v2/recall-v2-diagnostics';
import type { SpanAssemblyV4TraceDiagnostics, CombinationTrace } from './span-assembly-v4/v4-diagnostics-types';
import type { CoarseBoundaryImportDiagnostics } from './span-assembly-shared/coarse-boundary-import';
import type { CoarseAssemblyToneDiagnostics } from './span-assembly-shared/types';

export type FwDetectorSignal =
  | 'domain_anchor_nearby'
  | 'mixed_language_anomaly'
  | 'detector_pinyin_hint'
  | 'pinyin_proximity'
  | 'low_no_speech_prob'
  | 'kenlm_local_low_prob'
  | 'alias_exact_hit'
  | 'low_word_probability'
  | 'low_segment_avg_logprob'
  | 'high_compression_ratio'
  | 'ime_v2_diff_hint'
  | 'ime_v2_instability_hint'
  | 'ime_v2_boundary_topk_diff_hint'
  | 'span_assembly_v3'
  | 'span_assembly_v4';

export type FwSpanGateMode = 'legacy_detector' | 'kenlm_gate_filter' | 'fw_metadata_gate';

export type KenlmSpanGateSkippedReason =
  | 'empty_text'
  | 'kenlm_unavailable'
  | 'no_low_prob_span';

export type FwMetadataSpanGateSkippedReason =
  | 'empty_text'
  | 'disabled'
  | 'no_metadata'
  | 'all_signals_normal';

export type FwMetadataSpanGateDiagnostics = {
  enabled: true;
  mode: 'fw_metadata_gate';
  wordCount: number;
  lowConfidenceWordCount: number;
  aliasHitCount: number;
  selectedCount: number;
  alignmentFailures: number;
  fwMetadataGateMs: number;
  skippedReason?: FwMetadataSpanGateSkippedReason;
};

export type KenlmSpanGateDiagnostics = {
  enabled: true;
  mode: 'kenlm_gate_filter';
  enumeratedCount: number;
  preFilteredCount: number;
  scoredCount: number;
  selectedCount: number;
  baselineScore: number;
  baselineNorm: number;
  kenlmSpanGateMs: number;
  kenlmSpanGateQueryCount: number;
  skippedReason?: KenlmSpanGateSkippedReason;
};

export type FwTextSpan = {
  text: string;
  start: number;
  end: number;
};

export type KenlmGateMode = 'hard_gate' | 'weak_veto';

export type FwKenlmGateReason =
  | 'approved_hard_gate'
  | 'below_delta_threshold'
  | 'not_worse_than_threshold'
  | 'vetoed_worse_than_threshold'
  | 'kenlm_unavailable'
  | 'kenlm_error'
  | 'kenlm_disabled';

export type FwCandidateVetoReason =
  | 'same_as_span'
  | 'kenlm_veto'
  | 'kenlm_unavailable'
  | 'kenlm_error';

export type KenlmSpanGateOptions = {
  enabled: boolean;
  mode: KenlmGateMode;
  deltaThreshold: number;
  vetoThreshold: number;
};

export type FwCandidateFinalScoreBreakdown = {
  pinyinScore: number;
  priorScore: number;
  domainScore: number;
  kenlmContribution: number;
  repairTargetBoost?: number;
  finalScore: number;
};

export type FwSpanCandidateDiag = {
  candidateIndex: number;
  word: string;
  priorScore: number;
  candidateScore: number;
  phoneticScore: number;
  source: WindowCandidateSource;
  candidateSentence: string;
  domains: string[];
  domainMatched: boolean;
  domainScore: number;
  kenlmDelta: number;
  finalScore: number;
  repairTarget?: boolean;
  finalScoreBreakdown?: FwCandidateFinalScoreBreakdown;
  vetoed: boolean;
  vetoReason?: FwCandidateVetoReason;
  kenlm?: FwKenlmGateDiag;
  selected?: boolean;
};

export type FwKenlmGateDiag = {
  enabled: boolean;
  mode: KenlmGateMode;
  approved: boolean;
  vetoed: boolean;
  delta: number;
  deltaThreshold: number;
  vetoThreshold: number;
  baselineNorm: number;
  candidateNorm: number;
  reason: FwKenlmGateReason;
};

export type FwDetectorHintDiag = {
  syllables: string[];
  syllableCount: number;
};

export type FwRiskScoreBreakdownItem = {
  signal: FwDetectorSignal;
  weight: number;
  partial: number;
};

export type FwSpanDiagnostics = {
  text: string;
  start: number;
  end: number;
  domain: string;
  riskScore: number;
  signals: FwDetectorSignal[];
  riskScoreBreakdown?: FwRiskScoreBreakdownItem[];
  candidates: FwSpanCandidateDiag[];
  selectedCandidateIndex?: number;
  applied: boolean;
  detectorHint?: FwDetectorHintDiag;
};

export type FwSpanDropReason =
  | 'below_min_risk'
  | 'overlap_lower_priority'
  | 'maxSpans';

export type FwSpanDroppedDiag = {
  text: string;
  start: number;
  end: number;
  riskScore: number;
  reason: FwSpanDropReason;
};

export type FwSpanSelectionDiag = {
  enumeratedCount: number;
  keptCount: number;
  dropped: FwSpanDroppedDiag[];
};

export function getSelectedFwCandidate(span: FwSpanDiagnostics): FwSpanCandidateDiag | undefined {
  const byFlag = span.candidates.find((c) => c.selected);
  if (byFlag) {
    return byFlag;
  }
  if (span.selectedCandidateIndex != null) {
    return span.candidates.find((c) => c.candidateIndex === span.selectedCandidateIndex);
  }
  return undefined;
}

export type FwDetectorSummary = {
  spanCount: number;
  candidateCount: number;
  candidateSentenceCount: number;
  appliedCount: number;
  kenlmApprovedCount: number;
  kenlmVetoedCount: number;
  pickedTopKWinCount: number;
  kenlmQueryCount: number;
};

export type FwRerankScoreMode = 'raw_log_delta';

export type FwSentenceRerankDiagnostics = {
  spanCount: number;
  perSpanLimit: number;
  combinationCount: number;
  kenlmQueryCount: number;
  pickedIsRaw: boolean;
  maxDelta: number;
  minDeltaToReplace: number;
  scoreMode?: FwRerankScoreMode;
  baselineRawScore?: number;
  pickedRawScore?: number;
  maxNormalizedDelta?: number;
  topCandidates: Array<{ text: string; kenlmDelta: number; replacementCount: number }>;
  allCombinations?: CombinationTrace[];
  allCombinationDeltas?: number[];
  picked?: import('./build-sentence-candidates').SentenceCombination | null;
  kenlmTiming?: {
    batchMs: number;
    queryCount: number;
  };
  kenlmSubprocessMs?: number;
  kenlmSubprocessCount?: number;
  kenlmSubprocessErrorReason?: string;
};

export type FwDetectorRuntimeDiag = {
  loaded: boolean;
  status: string;
  bundleDir: string | null;
  sqlitePath: string | null;
  manifestVersion: string | null;
  lexiconRows: number | null;
  profilePrimary: string | null;
  enabledDomains: string[];
};

export type FwDetectorReplacementDiag = {
  before: string;
  after: string;
  source: string;
  applied: boolean;
  applyBlockedReason?: 'overlap';
  selectedRank?: number;
  finalScore?: number;
  start: number;
  end: number;
  kenlm?: {
    approved: boolean;
    vetoed: boolean;
    mode: KenlmGateMode;
    reason: FwKenlmGateReason;
    delta: number;
  };
};

export type PinyinImeV2SpanSelectionMode =
  | 'all_passed'
  | 'ranked_capped'
  | 'empty_after_normalizer';

export type PinyinImeV2ActiveDiagnostics = {
  enabled: true;
  candidateCount: number;
  diffSpanCount: number;
  instabilityRegionCount: number;
  selectedSpanCount: number;
  selectionMode?: PinyinImeV2SpanSelectionMode;
  normalizedSpanCount?: number;
  neighborHitCount?: number;
  neighborMissCount?: number;
  cappedByMaxSpansCount: number;
  normalizerDroppedCount: number;
  decodeMs: number;
  /** Phase 4B.1 alignment-only OpenCC stats */
  traditionalCharCount?: number;
  openccConvertedCount?: number;
  normalizedCharCount?: number;
  rawBoundaryCount?: number;
  /** Phase 4C boundary alignment diagnostics */
  rawBoundaryMatchedTopKCount?: number;
  boundaryCompatibilityScoreMax?: number;
  boundaryCompatibilityScoreAvg?: number;
  /** Phase 4D: trusted TopK + boundary-compatible diff spans */
  trustedTopKCount?: number;
  boundaryCompatibleTopKSpanCount?: number;
  diffZeroBoundaryPositive?: number;
  skippedReason?: 'ime_dict_unavailable' | 'no_cjk' | 'no_candidates' | 'no_selected_spans';
  loadError?: string;
};

/** FW Repair V4 — global window + compatibility graph diagnostics. */
export type SpanAssemblyV4Diagnostics = {
  enabled: true;
  stub: boolean;
  coarseSpanCount: number;
  globalWindowGeneratedCount: number;
  blockedWindowCount: number;
  truncatedWindowCount: number;
  ngramQueryCount: number;
  windowCandidatePoolCount: number;
  activeCandidateCount: number;
  compatibilityEdgeCount: number;
  coverageCount: number;
  conflictRelationCount: number;
  compatibleCount: number;
  parentEvidenceCount: number;
  exactEdgeCount: number;
  candidateEdgeCount: number;
  overlapMergeCount: number;
  residualSpanCount: number;
  utteranceDomain: string;
  domainVoteMs: number;
  coarsePathAssemblyMs: number;
  sentenceBeamMs: number;
  assemblyMs: number;
  parentFragmentHitCount?: number;
  parentSpanCandidateEmittedCount?: number;
  parentSpanCandidateSelectedCount?: number;
  dominatedPrunedCount?: number;
  ruleBRejectedByHoleCount?: number;
  parentSpanCoverageAvg?: number;
  parentTermVoteCount?: number;
  inSpanWindowCount: number;
  boundaryWindowCount: number;
  domainCandidateCount: number;
  baseCandidateCount: number;
  sameDomainCandidateCount: number;
  domainFilteredSpanCount: number;
  selectedCandidatesPerSpanAvg: number;
  domainAssemblyMs: number;
  mainDomainAwareSpanSetsTotal: number;
  shadowBeamSpanSetsTotal: number;
  intervalAssemblyCandidateCount: number;
  intervalRejectedOverlapCount: number;
  recallEnabledFineDomains?: string[];
  domainScores?: Record<string, number>;
  winningFineDomain?: string;
  insufficientEvidence?: boolean;
  boundaryImport?: CoarseBoundaryImportDiagnostics;
  tone?: CoarseAssemblyToneDiagnostics;
  skippedReason?: 'no_cjk' | 'no_coarse_spans';
} & SpanAssemblyV4TraceDiagnostics;

export type FwPipelinePath = 'v4';

export type FwDetectorResult = {
  enabled: boolean;
  triggered: boolean;
  reason?: string;
  configSnapshot: Record<string, unknown>;
  summary?: FwDetectorSummary;
  runtime?: FwDetectorRuntimeDiag;
  replacements?: FwDetectorReplacementDiag[];
  spans: FwSpanDiagnostics[];
  pipelinePath?: FwPipelinePath;
  kenlmTiming?: {
    batchMs: number;
    queryCount: number;
  };
  /** FW Repair V4 span assembly diagnostics. */
  spanAssemblyV4?: SpanAssemblyV4Diagnostics;
  kenlmVetoMs?: number;
  kenlmVetoQueryCount?: number;
  /** Test-only when LEXICON_RECALL_V2_DIAGNOSTICS=1 */
  recallV2Diagnostics?: RecallJobV2Diagnostics;
  /** P4: sentence-level rerank diagnostics */
  sentenceRerank?: FwSentenceRerankDiagnostics;
};

export type FwApprovedReplacement = {
  start: number;
  end: number;
  candidateText: string;
  span: FwTextSpan;
};
