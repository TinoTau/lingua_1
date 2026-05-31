import type { WindowCandidateSource } from '../lexicon/window-candidate-source';
import type { RecallJobV2Diagnostics } from '../lexicon-v2/recall-v2-diagnostics';

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
  | 'high_compression_ratio';

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
  usedLegacyFallback?: boolean;
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
  | 'maxSpans'
  | 'repair_target_false';

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

export type FwSentenceRerankDiagnostics = {
  spanCount: number;
  perSpanLimit: number;
  combinationCount: number;
  kenlmQueryCount: number;
  pickedIsRaw: boolean;
  maxDelta: number;
  minDeltaToReplace: number;
  topCandidates: Array<{ text: string; kenlmDelta: number; replacementCount: number }>;
  kenlmTiming?: {
    batchMs: number;
    queryCount: number;
  };
};

export type FwDetectorRuntimeDiag = {
  loaded: boolean;
  status: string;
  bundleDir: string | null;
  sqlitePath: string | null;
  manifestVersion: string | null;
  lexiconRows: number | null;
  scoredRows: number | null;
  pinyinIndexSize: number | null;
  exactIndexSize: number | null;
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

export type FwDetectorResult = {
  enabled: boolean;
  triggered: boolean;
  reason?: string;
  configSnapshot: Record<string, unknown>;
  summary?: FwDetectorSummary;
  runtime?: FwDetectorRuntimeDiag;
  replacements?: FwDetectorReplacementDiag[];
  spans: FwSpanDiagnostics[];
  spanSelection?: FwSpanSelectionDiag;
  kenlmTiming?: {
    batchMs: number;
    queryCount: number;
  };
  kenlmSpanGate?: KenlmSpanGateDiagnostics;
  fwMetadataSpanGate?: FwMetadataSpanGateDiagnostics;
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
