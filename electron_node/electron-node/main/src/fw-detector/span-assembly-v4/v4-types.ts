import type { WindowCandidateSource } from '../../lexicon/window-candidate-source';
import type { RecallCandidateKind } from '../../lexicon/candidate-score';
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

export type WindowCandidateHitKind = 'exact_term';

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
  /** Lexicon term identity from hit.hotword.id — thin pass-through; never guessed from text. */
  termId?: string;
  /** Thin pass-through from Recall Hit — used for Edge hasFuzzy evidence only. */
  recallCandidateKind?: RecallCandidateKind;
  /** Full Hotword.domains[] membership copy — never domains[0] projection. */
  domains?: readonly string[];
  source: GraphEdgeSource;
  recallSource: WindowCandidateSource;
  repairTarget: boolean;
  toneCompatible?: boolean;
  tonePenalty?: number;
  toneReason?: string;
  toneLookupStage?: ToneLookupStage;
  isCovered?: boolean;
  coveredBy?: string;
  coveredChildren?: string[];
  /**
   * Model2 runtime provenance (contract delta — diagnostics only, non-gating).
   * BASE_FUZZY = base FineSpan lexicon recall; PROFILE_RETRIEVAL = Model2-introduced.
   */
  retrievalProvenance?:
    | 'BASE_FUZZY'
    | 'PROFILE_PRONUNCIATION'
    | 'PROFILE_DOMAIN'
    | 'PROFILE_RETRIEVAL';
  /** When term also recalled via Model2 after base hit (merge kept base). */
  alsoProfileRetrieval?: boolean;
  /** Model2 action id that introduced this candidate (diagnostics). */
  model2ActionId?: string;
  /**
   * Observation-only: FineSpan that originated the retrieval query.
   * Must not be used for ranking, budget, or Assembly eligibility.
   */
  originSpanId?: string;
  /** Observation-only retrieval id (P or D). */
  retrievalId?: string;
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
  /** Windows recalled this utterance (sum of per-call logicalWindowRecallCount). */
  logicalWindowRecallCount: number;
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
  /** JOBRESULT_ADAPTER_DEBT — parent-fragment recall retired (Phase 2/3); always 0. Kept for JobResult contract stability. */
  parentFragmentHitCount: number;
  /** JOBRESULT_ADAPTER_DEBT — parent-term structural vote retired (Phase 2/3); always 0. Kept for JobResult contract stability. */
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
    generatorMode: 'multi_path_lattice';
    fineSpanOwner: 'segmentation_path';
    voteScope: 'per_path';
    assemblyScope: 'per_path';
    retainedCompletePathCount: number;
    beamEnabled: false;
    globalWindowProductionPath: false;
    fineSpanPriorSource: 'domainPriors' | 'none';
    contextPriorDecisionApplied: false;
    priorWrittenToEnabledDomains: false;
    profileAffectedRecall: false;
    votePoolSource: 'path_fine_span';
    sessionPriorTransport: 'audio_chunk_session_snapshot';
    topicShiftContractComplete: true;
    schedulerDomainInference: false;
    toneRecomputedAfterRebind: boolean;
    crossPathMergeOwner: 'mergeCrossPathSentenceCandidates';
    candidateCapScope: 'global';
    candidateCap: number;
    dedupBeforeCap: true;
    dedupRetention: 'first_wins';
    kenlmInputOwner: 'cross_path_merge';
    prefilledCombinationsRequired: true;
    toneEvidenceOwner: 'acoustic_tone_slices';
  };
  /** Step 4 Cross-Path Merge diagnostics (KenLM input pool). */
  crossPathInputCandidateCount?: number;
  crossPathDuplicateCount?: number;
  crossPathUniqueCandidateCount?: number;
  crossPathOutputCandidateCount?: number;
  crossPathTruncatedCount?: number;
  globalCandidateCap?: number;
  kenlmInputSource?: 'cross_path_merge';
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
  lexiconRecallTotalMs?: number;
  recallRequestBuildMs?: number;
  utteranceCacheLookupMs?: number;
  lexiconFactLookupMs?: number;
  windowBindingMs?: number;
};
