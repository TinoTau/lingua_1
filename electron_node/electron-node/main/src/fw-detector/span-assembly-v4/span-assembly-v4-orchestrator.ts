/**
 * FW Repair V4 — Span Assembly Orchestrator (Lattice Fine Span production entry).
 *
 * Fine Span: runLatticeFineSpanGeneration.
 * Path-local: Tone → Vote → SameDomain Bucket → Assembly per PathFineSpanView.
 * Cross-Path: mergeCrossPathSentenceCandidates → unique KenLM input (≤16, dedup-before-cap).
 */

import type { SegmentInfo } from '../../task-router/types';
import { loadFwDetectorRuntimeConfig } from '../fw-config';
import { buildWordTimeSpans, type AcousticToneSlice } from '../tone-time-align';
import type { ToneEvidenceProductionDiagnostic } from '../../task-router/types';
import type { LexiconRuntimeV2 } from '../../lexicon-v2/lexicon-runtime-v2';
import { LEXICON_V3_RUNTIME_V3_SCHEMA_VERSION } from '../../lexicon-v2/lexicon-types-v2';
import { isFuzzyPinyinRecallEnabled } from '../../lexicon-v2/lexicon-fw-recall-config';
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
import type { DomainAwareAssemblyResult } from './domain-assembly-types';
import { buildCandidateCompatibilityGraph, resolveCompatibilityRelations } from './candidate-compatibility-graph';
import {
  runLatticeFineSpanGeneration,
  type LatticeFineSpanTrace,
} from './lattice-fine-span-runtime';
import { rebindToneForFineSpan } from './tone-fine-span-rebind';
import { buildFwSpansFromPathFineSpans } from './build-fw-spans-from-coarse-assembly-v4';
import type { PathFineSpan } from './path-fine-span-types';
import type { SpanAssemblyV4Metrics, WindowCandidate } from './v4-types';
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
  type SentenceCombination,
} from '../build-sentence-candidates';
import type { FwSpanDiagnostics } from '../types';
import { mergeCrossPathSentenceCandidates } from './merge-cross-path-sentence-candidates';
import type { CrossPathMergeTrace } from './merge-cross-path-sentence-candidates';

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
  toneEvidenceProduction?: ToneEvidenceProductionDiagnostic[];
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

/** Path ownership wrapper — does not duplicate Vote/Bucket/Sentence DTOs. */
export type PathAssemblyResult = {
  pathId: string;
  boundaryKey: string;
  pathFineSpans: readonly PathFineSpan[];
  assemblyResult: DomainAwareAssemblyResult;
  fwSpans: FwSpanDiagnostics[];
  perBucketGenerated: SentenceCombination[][];
  sentenceCandidateCount: number;
};

export type PathAssemblyTrace = {
  pathId: string;
  boundaryKey: string;
  pathFineSpanCount: number;
  fallbackSpanCount: number;
  toneEvidenceAvailableCount: number;
  toneEvidenceUnavailableCount: number;
  domainScores: Record<string, number>;
  retainedDomains: readonly string[];
  bucketCount: number;
  bucketCandidateCounts: readonly number[];
  assemblyCandidateCount: number;
  toneRebindOk: boolean;
};

export type SpanAssemblyV4OrchestratorResult = {
  internal: CoarseAssemblyInternalResult;
  spanSets: ReturnType<typeof runDomainAwareAssembly>['spanSets'];
  bucketSpanSets: ReturnType<typeof runDomainAwareAssembly>['bucketSpanSets'];
  fwSpans: ReturnType<typeof buildFwSpansFromPathFineSpans>;
  boundaryImport: CoarseBoundaryImportDiagnostics;
  tone: CoarseAssemblyToneDiagnostics;
  metrics: SpanAssemblyV4Metrics;
  trace?: ReturnType<V4TraceCollector['toDiagnostics']>;
  kenlmSentenceCandidates?: {
    combinations: SentenceCombination[];
    intervalAssemblyCandidateCount: number;
    intervalRejectedOverlapCount: number;
    perBucketGenerated: SentenceCombination[][];
    uniqueBeforeCap: SentenceCombination[];
    crossPathMerge: CrossPathMergeTrace;
  };
  /** Per-path Vote → Bucket → Assembly ownership. */
  pathAssemblyResults: readonly PathAssemblyResult[];
  latticeTrace?: LatticeFineSpanTrace;
  pathAssemblyTraces?: readonly PathAssemblyTrace[];
  crossPathMergeTrace?: CrossPathMergeTrace;
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

function clonePathFineSpansForTone(spans: readonly PathFineSpan[]): PathFineSpan[] {
  return spans.map((span) => ({
    ...span,
    coarseSpanIds: [...span.coarseSpanIds],
    candidates: span.candidates.map((c) => ({ ...c, domains: c.domains ? [...c.domains] : c.domains })),
  }));
}

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
  const { syllables, hasCjk } = syllableCoordinate;

  if (!hasCjk || !syllables.length) {
    return emptyResult(assemblyStart, { fallbackReason: 'no_cjk' }, input.acousticSlices, trace);
  }

  if (!syllableCoordinate.coverage.coverageOk) {
    throw new Error(
      `[SPAN_ASSEMBLY_V4] FineSpan syllable coverage invariant failed (covered=${syllableCoordinate.coverage.coveredCount}/${syllableCoordinate.coverage.syllableCount})`
    );
  }

  if (input.runtime.getManifestVersion() !== LEXICON_V3_RUNTIME_V3_SCHEMA_VERSION) {
    throw new Error(
      `[SPAN_ASSEMBLY_V4] requires ${LEXICON_V3_RUNTIME_V3_SCHEMA_VERSION}, got ${input.runtime.getManifestVersion() ?? 'unknown'}`
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

  const lattice = runLatticeFineSpanGeneration({
    rawText: input.rawText,
    runtime: input.runtime,
    profile: input.profile,
    domainIds: recallDomainIds,
    minPrior: input.minPrior,
    imeConfig: input.imeConfig,
    dict: input.dict,
    coarseSpans,
    wordTimeSpans,
    acousticSlices: input.acousticSlices,
    toneEvidenceProduction: input.toneEvidenceProduction,
    fuzzyRecallEnabled: fuzzyEnabled,
    toneTimestampOnlyEnabled,
    enableUtteranceRecallCache: input.enableUtteranceRecallCache,
    trace,
  });

  if (!lattice.ok) {
    // Structured Lattice failure — never fall back to a legacy Fine Span generator.
    throw new Error(`[SPAN_ASSEMBLY_V4][LATTICE_${lattice.code}] ${lattice.message}`);
  }

  const utteranceRecallStats = lattice.utteranceRecallStats;
  const cacheHitRatio =
    utteranceRecallStats.requestCount > 0
      ? utteranceRecallStats.hitCount / utteranceRecallStats.requestCount
      : 0;

  const pathAssemblyResults: PathAssemblyResult[] = [];
  const pathAssemblyTraces: PathAssemblyTrace[] = [];
  const allToneOk: boolean[] = [];
  let intervalAssemblyCandidateCount = 0;
  let intervalRejectedOverlapCount = 0;
  let compatibilityEdgeCountTotal = 0;
  let activeCandidateCountTotal = 0;
  let hardDropCountTotal = 0;
  let coverageCountTotal = 0;
  let conflictRelationCountTotal = 0;
  let compatibleCountTotal = 0;
  let domainRecallHitCount = 0;
  let voteEligibleDomainCandidateCount = 0;
  const diagActive: WindowCandidate[] = [];

  for (const view of lattice.pathFineSpanViews) {
    const pathFineSpans = clonePathFineSpansForTone(view.pathFineSpans);
    const toneTraces = pathFineSpans.map((span) =>
      rebindToneForFineSpan(span, input.acousticSlices, wordTimeSpans, toneTimestampOnlyEnabled)
    );
    const toneRebindOk = toneTraces.every((t) => t.recomputedAfterRebind);
    allToneOk.push(toneRebindOk);
    const toneEvidenceAvailableCount = toneTraces.filter((t) => t.acousticTonePattern != null).length;
    const toneEvidenceUnavailableCount = toneTraces.length - toneEvidenceAvailableCount;

    if (trace) {
      for (const span of pathFineSpans) {
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

    const pathCandidates = pathFineSpans.flatMap((s) => s.candidates);
    const { edgeCount } = buildCandidateCompatibilityGraph(pathCandidates);
    const compatibility = resolveCompatibilityRelations(pathCandidates, trace);
    compatibilityEdgeCountTotal += edgeCount;
    activeCandidateCountTotal += compatibility.metrics.activeCandidateCount;
    hardDropCountTotal += compatibility.metrics.hardDropCount;
    coverageCountTotal += compatibility.metrics.coverageCount;
    conflictRelationCountTotal += compatibility.metrics.conflictRelationCount;
    compatibleCountTotal += compatibility.metrics.compatibleCount;

    const activeCandidates = compatibility.activeCandidates;
    domainRecallHitCount += activeCandidates.filter(
      (c) =>
        !c.isCovered &&
        (c.source === 'domain_term' || c.source === 'passive_domain_weak')
    ).length;
    voteEligibleDomainCandidateCount += activeCandidates.filter(
      (c) =>
        !c.isCovered &&
        Boolean(c.domains?.some((d) => d && d !== 'general' && d !== 'base_term'))
    ).length;
    diagActive.push(...activeCandidates.filter((c) => !c.isCovered));

    if (trace) {
      for (const candidate of activeCandidates) {
        if (candidate.isCovered) continue;
        if (candidate.hitKind === 'exact_term') {
          trace.pushEmittedEdge(toEmittedEdgeFromCandidate(candidate, 'exact_term'));
        }
      }
    }

    // Path-local Vote → Bucket → Assembly (never mix Path A/B candidates first).
    const assemblyResult = runDomainAwareAssembly(
      activeCandidates,
      coarseSpans,
      input.rawText,
      pathFineSpans,
      domainPriors
    );
    const primaryDomain =
      assemblyResult.vote.retainedDomains[0] ?? assemblyResult.vote.utteranceDomain;
    const fwSpans = buildFwSpansFromPathFineSpans(
      input.rawText,
      pathFineSpans,
      assemblyResult.spanSets,
      primaryDomain
    );

    const kenlmCap = loadFwDetectorRuntimeConfig().maxSentenceCandidates;
    allocateDomainBucketSentenceBudget(assemblyResult.bucketSpanSets.length, kenlmCap);
    const perBucketGenerated: SentenceCombination[][] = [];
    let pathSentenceCount = 0;
    for (const bucketSets of assemblyResult.bucketSpanSets) {
      // Path-local generation budget (existing Assembly contract) — not the global KenLM cap.
      const bucketResult = buildSentenceCandidates(input.rawText, bucketSets, kenlmCap);
      intervalAssemblyCandidateCount += bucketResult.intervalAssemblyCandidateCount;
      intervalRejectedOverlapCount += bucketResult.intervalRejectedOverlapCount;
      perBucketGenerated.push(bucketResult.combinations);
      pathSentenceCount += bucketResult.combinations.length;
    }

    pathAssemblyResults.push({
      pathId: view.pathId,
      boundaryKey: view.boundaryKey,
      pathFineSpans,
      assemblyResult,
      fwSpans,
      perBucketGenerated,
      sentenceCandidateCount: pathSentenceCount,
    });
    pathAssemblyTraces.push({
      pathId: view.pathId,
      boundaryKey: view.boundaryKey,
      pathFineSpanCount: pathFineSpans.length,
      fallbackSpanCount: pathFineSpans.filter((s) => s.windowSource === 'fallback').length,
      toneEvidenceAvailableCount,
      toneEvidenceUnavailableCount,
      domainScores: { ...assemblyResult.vote.domainScores },
      retainedDomains: [...assemblyResult.vote.retainedDomains],
      bucketCount: assemblyResult.bucketSpanSets.length,
      bucketCandidateCounts: perBucketGenerated.map((list) => list.length),
      assemblyCandidateCount: pathSentenceCount,
      toneRebindOk,
    });
  }

  const kenlmCap = loadFwDetectorRuntimeConfig().maxSentenceCandidates;
  // Formal Cross-Path Merge: collect all Path/Bucket candidates → dedup(text, first-wins) → global ≤16.
  const crossPathMerged = mergeCrossPathSentenceCandidates(pathAssemblyResults, kenlmCap);
  const flatPerBucketGenerated = pathAssemblyResults.flatMap((p) => [...p.perBucketGenerated]);
  const kenlmSentenceCandidates = {
    combinations: crossPathMerged.combinations,
    intervalAssemblyCandidateCount,
    intervalRejectedOverlapCount,
    perBucketGenerated: flatPerBucketGenerated,
    uniqueBeforeCap: crossPathMerged.uniqueBeforeCap,
    crossPathMerge: crossPathMerged.trace,
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

  const primary = pathAssemblyResults[0]!;
  const primaryAssembly = primary.assemblyResult;
  const primaryDomain =
    primaryAssembly.vote.retainedDomains[0] ?? primaryAssembly.vote.utteranceDomain;

  // Aggregate assembly metrics across paths (primary vote fields for utterance summary).
  const aggregatedAssemblyMetrics = pathAssemblyResults.reduce(
    (acc, p) => {
      const m = p.assemblyResult.metrics;
      return {
        domainCandidateCount: acc.domainCandidateCount + m.domainCandidateCount,
        baseCandidateCount: acc.baseCandidateCount + m.baseCandidateCount,
        sameDomainCandidateCount: acc.sameDomainCandidateCount + m.sameDomainCandidateCount,
        domainFilteredSpanCount: acc.domainFilteredSpanCount + m.domainFilteredSpanCount,
        selectedCandidatesPerSpanAvg: acc.selectedCandidatesPerSpanAvg + m.selectedCandidatesPerSpanAvg,
        domainAssemblyMs: acc.domainAssemblyMs + m.domainAssemblyMs,
        mainDomainAwareSpanSetsTotal: acc.mainDomainAwareSpanSetsTotal + m.mainDomainAwareSpanSetsTotal,
        retainedBucketCount: acc.retainedBucketCount + m.retainedBucketCount,
      };
    },
    {
      domainCandidateCount: 0,
      baseCandidateCount: 0,
      sameDomainCandidateCount: 0,
      domainFilteredSpanCount: 0,
      selectedCandidatesPerSpanAvg: 0,
      domainAssemblyMs: 0,
      mainDomainAwareSpanSetsTotal: 0,
      retainedBucketCount: 0,
    }
  );
  if (pathAssemblyResults.length > 0) {
    aggregatedAssemblyMetrics.selectedCandidatesPerSpanAvg /= pathAssemblyResults.length;
  }

  const allPathSpans = pathAssemblyResults.flatMap((p) => p.pathFineSpans);
  const architectureCompliance = {
    generatorMode: 'multi_path_lattice' as const,
    fineSpanOwner: 'segmentation_path' as const,
    voteScope: 'per_path' as const,
    assemblyScope: 'per_path' as const,
    retainedCompletePathCount: lattice.trace.retainedCompletePathCount,
    beamEnabled: false as const,
    globalWindowProductionPath: false as const,
    fineSpanPriorSource: (domainPriors.length ? 'domainPriors' : 'none') as 'domainPriors' | 'none',
    contextPriorDecisionApplied: false as const,
    priorWrittenToEnabledDomains: false as const,
    profileAffectedRecall: false as const,
    votePoolSource: 'path_fine_span' as const,
    sessionPriorTransport: 'audio_chunk_session_snapshot' as const,
    topicShiftContractComplete: true as const,
    schedulerDomainInference: false as const,
    toneRecomputedAfterRebind: allToneOk.every(Boolean),
    crossPathMergeOwner: 'mergeCrossPathSentenceCandidates' as const,
    candidateCapScope: 'global' as const,
    candidateCap: kenlmCap,
    dedupBeforeCap: true as const,
    dedupRetention: 'first_wins' as const,
    kenlmInputOwner: 'cross_path_merge' as const,
    prefilledCombinationsRequired: true as const,
    toneEvidenceOwner: 'acoustic_tone_slices' as const,
  };

  const internal: CoarseAssemblyInternalResult = {
    coarseSpans,
    retainedDomains: [...primaryAssembly.vote.retainedDomains],
    utteranceDomain: primaryDomain,
    sentenceCandidates: kenlmSentenceCandidates.combinations.map((c) => c.text),
  };

  return {
    internal,
    spanSets: primary.assemblyResult.spanSets,
    bucketSpanSets: primary.assemblyResult.bucketSpanSets,
    fwSpans: primary.fwSpans,
    boundaryImport: partition.diagnostics,
    tone: lattice.tone,
    pathAssemblyResults,
    latticeTrace: lattice.trace,
    pathAssemblyTraces,
    crossPathMergeTrace: crossPathMerged.trace,
    metrics: {
      coarseSpanCount: coarseSpans.length,
      globalWindowGeneratedCount: lattice.trace.windowCount,
      blockedWindowCount: lattice.trace.blockedWindowCount,
      truncatedWindowCount: 0,
      logicalWindowRecallCount: lattice.trace.logicalWindowRecallCount,
      windowCandidatePoolCount: activeCandidateCountTotal,
      activeCandidateCount: activeCandidateCountTotal,
      compatibilityEdgeCount: compatibilityEdgeCountTotal,
      droppedCandidateCount: hardDropCountTotal,
      coverageCount: coverageCountTotal,
      conflictCount: 0,
      conflictRelationCount: conflictRelationCountTotal,
      hardDropCount: hardDropCountTotal,
      compatibleCount: compatibleCountTotal,
      utteranceDomain: primaryDomain,
      domainVoteMs: primaryAssembly.vote.domainVoteMs,
      winnerScore: primaryAssembly.vote.maxCount,
      runnerUpDomain: primaryAssembly.vote.runnerUpDomain,
      runnerUpScore: primaryAssembly.vote.runnerUpCount,
      voteMargin: primaryAssembly.vote.voteMargin,
      assemblyMs: Date.now() - assemblyStart,
      // JOBRESULT_ADAPTER_DEBT: parent-fragment recall retired (Phase 2/3); always 0.
      // Field retained on SpanAssemblyV4Metrics only for JobResult contract stability.
      parentFragmentHitCount: lattice.parentFragmentHitCount,
      // JOBRESULT_ADAPTER_DEBT: parent-term structural vote retired (Phase 2/3); always 0.
      parentTermVoteCount: primaryAssembly.vote.parentTermVoteCount,
      inSpanWindowCount: allPathSpans.filter((s) => s.windowSource === 'in_span_window').length,
      boundaryWindowCount: allPathSpans.filter((s) => s.windowSource === 'boundary_window').length,
      domainCandidateCount: aggregatedAssemblyMetrics.domainCandidateCount,
      baseCandidateCount: aggregatedAssemblyMetrics.baseCandidateCount,
      sameDomainCandidateCount: aggregatedAssemblyMetrics.sameDomainCandidateCount,
      domainFilteredSpanCount: aggregatedAssemblyMetrics.domainFilteredSpanCount,
      selectedCandidatesPerSpanAvg: aggregatedAssemblyMetrics.selectedCandidatesPerSpanAvg,
      domainAssemblyMs: aggregatedAssemblyMetrics.domainAssemblyMs,
      mainDomainAwareSpanSetsTotal: aggregatedAssemblyMetrics.mainDomainAwareSpanSetsTotal,
      retainedBucketCount: aggregatedAssemblyMetrics.retainedBucketCount,
      intervalAssemblyCandidateCount: kenlmSentenceCandidates.intervalAssemblyCandidateCount,
      intervalRejectedOverlapCount: kenlmSentenceCandidates.intervalRejectedOverlapCount,
      fallbackCandidateCount: pathAssemblyResults.reduce(
        (sum, p) =>
          sum + p.assemblyResult.filteredSets.reduce((s, set) => s + set.fallbackCandidates.length, 0),
        0
      ),
      kenlmPoolCandidateCount: kenlmSentenceCandidates.combinations.length,
      preFilterCombinationCount: kenlmSentenceCandidates.intervalAssemblyCandidateCount,
      domainScores: primaryAssembly.vote.domainScores,
      retainedDomains: primaryAssembly.vote.retainedDomains,
      winningFineDomain: primaryDomain,
      insufficientEvidence: primaryAssembly.vote.insufficientEvidence,
      domainLookupExecuted: true,
      domainLookupDomainCount: recallDomainIds.length,
      domainRecallHitCount,
      voteEligibleDomainCandidateCount,
      resolvedRecallDomainScope: [...input.recallDomainScope],
      architectureCompliance,
      crossPathInputCandidateCount: crossPathMerged.trace.crossPathInputCandidateCount,
      crossPathDuplicateCount: crossPathMerged.trace.crossPathDuplicateCount,
      crossPathUniqueCandidateCount: crossPathMerged.trace.crossPathUniqueCandidateCount,
      crossPathOutputCandidateCount: crossPathMerged.trace.crossPathOutputCandidateCount,
      crossPathTruncatedCount: crossPathMerged.trace.crossPathTruncatedCount,
      globalCandidateCap: crossPathMerged.trace.globalCandidateCap,
      kenlmInputSource: crossPathMerged.trace.kenlmInputSource,
      recallRequestCount: utteranceRecallStats.requestCount,
      uniqueRecallKeyCount: utteranceRecallStats.uniqueKeyCount,
      duplicateRecallKeyCount: utteranceRecallStats.duplicateKeyCount,
      utteranceCacheHitCount: utteranceRecallStats.hitCount,
      utteranceCacheMissCount: utteranceRecallStats.missCount,
      cacheHitRatio,
      logicalQueryCount: utteranceRecallStats.requestCount,
      physicalSqlStatementCount: utteranceRecallStats.physicalSqlStatementCount,
      exactQueryCount: utteranceRecallStats.exactQueryCount,
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
          diagActiveCandidates: diagActive.map((c) => ({
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
    pathAssemblyResults: [],
    metrics: {
      coarseSpanCount: 0,
      globalWindowGeneratedCount: 0,
      blockedWindowCount: 0,
      truncatedWindowCount: 0,
      logicalWindowRecallCount: 0,
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
