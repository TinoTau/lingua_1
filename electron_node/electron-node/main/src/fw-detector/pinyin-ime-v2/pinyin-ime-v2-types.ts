import type { FwSpanDiagnostics } from '../types';
import type { BoundaryCompatibleTopKSpan } from './pinyin-ime-v2-boundary-compatible-topk-diff';

export type PinyinImeV2DictEntrySource =
  | 'base'
  | 'domain'
  | 'target'
  | 'single_char'
  | 'fallback';

export type PinyinImeV2Token = {
  word: string;
  syllableStart: number;
  syllableEnd: number;
  source: PinyinImeV2DictEntrySource;
};

export type PinyinImeV2Candidate = {
  text: string;
  score: number;
  rank: number;
  /** Phase 4A+: decode token path (optional until 4D freeze). */
  tokens?: PinyinImeV2Token[];
};

export type PinyinImeV2DiffSpan = {
  rawSpan: string;
  start: number;
  end: number;
  candidateRank: number;
  supportCount: number;
};

export type PinyinImeV2InstabilityRegion = {
  rawSpan: string;
  start: number;
  end: number;
  variants: string[];
  supportCount: number;
};

export type PinyinImeV2ApprovedSpanReason =
  | 'ime_v2_diff'
  | 'ime_v2_instability'
  | 'ime_v2_boundary_topk_diff';

export type PinyinImeV2ApprovedSpan = {
  rawSpan: string;
  start: number;
  end: number;
  confidence: number;
  reason: PinyinImeV2ApprovedSpanReason;
};

export type PinyinImeV2SingleCharRole =
  | 'function_single_char'
  | 'time_single_char'
  | 'place_direction_single_char'
  | 'measure_single_char'
  | 'service_content_single_char'
  | 'content_single_char'
  | 'content_single_char_fallback';

export type PinyinImeV2DictEntry = {
  word: string;
  syllables: string[];
  prior: number;
  source: PinyinImeV2DictEntrySource;
  singleCharRole?: PinyinImeV2SingleCharRole;
  isSingleChar?: boolean;
  isFallback?: boolean;
};

export type PinyinImeV2Dict = {
  entries: PinyinImeV2DictEntry[];
  byFirst: Map<string, PinyinImeV2DictEntry[]>;
  byFirstFallback: Map<string, PinyinImeV2DictEntry[]>;
  singleCharLoaded: boolean;
  dictDir: string;
};

/** Phase 4C: raw coarse boundary vs IME token path (diagnostics only). */
export type BoundaryAlignmentScore = {
  candidateRank: number;
  matchedBoundaryCount: number;
  conflictedBoundaryCount: number;
  compatibilityScore: number;
};

export type PinyinImeV2DecodeDiagnostics = {
  singleCharUsedCount: number;
  functionSingleCharUsedCount: number;
  contentFallbackUsedCount: number;
  fallbackTriggeredCount: number;
  beamBreakRecoveredCount: number;
  decodeMs: number;
  /** Candidates with non-empty tokens[]. */
  tokenPathAvailableCount: number;
  /** Sum of tokens across output candidates. */
  candidateTokenCount: number;
  /** Finished paths dropped because another path had the same text. */
  collapsedPathByTextCount: number;
};

export type PinyinImeV2ProposalDiagnostics = {
  decode: PinyinImeV2DecodeDiagnostics;
  candidateCount: number;
  diffSpanCount: number;
  instabilityRegionCount: number;
  boundaryAdjustedCount: number;
  alignFailedCount: number;
  rawBoundaryCount: number;
  normalizedCharCount: number;
  traditionalCharCount: number;
  openccConvertedCount: number;
  boundaryAlignmentScores: BoundaryAlignmentScore[];
  rawBoundaryMatchedTopKCount: number;
  boundaryCompatibilityScoreMax: number;
  boundaryCompatibilityScoreAvg: number;
  trustedTopKCount: number;
  boundaryCompatibleTopKSpanCount: number;
  diffZeroBoundaryPositive: number;
  tokenSourceConflictDiagnosticCount: number;
  normalizedTextDiffDiagnosticCount: number;
};

export type PinyinImeV2HintGateDiagnostics = {
  inputSpanCount: number;
  normalizerDroppedCount: number;
  normalizerDroppedSingleChar: number;
  normalizerDroppedSyllableRange: number;
  gateDroppedSupport: number;
  gateDroppedNoNeighbor: number;
  gateDroppedMaxSpans: number;
  approvedSpanCount: number;
};

export type PinyinImeV2RuntimeConfig = {
  enabled: boolean;
  topK: number;
  maxApprovedSpans: number;
  minSupportCount: number;
  minSpanChars: number;
  maxSpanChars: number;
  minSyllables: number;
  maxSyllables: number;
  directRepair: false;
  dictDir: string;
  enabledDomains: string[];
};

export type { BoundaryCompatibleTopKSpan };

export type PinyinImeV2SpanProposal = {
  rawAsrText: string;
  candidates: PinyinImeV2Candidate[];
  diffSpans: PinyinImeV2DiffSpan[];
  instabilityRegions: PinyinImeV2InstabilityRegion[];
  boundaryCompatibleTopKSpans: BoundaryCompatibleTopKSpan[];
  diagnostics: PinyinImeV2ProposalDiagnostics;
  /** Phase 4B: alignment-only; not written to segmentForJobResult. */
  alignmentNormalizedLength?: number;
  rawBoundaryCount?: number;
};

export type LexiconNearNeighborProbe = (rawSpan: string) => boolean;

export type PinyinImeV2HintGateInput = {
  rawAsrText: string;
  diffSpans: PinyinImeV2DiffSpan[];
  instabilityRegions: PinyinImeV2InstabilityRegion[];
  boundaryCompatibleTopKSpans: BoundaryCompatibleTopKSpan[];
  config: PinyinImeV2RuntimeConfig;
  lexiconNearNeighbor: LexiconNearNeighborProbe;
};

export type PinyinImeV2HintGateResult = {
  approved: PinyinImeV2ApprovedSpan[];
  diagnostics: PinyinImeV2HintGateDiagnostics;
};

export type PinyinImeV2FwSpan = FwSpanDiagnostics;
