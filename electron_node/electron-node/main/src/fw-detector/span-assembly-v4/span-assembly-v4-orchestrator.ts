import type { SegmentInfo } from '../../task-router/types';
import { loadFwDetectorRuntimeConfig } from '../fw-config';
import { buildWordTimeSpans, type AcousticToneSlice } from '../tone-time-align';
import type { LexiconRuntimeV2 } from '../../lexicon-v2/lexicon-runtime-v2';
import { LEXICON_V3_FIVE_TABLE_V2_RUNTIME_SCHEMA_VERSION } from '../../lexicon-v2/lexicon-types-v2';
import {
  isFuzzyPinyinRecallEnabled,
} from '../../lexicon-v2/lexicon-fw-recall-config';
import type { ActiveLexiconProfileSnapshot } from '../../session-runtime/types';
import type { DomainPrior } from '../domain-context-contract';
import type { PinyinImeV2Dict, PinyinImeV2RuntimeConfig } from '../pinyin-ime-v2/pinyin-ime-v2-types';
import { buildUtteranceSyllableCoordinate } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import { partitionCoarseSpans } from '../span-assembly-shared/coarse-span-partition';
import { createEmptyToneDiagnostics } from '../span-assembly-shared/tone-diagnostics';
import type { CoarseBoundaryImportDiagnostics } from '../span-assembly-shared/coarse-boundary-import';
import type { CoarseAssemblyInternalResult, CoarseAssemblyToneDiagnostics } from '../span-assembly-shared/types';
import { allocateDomainBucketSentenceBudget } from '../span-assembly-shared/utterance-domain-vote';
import { runDomainAwareAssembly } from './assemble-domain-aware-span-sets';
import { blockedFilter } from './blocked-window-filter';
import { buildCandidateCompatibilityGraph, resolveCompatibilityRelations } from './candidate-compatibility-graph';
import { runLtrFineSpanGeneration } from './ltr-fine-span-generator';
import { recallTopKForWindows } from './recall-topk-for-windows';
import { rebindToneAfterFormalCommit } from './tone-commit-rebind';
import { buildFwSpansFromFormalFineSpans } from './build-fw-spans-from-coarse-assembly-v4';
import type { SpanAssemblyV4Metrics } from './v4-types';
import type { V4TraceCollector } from './v4-diagnostics-trace';
import { createV4TraceCollector } from './v4-diagnostics-trace';
import { resolveV4DiagnosticsConfig } from './v4-diagnostics-config';
import {
  toBoundaryWindowTrace,
  toCoarseSpanTrace,
  toEmittedEdgeFromCandidate,
} from './v4-diagnostics-mappers';
import {
  buildSentenceCandidates,
  mergeCrossBucketSentenceCandidates,
  type SentenceCombination,
} from '../build-sentence-candidates';
import {
  createUtteranceRecallContext,
  releaseUtteranceRecallContext,
} from './utterance-recall-cache';

export type SpanAssemblyV4OrchestratorInput = {
  rawText: string;
  runtime: LexiconRuntimeV2;
  profile: ActiveLexiconProfileSnapshot;
  /**
   * Unique Recall domain SSOT after CFG-01 / Registry resolution.
   * Must be non-empty; empty means fail-fast (not Base-only).
   */
  recallDomainScope: string[];
  minPrior: number;
  imeConfig: PinyinImeV2RuntimeConfig;
  dict: PinyinImeV2Dict;
  asrSegments?: SegmentInfo[];
  acousticSlices?: AcousticToneSlice[];
  asrSegmentNodeBatchIndices?: number[];
  segmentTimeOffsetsSec?: number[];
  segmentCharOffsets?: number[];
  /** Batch/probe case id for diagnostics targetIds matching (e.g. d001). */
  traceCaseId?: string;
  /** Soft prior only — never written into recallDomainScope / enabledDomains. */
  domainPriors?: readonly DomainPrior[];
  /**
   * Test/harness only: when false, skip utterance Fact cache (Baseline A).
   * Production default is true. Not a long-lived dual recall chain.
   */
  enableUtteranceRecallCache?: boolean;
};

export type SpanAssemblyV4OrchestratorResult = {
  internal: CoarseAssemblyInternalResult;
  spanSets: ReturnType<typeof runDomainAwareAssembly>['spanSets'];
  bucketSpanSets: ReturnType<typeof runDomainAwareAssembly>['bucketSpanSets'];
  fwSpans: ReturnType<typeof buildFwSpansFromFormalFineSpans>;
  boundaryImport: CoarseBoundaryImportDiagnostics;
  tone: CoarseAssemblyToneDiagnostics;
  metrics: SpanAssemblyV4Metrics;
  trace?: ReturnType<V4TraceCollector['toDiagnostics']>;
  kenlmSentenceCandidates?: {
    combinations: SentenceCombination[];
    intervalAssemblyCandidateCount: number;
    intervalRejectedOverlapCount: number;
    perBucketGenerated: SentenceCombination[][];
    mergedBeforeCap: SentenceCombination[];
    dedupReplacedCount: number;
  };
  /** Diagnostics-only active candidate snapshot (no formal path use). */
  diagActiveCandidates?: Array<{
    candidateId: string;
    text: string;
    domains: readonly string[];
    source: string;
    isCovered: boolean;
    hitKind: string;
  }>;
};

export function runSpanAssemblyV4Orchestrator(
  input: SpanAssemblyV4OrchestratorInput
): SpanAssemblyV4OrchestratorResult {
  if (!input.recallDomainScope.length) {
    throw new Error(
      '[SPAN_ASSEMBLY_V4] recallDomainScope is empty — Domain Recall must not silently degrade to Base-only'
    );
  }

  const assemblyStart = Date.now();
  const diagnosticsConfig = resolveV4DiagnosticsConfig(input.traceCaseId);
  const trace = createV4TraceCollector(diagnosticsConfig.traceActive);
  const syllableCoordinate = buildUtteranceSyllableCoordinate(input.rawText);
  const { syllables, hasCjk, ranges: charSyllableRanges } = syllableCoordinate;

  if (!hasCjk || !syllables.length) {
    return emptyResult(assemblyStart, { fallbackReason: 'no_cjk' }, input.acousticSlices, trace);
  }

  if (!syllableCoordinate.coverage.coverageOk) {
    throw new Error(
      `[SPAN_ASSEMBLY_V4] FineSpan syllable coverage invariant failed (covered=${syllableCoordinate.coverage.coveredCount}/${syllableCoordinate.coverage.syllableCount})`
    );
  }

  if (input.runtime.getManifestVersion() !== LEXICON_V3_FIVE_TABLE_V2_RUNTIME_SCHEMA_VERSION) {
    throw new Error(
      `[SPAN_ASSEMBLY_V4] requires ${LEXICON_V3_FIVE_TABLE_V2_RUNTIME_SCHEMA_VERSION}, got ${input.runtime.getManifestVersion() ?? 'unknown'}`
    );
  }

  const partition = partitionCoarseSpans({
    rawText: input.rawText,
    imeConfig: input.imeConfig,
    dict: input.dict,
    asrSegments: input.asrSegments,
  });
  const coarseSpans = partition.coarseSpans;
  if (!coarseSpans.length) {
    return emptyResult(assemblyStart, partition.diagnostics, input.acousticSlices, trace);
  }
  if (partition.diagnostics.coverageOk === false) {
    throw new Error(
      `[SPAN_ASSEMBLY_V4] CoarseSpan coverageOk=false after FineSpan coordinate SSOT (fallbackReason=${partition.diagnostics.fallbackReason ?? 'unknown'})`
    );
  }

  if (trace) {
    for (const span of coarseSpans) {
      trace.pushCoarseSpan(toCoarseSpanTrace(span));
    }
  }

  const recallDomainIds = [...input.recallDomainScope];
  if (!recallDomainIds.length) {
    throw new Error(
      '[SPAN_ASSEMBLY_V4] resolved recall domainIds is empty — Domain Recall must not silently degrade to Base-only'
    );
  }

  // Profile/weak-domain must not act as a second FineSpan soft prior (OWN/DCN).
  const fuzzyEnabled = isFuzzyPinyinRecallEnabled();
  const domainPriors = input.domainPriors ?? [];

  const toneTimestampOnlyEnabled = loadFwDetectorRuntimeConfig().toneTimestampOnlyEnabled;
  const wordTimeSpans = buildWordTimeSpans(
    input.rawText,
    input.asrSegments ?? [],
    input.segmentTimeOffsetsSec ?? [],
    input.segmentCharOffsets ?? [],
    input.asrSegmentNodeBatchIndices ?? []
  );

  let toneFromRecall = createEmptyToneDiagnostics(
    input.acousticSlices,
    wordTimeSpans,
    toneTimestampOnlyEnabled
  );
  let ngramQueryCount = 0;
  let parentFragmentHitCount = 0;
  let physicalSqlStatementCountAccum = 0;

  const utteranceRecall =
    input.enableUtteranceRecallCache === false
      ? null
      : createUtteranceRecallContext(input.runtime.getManifestVersion() ?? 'unknown');

  const ltr = runLtrFineSpanGeneration({
    rawText: input.rawText,
    globalSyllables: syllables,
    coarseSpans,
    domainPriors,
    charSyllableRanges,
    recallForWindows: (windows) => {
      const filtered = blockedFilter({
        windows,
        rawText: input.rawText,
        coarseSpans,
        wordTimeSpans,
      }).filter((w) => !w.blocked);
      if (!filtered.length) {
        return [];
      }
      const recall = recallTopKForWindows({
        rawText: input.rawText,
        globalSyllables: syllables,
        windows: filtered,
        runtime: input.runtime,
        profile: input.profile,
        domainIds: recallDomainIds,
        minPrior: input.minPrior,
        weakDomainPlan: undefined,
        fuzzyRecallEnabled: fuzzyEnabled,
        acousticSlices: input.acousticSlices,
        wordTimeSpans,
        toneTimestampOnlyEnabled,
        trace,
        utteranceRecall,
      });
        toneFromRecall = recall.tone;
        ngramQueryCount += recall.ngramQueryCount;
        parentFragmentHitCount += recall.parentFragmentHitCount;
        physicalSqlStatementCountAccum += recall.physicalSqlStatementCount;
        return recall.candidates;
      },
    });

  const utteranceRecallStats = utteranceRecall
    ? { ...utteranceRecall.stats }
    : {
        requestCount: 0,
        uniqueKeyCount: 0,
        duplicateKeyCount: 0,
        hitCount: 0,
        missCount: 0,
        exactQueryCount: 0,
        parentQueryCount: 0,
        physicalSqlStatementCount: 0,
        recallRequestBuildMs: 0,
        utteranceCacheLookupMs: 0,
        lexiconFactLookupMs: 0,
        windowBindingMs: 0,
        lexiconRecallTotalMs: 0,
      };
  const cacheHitRatio =
    utteranceRecallStats.requestCount > 0
      ? utteranceRecallStats.hitCount / utteranceRecallStats.requestCount
      : 0;
  if (utteranceRecall) {
    releaseUtteranceRecallContext(utteranceRecall);
  }

  const physicalSqlStatementCount = physicalSqlStatementCountAccum;
  if (utteranceRecall) {
    // Keep stats SSOT aligned with observed deltas.
    utteranceRecallStats.physicalSqlStatementCount = physicalSqlStatementCountAccum;
  }

  // BLOCK-3: Formal commit 后按 Formal range 重绑定 Tone（切片/缓存读取，非二次模型推理）
  const toneCommitTraces = ltr.formalSpans.map((span) =>
    rebindToneAfterFormalCommit(span, input.acousticSlices, wordTimeSpans, toneTimestampOnlyEnabled)
  );

  const generatedCount = ltr.trace.steps.reduce((sum, step) => sum + step.options.length, 0);
  const blockedWindowCount = 0;
  const truncatedCount = 0;
  const architectureCompliance = {
    generatorMode: 'ltr_soft_boundary' as const,
    formalOverlapCount: ltr.trace.formalOverlapCount,
    beamEnabled: false as const,
    globalWindowProductionPath: false as const,
    fineSpanPriorSource: (domainPriors.length ? 'domainPriors' : 'none') as 'domainPriors' | 'none',
    contextPriorDecisionApplied: false as const,
    priorWrittenToEnabledDomains: false as const,
    profileAffectedRecall: false as const,
    votePoolSource: 'formal_fine_span' as const,
    sessionPriorTransport: 'audio_chunk_session_snapshot' as const,
    topicShiftContractComplete: true as const,
    schedulerDomainInference: false as const,
    toneRecomputedAfterCommit: toneCommitTraces.every((t) => t.recomputedAfterCommit),
  };

  if (trace) {
    for (const span of ltr.formalSpans) {
      if (span.boundaryCrossCount === 1) {
        trace.pushBoundaryWindow(
          toBoundaryWindowTrace({
            windowId: `${span.syllableStart}:${span.syllableEnd}`,
            syllableStart: span.syllableStart,
            syllableEnd: span.syllableEnd,
            rawStart: span.rawStart,
            rawEnd: span.rawEnd,
            windowText: input.rawText.slice(span.rawStart, span.rawEnd),
            windowPinyinKey: '',
            spanIds: [...span.coarseSpanIds],
            boundaryCrossCount: span.boundaryCrossCount,
            windowSource: 'boundary_window',
            anchorCoarseSpanId: span.coarseSpanIds[0] ?? span.spanId,
            blocked: false,
          })
        );
      }
    }
  }

  const allCandidates = ltr.formalSpans.flatMap((s) => s.candidates);
  const { edgeCount: compatibilityEdgeCount } = buildCandidateCompatibilityGraph(allCandidates);
  const compatibility = resolveCompatibilityRelations(allCandidates, trace);
  const activeCandidates = compatibility.activeCandidates;
  const domainRecallHitCount = activeCandidates.filter(
    (c) =>
      !c.isCovered &&
      (c.source === 'domain_term' || c.source === 'passive_domain_weak')
  ).length;
  const voteEligibleDomainCandidateCount = activeCandidates.filter(
    (c) =>
      !c.isCovered &&
      Boolean(c.domains?.some((d) => d && d !== 'general' && d !== 'base_term'))
  ).length;

  if (trace) {
    for (const candidate of activeCandidates) {
      if (candidate.isCovered) {
        continue;
      }
      if (candidate.hitKind === 'exact_term') {
        trace.pushEmittedEdge(toEmittedEdgeFromCandidate(candidate, 'exact_term'));
      }
    }
  }

  const domainAssembly = runDomainAwareAssembly(
    activeCandidates,
    coarseSpans,
    input.rawText,
    ltr.formalSpans,
    domainPriors
  );
  const domainAwareSpanSets = domainAssembly.spanSets;
  const primaryDomain =
    domainAssembly.vote.retainedDomains[0] ?? domainAssembly.vote.utteranceDomain;

  // Zip by committed Formal FineSpan — domainAwareSpanSets is pool-ordered by formal span,
  // not by coarseSpans partition (their counts can legitimately differ; AC-02).
  const fwSpans = buildFwSpansFromFormalFineSpans(
    input.rawText,
    ltr.formalSpans,
    domainAwareSpanSets,
    primaryDomain
  );

  const kenlmCap = loadFwDetectorRuntimeConfig().maxSentenceCandidates;
  // Guard only: retained buckets must each be able to receive ≥1 final slot if needed.
  // Per-bucket generation uses the same MAX (16), then cross-bucket dedup, then global cap.
  allocateDomainBucketSentenceBudget(domainAssembly.bucketSpanSets.length, kenlmCap);
  const perBucketGenerateCap = kenlmCap;
  const perBucketGenerated: SentenceCombination[][] = [];
  let intervalAssemblyCandidateCount = 0;
  let intervalRejectedOverlapCount = 0;
  for (const bucketSets of domainAssembly.bucketSpanSets) {
    const bucketResult = buildSentenceCandidates(input.rawText, bucketSets, perBucketGenerateCap);
    intervalAssemblyCandidateCount += bucketResult.intervalAssemblyCandidateCount;
    intervalRejectedOverlapCount += bucketResult.intervalRejectedOverlapCount;
    perBucketGenerated.push(bucketResult.combinations);
  }
  const merged = mergeCrossBucketSentenceCandidates(perBucketGenerated, kenlmCap);
  const kenlmSentenceCandidates = {
    combinations: merged.combinations,
    intervalAssemblyCandidateCount,
    intervalRejectedOverlapCount,
    perBucketGenerated,
    mergedBeforeCap: merged.mergedBeforeCap,
    dedupReplacedCount: merged.dedupReplacedCount,
  };
  if (trace) {
    for (const combo of kenlmSentenceCandidates.combinations) {
      trace.pushSentenceCandidate({
        sentence: combo.text,
        replacements: combo.replacements.map((r) => r.word),
        score: combo.candidateScore,
      });
    }
  }

  const internal: CoarseAssemblyInternalResult = {
    coarseSpans,
    retainedDomains: [...domainAssembly.vote.retainedDomains],
    utteranceDomain: primaryDomain,
    sentenceCandidates: kenlmSentenceCandidates.combinations.map((c) => c.text),
  };

  return {
    internal,
    spanSets: domainAwareSpanSets,
    bucketSpanSets: domainAssembly.bucketSpanSets,
    fwSpans,
    boundaryImport: partition.diagnostics,
    tone: toneFromRecall,
    metrics: {
      coarseSpanCount: coarseSpans.length,
      globalWindowGeneratedCount: generatedCount,
      blockedWindowCount,
      truncatedWindowCount: truncatedCount,
      ngramQueryCount,
      windowCandidatePoolCount: compatibility.metrics.activeCandidateCount,
      activeCandidateCount: compatibility.metrics.activeCandidateCount,
      compatibilityEdgeCount,
      droppedCandidateCount: compatibility.metrics.hardDropCount,
      coverageCount: compatibility.metrics.coverageCount,
      conflictCount: 0,
      conflictRelationCount: compatibility.metrics.conflictRelationCount,
      hardDropCount: compatibility.metrics.hardDropCount,
      compatibleCount: compatibility.metrics.compatibleCount,
      utteranceDomain: primaryDomain,
      domainVoteMs: domainAssembly.vote.domainVoteMs,
      winnerScore: domainAssembly.vote.maxCount,
      runnerUpDomain: domainAssembly.vote.runnerUpDomain,
      runnerUpScore: domainAssembly.vote.runnerUpCount,
      voteMargin: domainAssembly.vote.voteMargin,
      assemblyMs: Date.now() - assemblyStart,
      parentFragmentHitCount,
      parentTermVoteCount: domainAssembly.vote.parentTermVoteCount,
      inSpanWindowCount: ltr.formalSpans.filter((s) => s.windowSource === 'in_span_window').length,
      boundaryWindowCount: ltr.formalSpans.filter((s) => s.windowSource === 'boundary_window').length,
      domainCandidateCount: domainAssembly.metrics.domainCandidateCount,
      baseCandidateCount: domainAssembly.metrics.baseCandidateCount,
      sameDomainCandidateCount: domainAssembly.metrics.sameDomainCandidateCount,
      domainFilteredSpanCount: domainAssembly.metrics.domainFilteredSpanCount,
      selectedCandidatesPerSpanAvg: domainAssembly.metrics.selectedCandidatesPerSpanAvg,
      domainAssemblyMs: domainAssembly.metrics.domainAssemblyMs,
      mainDomainAwareSpanSetsTotal: domainAssembly.metrics.mainDomainAwareSpanSetsTotal,
      retainedBucketCount: domainAssembly.metrics.retainedBucketCount,
      intervalAssemblyCandidateCount: kenlmSentenceCandidates.intervalAssemblyCandidateCount,
      intervalRejectedOverlapCount: kenlmSentenceCandidates.intervalRejectedOverlapCount,
      fallbackCandidateCount: domainAssembly.filteredSets.reduce(
        (sum, set) => sum + set.fallbackCandidates.length,
        0
      ),
      kenlmPoolCandidateCount: kenlmSentenceCandidates.combinations.length,
      preFilterCombinationCount: kenlmSentenceCandidates.intervalAssemblyCandidateCount,
      domainScores: domainAssembly.vote.domainScores,
      retainedDomains: domainAssembly.vote.retainedDomains,
      winningFineDomain: primaryDomain,
      insufficientEvidence: domainAssembly.vote.insufficientEvidence,
      domainLookupExecuted: true,
      domainLookupDomainCount: recallDomainIds.length,
      domainRecallHitCount,
      voteEligibleDomainCandidateCount,
      resolvedRecallDomainScope: [...input.recallDomainScope],
      architectureCompliance,
      recallRequestCount: utteranceRecallStats.requestCount,
      uniqueRecallKeyCount: utteranceRecallStats.uniqueKeyCount,
      duplicateRecallKeyCount: utteranceRecallStats.duplicateKeyCount,
      utteranceCacheHitCount: utteranceRecallStats.hitCount,
      utteranceCacheMissCount: utteranceRecallStats.missCount,
      cacheHitRatio,
      logicalQueryCount: utteranceRecallStats.requestCount,
      physicalSqlStatementCount,
      exactQueryCount: utteranceRecallStats.exactQueryCount,
      parentQueryCount: utteranceRecallStats.parentQueryCount,
      lexiconRecallTotalMs: utteranceRecallStats.lexiconRecallTotalMs,
      recallRequestBuildMs: utteranceRecallStats.recallRequestBuildMs,
      utteranceCacheLookupMs: utteranceRecallStats.utteranceCacheLookupMs,
      lexiconFactLookupMs: utteranceRecallStats.lexiconFactLookupMs,
      windowBindingMs: utteranceRecallStats.windowBindingMs,
    },
    trace: trace?.toDiagnostics(),
    kenlmSentenceCandidates,
    ...(diagnosticsConfig.enabled
      ? {
          diagActiveCandidates: activeCandidates.map((c) => ({
            candidateId: c.candidateId,
            text: c.replacement,
            domains: c.domains ?? [],
            source: c.source,
            isCovered: c.isCovered === true,
            hitKind: c.hitKind,
          })),
        }
      : {}),
  };
}

function emptyResult(
  assemblyStart: number,
  boundaryImport: Partial<CoarseBoundaryImportDiagnostics>,
  acousticSlices?: AcousticToneSlice[],
  trace?: V4TraceCollector | null
): SpanAssemblyV4OrchestratorResult {
  const toneTimestampOnlyEnabled = loadFwDetectorRuntimeConfig().toneTimestampOnlyEnabled;
  const diagnostics: CoarseBoundaryImportDiagnostics = {
    rawSyllableCount: boundaryImport.rawSyllableCount ?? 0,
    imeCandidateCount: boundaryImport.imeCandidateCount ?? 0,
    trustedTopKCount: boundaryImport.trustedTopKCount ?? 0,
    imeBoundaryCount: boundaryImport.imeBoundaryCount ?? 0,
    rawBoundaryCount: boundaryImport.rawBoundaryCount ?? 0,
    alignedBoundaryCount: boundaryImport.alignedBoundaryCount ?? 0,
    proposalBoundaryCount: boundaryImport.proposalBoundaryCount ?? 0,
    asrWordBoundaryCount: boundaryImport.asrWordBoundaryCount ?? 0,
    punctuationFallbackBoundaryCount: boundaryImport.punctuationFallbackBoundaryCount ?? 0,
    finalCoarseSpanCount: 0,
    coverageOk: false,
    boundarySourceBreakdown: boundaryImport.boundarySourceBreakdown ?? {
      ime_token_boundary: 0,
      raw_ime_aligned_boundary: 0,
      proposal_active_boundary: 0,
      asr_word_boundary: 0,
      punctuation_fallback: 0,
    },
    fallbackReason: boundaryImport.fallbackReason,
  };

  return {
    internal: {
      coarseSpans: [],
      retainedDomains: [],
      utteranceDomain: 'general',
      sentenceCandidates: [],
    },
    spanSets: [],
    bucketSpanSets: [],
    fwSpans: [],
    boundaryImport: diagnostics,
    tone: createEmptyToneDiagnostics(acousticSlices, [], toneTimestampOnlyEnabled),
    metrics: {
      coarseSpanCount: 0,
      globalWindowGeneratedCount: 0,
      blockedWindowCount: 0,
      truncatedWindowCount: 0,
      ngramQueryCount: 0,
      windowCandidatePoolCount: 0,
      activeCandidateCount: 0,
      compatibilityEdgeCount: 0,
      droppedCandidateCount: 0,
      coverageCount: 0,
      conflictCount: 0,
      conflictRelationCount: 0,
      hardDropCount: 0,
      compatibleCount: 0,
      utteranceDomain: 'general',
      domainVoteMs: 0,
      winnerScore: 0,
      runnerUpDomain: 'general',
      runnerUpScore: 0,
      voteMargin: 0,
      assemblyMs: Date.now() - assemblyStart,
      parentFragmentHitCount: 0,
      parentTermVoteCount: 0,
      inSpanWindowCount: 0,
      boundaryWindowCount: 0,
      domainCandidateCount: 0,
      baseCandidateCount: 0,
      sameDomainCandidateCount: 0,
      domainFilteredSpanCount: 0,
      selectedCandidatesPerSpanAvg: 0,
      domainAssemblyMs: 0,
      mainDomainAwareSpanSetsTotal: 0,
      retainedBucketCount: 0,
      intervalAssemblyCandidateCount: 0,
      intervalRejectedOverlapCount: 0,
      fallbackCandidateCount: 0,
      kenlmPoolCandidateCount: 0,
      preFilterCombinationCount: 0,
      domainScores: {},
      retainedDomains: [],
      winningFineDomain: 'general',
      insufficientEvidence: true,
      domainLookupExecuted: false,
      domainLookupDomainCount: 0,
      domainRecallHitCount: 0,
      voteEligibleDomainCandidateCount: 0,
      resolvedRecallDomainScope: [],
    },
    trace: trace?.toDiagnostics(),
  };
}
