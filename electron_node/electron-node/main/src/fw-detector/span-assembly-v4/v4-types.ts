import type { WindowCandidateSource } from '../../lexicon/window-candidate-source';
import type { ToneLookupStage } from '../../lexicon-v2/tone-first-tier-collector';
import type { GraphEdgeSource } from '../span-assembly-shared/types';

export type WindowSource = 'in_span_window' | 'boundary_window' | 'blocked';

export type BlockedBoundaryReason =
  | 'boundary_cross_count'
  | 'raw_gap_between_spans'
  | 'whitespace_gap'
  | 'punctuation_in_window'
  | 'sentence_boundary'
  | 'non_cjk_syllable'
  | 'asr_word_gap_ms';

export type GlobalWindowDescriptor = {
  windowId: string;
  syllableStart: number;
  syllableEnd: number;
  rawStart: number;
  rawEnd: number;
  windowText: string;
  windowPinyinKey: string;
  spanIds: string[];
  boundaryCrossCount: number;
  windowSource: WindowSource;
  anchorCoarseSpanId: string;
  blocked: boolean;
  blockedBoundaryReason?: BlockedBoundaryReason;
};

export type WindowCandidateHitKind = 'exact_term' | 'parent_fragment';

export type WindowCandidate = {
  candidateId: string;
  windowId: string;
  windowSource: 'in_span_window' | 'boundary_window';
  anchorCoarseSpanId: string;
  syllableStart: number;
  syllableEnd: number;
  rawStart: number;
  rawEnd: number;
  windowPinyinKey: string;
  candidateScore: number;
  score: number;
  boundaryPenalty: number;
  candidateRank: number;
  hitKind: WindowCandidateHitKind;
  replacement: string;
  /** Full Hotword.domains[] membership copy — never domains[0] projection. */
  domains?: readonly string[];
  source: GraphEdgeSource;
  recallSource: WindowCandidateSource;
  repairTarget: boolean;
  parentTermId?: string;
  parentTerm?: string;
  parentPinyinKey?: string;
  parentTermSyllableCount?: number;
  matchedTermStart?: number;
  matchedTermEnd?: number;
  fragmentTonePinyinKey?: string;
  toneCompatible?: boolean;
  tonePenalty?: number;
  toneReason?: string;
  toneLookupStage?: ToneLookupStage;
  isCovered?: boolean;
  coveredBy?: string;
  coveredChildren?: string[];
};

export type OverlapRelationType = 'COMPATIBLE' | 'COVERAGE' | 'CONFLICT';

export type CoverageRelation = {
  parentCandidateId: string;
  childCandidateId: string;
};

export type ConflictRelationSource = 'syllable_overlap';

export type ConflictRelation = {
  candidateIdA: string;
  candidateIdB: string;
  relationType: 'CONFLICT';
  source: ConflictRelationSource;
  reason?: string;
};

export type CompatibilityMetrics = {
  activeCandidateCount: number;
  coverageCount: number;
  conflictRelationCount: number;
  hardDropCount: number;
  compatibleCount: number;
};

export type CompatibilityResult = {
  activeCandidates: WindowCandidate[];
  coverageRelations: CoverageRelation[];
  conflictRelations: ConflictRelation[];
  hardDropCandidates: WindowCandidate[];
  metrics: CompatibilityMetrics;
};

export type CompatibilityEdge = {
  fromId: string;
  toId: string;
  compatible: boolean;
  overlapRelationType: OverlapRelationType;
};

export type SpanAssemblyV4Metrics = {
  coarseSpanCount: number;
  globalWindowGeneratedCount: number;
  blockedWindowCount: number;
  truncatedWindowCount: number;
  ngramQueryCount: number;
  windowCandidatePoolCount: number;
  activeCandidateCount: number;
  compatibilityEdgeCount: number;
  /** @deprecated Authority Reduction: always 0; use hardDropCount */
  droppedCandidateCount: number;
  coverageCount: number;
  /** @deprecated Authority Reduction: use conflictRelationCount */
  conflictCount: number;
  conflictRelationCount: number;
  hardDropCount: number;
  compatibleCount: number;
  utteranceDomain: string;
  domainVoteMs: number;
  /** Alias of maxCount (span presence) */
  winnerScore?: number;
  runnerUpDomain?: string;
  /** Alias of runnerUpCount */
  runnerUpScore?: number;
  voteMargin?: number;
  assemblyMs: number;
  parentFragmentHitCount: number;
  parentTermVoteCount: number;
  inSpanWindowCount: number;
  boundaryWindowCount: number;
  domainCandidateCount: number;
  baseCandidateCount: number;
  sameDomainCandidateCount: number;
  domainFilteredSpanCount: number;
  selectedCandidatesPerSpanAvg: number;
  domainAssemblyMs: number;
  mainDomainAwareSpanSetsTotal: number;
  retainedBucketCount: number;
  intervalAssemblyCandidateCount: number;
  intervalRejectedOverlapCount: number;
  fallbackCandidateCount: number;
  kenlmPoolCandidateCount: number;
  preFilterCombinationCount: number;
  domainScores?: Record<string, number>;
  retainedDomains?: readonly string[];
  winningFineDomain?: string;
  insufficientEvidence?: boolean;
  domainLookupExecuted?: boolean;
  domainLookupDomainCount?: number;
  domainRecallHitCount?: number;
  voteEligibleDomainCandidateCount?: number;
  resolvedRecallDomainScope?: string[];
  architectureCompliance?: {
    generatorMode: 'ltr_soft_boundary';
    formalOverlapCount: number;
    beamEnabled: false;
    globalWindowProductionPath: false;
    fineSpanPriorSource: 'domainPriors' | 'none';
    contextPriorDecisionApplied: false;
    priorWrittenToEnabledDomains: false;
    profileAffectedRecall: false;
    votePoolSource: 'formal_fine_span';
    sessionPriorTransport: 'audio_chunk_session_snapshot';
    topicShiftContractComplete: true;
    schedulerDomainInference: false;
    toneRecomputedAfterCommit: boolean;
  };
  /** Phase 1 utterance recall cache / Canonical RecallQueryKey metrics (Level 1). */
  recallRequestCount?: number;
  uniqueRecallKeyCount?: number;
  duplicateRecallKeyCount?: number;
  utteranceCacheHitCount?: number;
  utteranceCacheMissCount?: number;
  cacheHitRatio?: number;
  logicalQueryCount?: number;
  physicalSqlStatementCount?: number;
  exactQueryCount?: number;
  parentQueryCount?: number;
  lexiconRecallTotalMs?: number;
  recallRequestBuildMs?: number;
  utteranceCacheLookupMs?: number;
  lexiconFactLookupMs?: number;
  windowBindingMs?: number;
};
