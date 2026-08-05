/** FW Repair V4 diagnostics trace types (P0 Supplement Freeze). */

import type { ToneLookupStage } from '../../lexicon-v2/tone-first-tier-collector';

export type V4DiagnosticsLevel = 'summary' | 'trace';

export type CoarseSpanTrace = {
  id: string;
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  text: string;
  source: string;
};

export type BoundaryWindowTrace = {
  windowId: string;
  windowText: string;
  windowPinyinKey: string;
  windowSource: 'in_span_window' | 'boundary_window' | 'blocked';
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  spanIds: string[];
  anchorCoarseSpanId: string;
  boundaryCrossCount: number;
  blocked: boolean;
  blockedBoundaryReason?: string;
};

export type TruncatedWindowTrace = {
  windowId: string;
  reason: 'budget_truncated';
  windowPinyinKey: string;
};

export type RecallHitPreFilterTrace = {
  windowId: string;
  windowPinyinKey?: string;
  replacement: string;
  candidateScore: number;
  toneCompatible: boolean;
  tonePenalty?: number;
  toneReason?: 'match' | 'mismatch' | 'no_pattern';
  minPriorPassed: boolean;
  filterStage: 'tone_penalized' | 'min_prior_rejected' | 'accepted';
  sqlReturned: boolean;
  toneLookupStage?: ToneLookupStage;
  queryTonePinyinKey?: string;
};

export type RecallHitTrace = {
  windowId: string;
  windowPinyinKey: string;
  windowSource: 'in_span_window' | 'boundary_window';
  replacement: string;
  hitKind: 'exact_term';
  candidateScore: number;
  score: number;
  repairTarget: boolean;
  candidateId: string;
  tonePenalty?: number;
  toneReason?: 'match' | 'mismatch' | 'no_pattern';
  toneLookupStage?: ToneLookupStage;
  queryTonePinyinKey?: string;
};

export type CandidatePoolTrace = {
  candidateId: string;
  windowId: string;
  windowPinyinKey: string;
  windowSource: 'in_span_window' | 'boundary_window';
  replacement: string;
  hitKind: 'exact_term';
  candidateRank: number;
  candidateScore: number;
  score: number;
  repairTarget: boolean;
  anchorCoarseSpanId: string;
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  dropped?: boolean;
  droppedReason?: string;
  droppedByCandidateId?: string;
  isCovered?: boolean;
  coveredBy?: string;
  toneLookupStage?: ToneLookupStage;
};

export type CompatibilityEdgeTrace = {
  sourceCandidateId: string;
  targetCandidateId: string;
  sourceReplacement: string;
  targetReplacement: string;
  compatible: boolean;
  overlapRelationType?: 'COMPATIBLE' | 'COVERAGE' | 'CONFLICT';
  reason: string;
  droppedCandidateId?: string;
  dropReason?: string;
};

export type EmittedEdgeTrace = {
  replacement: string;
  hitKind: 'exact_term';
  coarseSpanId: string;
  windowId?: string;
  windowSource?: 'in_span_window' | 'boundary_window';
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  score: number;
  repairTarget: boolean;
};

export type SentenceCandidateTrace = {
  sentence: string;
  replacements: string[];
  score?: number;
};

export type CombinationTrace = {
  sentence: string;
  delta: number;
  approved: boolean;
  rejectedReason?: 'below_min_delta' | 'picked_raw' | 'missing_repair_target';
  /** Assembly Formula A metadata — observation only; does not gate pick. */
  repairSelectionCompleteness?: import('../derive-repair-selection-completeness').RepairSelectionCompleteness;
  repairPickCount?: number;
  unrepairedRepairableSlotCount?: number;
};

export type CandidateLifecycleLayer =
  | 'window'
  | 'recall'
  | 'pool'
  | 'compatibility'
  | 'emit'
  | 'assembly'
  | 'graph'
  | 'beam'
  | 'kenlm';

export type CandidateLifecycle = {
  candidateId: string;
  candidateText: string;
  firstSeenLayer: CandidateLifecycleLayer;
  firstDroppedLayer?: string;
  dropReason?: string;
  coverageParentId?: string;
  lifecycleState?: 'covered_by_parent' | 'revived_after_parent_drop' | 'conflict_relation_created';
};

export type SpanAssemblyV4TraceDiagnostics = {
  traceLevel?: V4DiagnosticsLevel;
  traceTargetMatched?: boolean;
  traceTruncated?: boolean;
  traceTruncatedReason?: string;
  coarseSpans?: CoarseSpanTrace[];
  boundaryWindows?: BoundaryWindowTrace[];
  truncatedWindows?: TruncatedWindowTrace[];
  recallHitsPreFilter?: RecallHitPreFilterTrace[];
  recallHits?: RecallHitTrace[];
  poolBeforeDrop?: CandidatePoolTrace[];
  poolAfterDrop?: CandidatePoolTrace[];
  compatibilityEdges?: CompatibilityEdgeTrace[];
  emittedEdges?: EmittedEdgeTrace[];
  sentenceCandidates?: SentenceCandidateTrace[];
  candidateLifecycle?: CandidateLifecycle[];
  /**
   * Phase 2 Path Enumeration facts — OPTIONAL fact-only fields.
   * These MUST NOT influence decisions; current production trace collector doesn't push them.
   */
  pathEnumerationFacts?: {
    sentenceId?: string;
    syllableCount: number;
    lexicalEdgeCount: number;
    fallbackEdgeCount: number;
    completePathCountBeforePrune: number;
    retainedCompletePathCount: number;
    prunedPathCount: number;
    boundaryKeys: string[];
    prunedBoundaryKeys: string[];
    pruneReasons: string[];
    fallbackInjectionCount: number;
    fallbackInjectionRanges: Array<{ start: number; end: number }>;
  };
  pathCapEvents?: Array<{
    pruneStage: 'per_position_cap' | 'complete_path_cap';
    position?: number;
    beforeCount: number;
    afterCount: number;
    prunedBoundaryPrefixes: string[];
    reason: string;
  }>;
  pathFacts?: Array<{
    pathId: string;
    boundaryKey: string;
    edgeRanges: Array<{ start: number; end: number }>;
    lexicalEdgeCount: number;
    fallbackEdgeCount: number;
    exactEdgeCount: number;
    toneRelaxedEdgeCount: number;
    fuzzyEdgeCount: number;
    pathFineSpanCount: number;
  }>;
};
