/**
 * FW Repair V4 — Span Assembly Orchestrator (Lattice Fine Span production entry).
 *
 * Fine Span: runLatticeFineSpanGenerationWithPreEdgeModel2
 *   (Window → Base Recall → Model2 pre-LexicalEdge → LexicalEdge → PathFineSpan).
 * Path-local: Tone Rebind → Compatibility →
 *   Domain Vote (ONCE) → Model3 Anchors → KEEP/RETRY → optional local re-recall →
 *   refresh pool → completeDomainAwareAssemblyFromVote (SAME vote).
 * Cross-Path: mergeCrossPathSentenceCandidates → unique KenLM input (≤16, dedup-before-cap).
 * Authority: MODEL3_V1_MAINLINE_INTEGRATION 2026-08-27;
 *   Model2 insertion SSOT = AUG12_PRE_LEXICAL_EDGE (2026-09-12 restore).
 */

import type { SegmentInfo } from '../../task-router/types';
import { loadFwDetectorRuntimeConfig } from '../fw-config';
import { buildWordTimeSpans, type AcousticToneSlice } from '../tone-time-align';
import {
  captureV2Boundary,
  canonicalHash,
  isFrozenEvidenceCaptureV2Enabled,
} from '../../capture-v2';
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
import type { DomainAwareAssemblyResult } from './domain-assembly-types';
import { buildCandidateCompatibilityGraph, resolveCompatibilityRelations } from './candidate-compatibility-graph';
import {
  runLatticeFineSpanGenerationWithPreEdgeModel2,
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
import type { Model2ExpandDiagnostics } from '../../model2-runtime/types';
import {
  compactCandidates,
  compactFineSpan,
  isDialog200PathTraceEnabled,
} from '../../model2-runtime/dialog200-path-trace';
import { SINGLE_CHAR_COLLECTOR_TRACE_V1 } from '../../lexicon-v2/single-char-collector-trace';
import { runModel3PathStep, runModel3PathStepCausalFork, runModel3PathStepDualWeightCausalFork } from '../../model3-runtime/run-model3-path-step';
import type { Model3PathDiagnostics, Model3SpanDecision } from '../../model3-runtime/model3-types';
import { isModel3AcceptanceCausalForkEnabled, isDualWeightClassWeightAuditEnabled } from '../../model3-runtime/model3-acceptance-snapshot';
import {
  beginPathProvenance,
  beginUtteranceProvenance,
  isCandidateProvenanceTraceEnabled,
  recordAssemblySentences,
  recordCrossPathMerge,
  recordKenlmPool,
  takePathProvenance,
  takeUtteranceProvenance,
} from '../../model3-runtime/model3-candidate-provenance-trace';
import logger from '../../logger';

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
  /**
   * Optional session UserProfile from SessionBootstrap cache.
   * Missing/empty still runs ONE Stage-J Model2 (no skip gate).
   */
  userProfile?: import('@shared/protocols/messages').UserProfileV1 | null;
  sessionId?: string;
  /** Test hook: force Model2 inference failure (base continues). */
  model2ForceInferenceFail?: boolean;
  /**
   * Test hook only: inject Model3 KEEP/RETRY decisions (skips sidecar).
   * Not a permanent enableModel3 business flag / dual pipeline.
   */
  model3DecisionOverride?: readonly Model3SpanDecision[];
  /** Test hook: force Model3 fail-fast. */
  model3ForceFail?: boolean;
  /**
   * Test hook: KEEP-all without sidecar (skips Model3 load).
   * Not a permanent enableModel3 business flag.
   */
  model3KeepAll?: boolean;
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
  model3Diagnostics?: Model3PathDiagnostics;
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
  spanSets: DomainAwareAssemblyResult['spanSets'];
  bucketSpanSets: DomainAwareAssemblyResult['bucketSpanSets'];
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
  /** Observation-only (MODEL2_DIALOG200_TRACE=1). */
  model2PathTrace?: Record<string, unknown>;
  /**
   * Acceptance-harness only (MODEL3_ACCEPTANCE_CAUSAL_FORK=1).
   * Baseline branch assembly for causal A/B — NOT a JobResult field / dual mainline.
   */
  acceptanceCausal?: {
    enabled: true;
    harnessVersion: string;
    baselinePathAssemblyResults: PathAssemblyResult[];
    baselineKenlmSentenceCandidates: {
      combinations: SentenceCombination[];
      uniqueBeforeCap: SentenceCombination[];
      crossPathMerge: CrossPathMergeTrace;
    };
    pathParity: Array<{
      pathId: string;
      upstreamHash: string;
      packedHash: string;
      mutationIsolated: boolean;
      baselinePostForkMs: number;
      s3PostForkMs: number;
      baselineRetryRegions: number;
      s3RetryRegions: number;
      baselineRetryAttempts: number;
      s3RetryAttempts: number;
    }>;
  };
};

function clonePathFineSpansForTone(spans: readonly PathFineSpan[]): PathFineSpan[] {
  return spans.map((span) => ({
    ...span,
    coarseSpanIds: [...span.coarseSpanIds],
    candidates: span.candidates.map((c) => ({ ...c, domains: c.domains ? [...c.domains] : c.domains })),
  }));
}

export async function runSpanAssemblyV4Orchestrator(
  input: SpanAssemblyV4OrchestratorInput
): Promise<SpanAssemblyV4OrchestratorResult> {
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

  // Capture V2 B2/B3 + B4.acousticToneSlices (INJECTION_STATE) — OBSERVABILITY_ONLY.
  // Canonical path: boundaries.B4.payload.acousticToneSlices (not B2; not reconstructed from mapped Tone).
  if (isFrozenEvidenceCaptureV2Enabled()) {
    const alignment = {
      segmentTimeOffsetsSec: [...(input.segmentTimeOffsetsSec ?? [])],
      asrSegmentNodeBatchIndices: [...(input.asrSegmentNodeBatchIndices ?? [])],
      segmentCharOffsets: [...(input.segmentCharOffsets ?? [])],
    };
    captureV2Boundary('B2', {
      ...alignment,
      alignmentHash: canonicalHash(alignment),
    });
    const spansSnap = wordTimeSpans.map((s) => ({ ...s }));
    captureV2Boundary('B3', {
      spans: spansSnap,
      count: spansSnap.length,
      canonicalHash: canonicalHash(spansSnap),
    });
    const slicesSrc = input.acousticSlices ?? [];
    const toneExecutionStatus =
      slicesSrc.length > 0
        ? 'TONE_EXECUTED_AND_SLICES_CAPTURED'
        : 'TONE_LEGITIMATELY_NOT_APPLICABLE';
    captureV2Boundary('B4', {
      acousticToneSlices: slicesSrc.map((s) => ({
        start: s.start,
        end: s.end,
        confidence: s.confidence,
        tonePosterior: { ...s.tonePosterior },
      })),
      slice_role: 'INJECTION_STATE',
      tone_execution_status: toneExecutionStatus,
      slice_count: slicesSrc.length,
      windows: [],
      authoritative_truncated: false,
    });
  }

  const lattice = await runLatticeFineSpanGenerationWithPreEdgeModel2({
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
    model2: {
      userProfile: input.userProfile,
      sessionId: input.sessionId,
      forceInferenceFail: input.model2ForceInferenceFail,
    },
  });

  const utteranceModel2Diag: Model2ExpandDiagnostics | undefined = lattice.ok
    ? lattice.model2Diagnostics
    : undefined;
  const utteranceRecallQueryEvidence = lattice.ok
    ? lattice.recallQueryEvidence ?? Object.freeze([])
    : Object.freeze([]);

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
  const dialog200PathAcc: Record<string, unknown>[] = [];
  const acceptancePathParity: Array<{
    pathId: string;
    upstreamHash: string;
    packedHash: string;
    mutationIsolated: boolean;
    baselinePostForkMs: number;
    s3PostForkMs: number;
    baselineRetryRegions: number;
    s3RetryRegions: number;
    baselineRetryAttempts: number;
    s3RetryAttempts: number;
  }> = [];
  const baselinePathAssemblyResults: PathAssemblyResult[] = [];
  let baselineIntervalAssemblyCandidateCount = 0;
  let baselineIntervalRejectedOverlapCount = 0;

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

    const activeCandidatesBase = compatibility.activeCandidates;
    domainRecallHitCount += activeCandidatesBase.filter(
      (c) =>
        !c.isCovered &&
        (c.source === 'domain_term' || c.source === 'passive_domain_weak')
    ).length;
    voteEligibleDomainCandidateCount += activeCandidatesBase.filter(
      (c) =>
        !c.isCovered &&
        Boolean(c.domains?.some((d) => d && d !== 'general' && d !== 'base_term'))
    ).length;

    // Model2 already ran once at pre-LexicalEdge (lattice). PROFILE_* candidates
    // survive on PathFineSpan → compatibility clone. Do not re-invoke Model2 here.
    let activeCandidates = activeCandidatesBase;
    const model2Diag = utteranceModel2Diag;

    diagActive.push(...activeCandidates.filter((c) => !c.isCovered));

    if (trace) {
      for (const candidate of activeCandidates) {
        if (candidate.isCovered) continue;
        if (candidate.hitKind === 'exact_term') {
          trace.pushEmittedEdge(toEmittedEdgeFromCandidate(candidate, 'exact_term'));
        }
      }
    }

    // Path-local: Domain Vote (ONCE) → Model3 Anchors → KEEP/RETRY →
    // optional local re-recall → refresh pool → completeFromVote (SAME vote).
    const acceptanceCausalFork = isModel3AcceptanceCausalForkEnabled();
    const model3Args = {
      activeCandidates,
      coarseSpans,
      rawText: input.rawText,
      pathFineSpans,
      domainPriors,
      globalSyllables: syllables,
      runtime: input.runtime,
      profile: input.profile,
      decisionOverride: acceptanceCausalFork ? undefined : input.model3DecisionOverride,
      forceFail: input.model3ForceFail,
      keepAll: acceptanceCausalFork ? false : input.model3KeepAll,
      imeConfig: input.imeConfig,
      dict: input.dict,
      minPrior: input.minPrior,
      acousticSlices: input.acousticSlices,
      wordTimeSpans,
      fuzzyRecallEnabled: fuzzyEnabled,
      toneTimestampOnlyEnabled,
      pathId: view.pathId,
      forcePackSymmetry: acceptanceCausalFork,
      recallQueryEvidence: utteranceRecallQueryEvidence,
    };

    let model3Step: Awaited<ReturnType<typeof runModel3PathStep>>;
    let baselineModel3Step: Awaited<ReturnType<typeof runModel3PathStep>> | undefined;
    let pathParityEntry:
      | {
          pathId: string;
          upstreamHash: string;
          packedHash: string;
          mutationIsolated: boolean;
          baselinePostForkMs: number;
          s3PostForkMs: number;
          baselineRetryRegions: number;
          s3RetryRegions: number;
          baselineRetryAttempts: number;
          s3RetryAttempts: number;
        }
      | undefined;

    if (acceptanceCausalFork) {
      const fork = isDualWeightClassWeightAuditEnabled()
        ? await runModel3PathStepDualWeightCausalFork(
            model3Args,
            process.env.MODEL3_BASELINE_CHECKPOINT_IDENTITY?.trim() ||
              'MODEL3_V2_S3_RANDOM_INIT_V1',
            process.env.MODEL3_CANDIDATE_CHECKPOINT_IDENTITY?.trim() ||
              'MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1_RERUN1'
          )
        : await runModel3PathStepCausalFork(model3Args);
      model3Step = fork.s3;
      baselineModel3Step = fork.baseline;
      pathParityEntry = {
        pathId: view.pathId,
        upstreamHash: fork.upstreamHash,
        packedHash: fork.packedHash,
        mutationIsolated: fork.mutationIsolated,
        baselinePostForkMs: fork.baselinePostForkMs,
        s3PostForkMs: fork.s3PostForkMs,
        baselineRetryRegions: fork.baseline.diagnostics.retryRegions?.length ?? 0,
        s3RetryRegions: fork.s3.diagnostics.retryRegions?.length ?? 0,
        baselineRetryAttempts: fork.baseline.diagnostics.retryAttempts.filter((r) => r.attempted)
          .length,
        s3RetryAttempts: fork.s3.diagnostics.retryAttempts.filter((r) => r.attempted).length,
      };
      acceptancePathParity.push(pathParityEntry);
    } else {
      model3Step = await runModel3PathStep(model3Args);
    }

    const assemblyResult = model3Step.assemblyResult;
    activeCandidates = model3Step.activeCandidates;
    if (model3Step.diagnostics.inferenceOk || model3Step.diagnostics.error) {
      logger.info(
        {
          pathId: view.pathId,
          voteCallCount: model3Step.voteCallCount,
          poolRefreshed: model3Step.diagnostics.poolRefreshed,
          anchors: model3Step.diagnostics.anchors.length,
          retryAttempts: model3Step.diagnostics.retryAttempts.filter((r) => r.attempted).length,
          model3LatencyMs: model3Step.diagnostics.model3LatencyMs,
        },
        '[Model3] path step'
      );
    }
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

    let pathCandidateProvenance: unknown = model3Step.diagnostics.candidateProvenance;
    if (isCandidateProvenanceTraceEnabled()) {
      const sentenceTexts = perBucketGenerated.flat().map((c) => c.text);
      beginPathProvenance(view.pathId);
      recordAssemblySentences(view.pathId, sentenceTexts);
      const asmProv = takePathProvenance(view.pathId);
      if (asmProv && pathCandidateProvenance && typeof pathCandidateProvenance === 'object') {
        const base = pathCandidateProvenance as Record<string, unknown>;
        const baseStages = Array.isArray(base.stages) ? base.stages : [];
        pathCandidateProvenance = {
          ...base,
          assemblySentences: asmProv.assemblySentences,
          stages: [...baseStages, ...asmProv.stages],
        };
      } else if (asmProv) {
        pathCandidateProvenance = asmProv;
      }
    }

    pathAssemblyResults.push({
      pathId: view.pathId,
      boundaryKey: view.boundaryKey,
      pathFineSpans,
      assemblyResult,
      fwSpans,
      perBucketGenerated,
      sentenceCandidateCount: pathSentenceCount,
      model3Diagnostics: model3Step.diagnostics,
    });

    // Acceptance causal baseline branch — same Assembly builder, KEEP-only decisions.
    if (baselineModel3Step) {
      const bAsm = baselineModel3Step.assemblyResult;
      const bDomain = bAsm.vote.retainedDomains[0] ?? bAsm.vote.utteranceDomain;
      const bFwSpans = buildFwSpansFromPathFineSpans(
        input.rawText,
        pathFineSpans,
        bAsm.spanSets,
        bDomain
      );
      allocateDomainBucketSentenceBudget(bAsm.bucketSpanSets.length, kenlmCap);
      const bPerBucket: SentenceCombination[][] = [];
      let bSentenceCount = 0;
      for (const bucketSets of bAsm.bucketSpanSets) {
        const bucketResult = buildSentenceCandidates(input.rawText, bucketSets, kenlmCap);
        baselineIntervalAssemblyCandidateCount += bucketResult.intervalAssemblyCandidateCount;
        baselineIntervalRejectedOverlapCount += bucketResult.intervalRejectedOverlapCount;
        bPerBucket.push(bucketResult.combinations);
        bSentenceCount += bucketResult.combinations.length;
      }
      baselinePathAssemblyResults.push({
        pathId: view.pathId,
        boundaryKey: view.boundaryKey,
        pathFineSpans,
        assemblyResult: bAsm,
        fwSpans: bFwSpans,
        perBucketGenerated: bPerBucket,
        sentenceCandidateCount: bSentenceCount,
        model3Diagnostics: baselineModel3Step.diagnostics,
      });
    }

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
    if (isDialog200PathTraceEnabled()) {
      dialog200PathAcc.push({
        path_id: view.pathId,
        boundary_key: view.boundaryKey,
        tone: toneEvidenceAvailableCount > 0 ? 'INVOKED' : 'NOT_INVOKED',
        tone_evidence_available_count: toneEvidenceAvailableCount,
        finespans: pathFineSpans.map((s) => compactFineSpan(s, input.rawText)),
        base_candidates: compactCandidates(activeCandidatesBase),
        after_model2_candidates: compactCandidates(activeCandidates),
        model2: model2Diag?.path_trace ?? {
          model2_status: model2Diag?.load_failed
            ? 'LOAD_FAILED'
            : model2Diag?.inference_failed
              ? 'INFERENCE_FAILED'
              : 'NOT_CAPTURED',
        },
        model2_summary: model2Diag
          ? {
              invoked: model2Diag.model2_invoked,
              selected_actions: model2Diag.selected_actions,
              domain_action: model2Diag.observability?.domain_action ?? model2Diag.domain_action ?? null,
              domain_none:
                model2Diag.observability?.domain_none ??
                (model2Diag.model2_invoked ? model2Diag.domain_none !== false : null),
              p_added: model2Diag.pronunciation_candidates_added ?? 0,
              d_added: model2Diag.domain_candidates_added ?? 0,
              introduced_term_ids: model2Diag.introduced_term_ids,
              latency_ms: model2Diag.model_latency_ms,
              lexicon_latency_ms: model2Diag.lexicon_latency_ms,
              // Observation-only Stage-J zeroing fields (no gating).
              selected_action_count:
                model2Diag.observability?.selected_action_count ??
                (model2Diag.selected_actions || []).length,
              selected_action_ids:
                model2Diag.observability?.selected_action_ids ??
                [...new Set(model2Diag.selected_actions || [])],
              p_retrieval_status: model2Diag.observability?.p_retrieval_status ?? null,
              p_retrieval_hit_count: model2Diag.observability?.p_retrieval_hit_count ?? null,
              p_materialized_count: model2Diag.observability?.p_materialized_count ?? null,
              acousticTonePattern_present:
                model2Diag.observability?.acousticTonePattern_present ?? null,
              toneRecallReadiness: model2Diag.observability?.toneRecallReadiness ?? null,
              d_hit_count: model2Diag.observability?.d_hit_count ?? null,
              d_materialized_count: model2Diag.observability?.d_materialized_count ?? null,
              inference_failed:
                model2Diag.observability?.inference_failed ?? Boolean(model2Diag.inference_failed),
              load_failed:
                model2Diag.observability?.load_failed ?? Boolean(model2Diag.load_failed),
              failure_reason:
                model2Diag.observability?.failure_reason ?? model2Diag.reason ?? null,
              profile_unicode_sanitized:
                model2Diag.observability?.profile_unicode_sanitized ?? false,
              sanitized_string_count: model2Diag.observability?.sanitized_string_count ?? 0,
              sanitized_code_unit_count:
                model2Diag.observability?.sanitized_code_unit_count ?? 0,
              sanitization_owner: model2Diag.observability?.sanitization_owner ?? null,
            }
          : null,
        domain_vote: {
          domain_scores: { ...assemblyResult.vote.domainScores },
          retained_domains: [...assemblyResult.vote.retainedDomains],
          utterance_domain: assemblyResult.vote.utteranceDomain,
          insufficient_evidence: assemblyResult.vote.insufficientEvidence === true,
          winner_score: assemblyResult.vote.maxCount,
          runner_up_domain: assemblyResult.vote.runnerUpDomain,
          vote_margin: assemblyResult.vote.voteMargin,
          vote_call_count: model3Step.voteCallCount,
        },
        // Observation-only (MODEL2_DIALOG200_TRACE=1) — not a JobResult schema change.
        model3: {
          vote_call_count: model3Step.diagnostics.voteCallCount,
          vote_frozen: model3Step.diagnostics.voteFrozen,
          pool_refreshed: model3Step.diagnostics.poolRefreshed,
          anchors: model3Step.diagnostics.anchors,
          model2_anchor_count: model3Step.diagnostics.model2_anchor_count,
          anchor_mutation_violations: model3Step.diagnostics.anchor_mutation_violations,
          decisions: model3Step.diagnostics.decisions,
          retry_attempts: model3Step.diagnostics.retryAttempts,
          // Observation-only (MODEL2_DIALOG200_TRACE=1) — not a JobResult schema change.
          retry_regions: model3Step.diagnostics.retryRegions,
          retry_recall_invocations: model3Step.diagnostics.retryRecallInvocations ?? null,
          inference_input_trace: model3Step.diagnostics.inferenceInputTrace ?? null,
          checkpoint_identity: model3Step.diagnostics.checkpointIdentity ?? null,
          model3_latency_ms: model3Step.diagnostics.model3LatencyMs,
          retry_path_latency_ms: model3Step.diagnostics.retryPathLatencyMs,
          inference_ok: model3Step.diagnostics.inferenceOk,
          error: model3Step.diagnostics.error ?? null,
          ...(pathCandidateProvenance != null
            ? {
                // Observation-only (MODEL3_CANDIDATE_PROVENANCE_TRACE=1).
                candidate_provenance: pathCandidateProvenance,
              }
            : {}),
          acceptance_causal: pathParityEntry
            ? {
                upstream_hash: pathParityEntry.upstreamHash,
                packed_hash: pathParityEntry.packedHash,
                mutation_isolated: pathParityEntry.mutationIsolated,
                baseline_post_fork_ms: pathParityEntry.baselinePostForkMs,
                s3_post_fork_ms: pathParityEntry.s3PostForkMs,
                baseline_decisions: baselineModel3Step?.diagnostics.decisions ?? null,
                baseline_retry_regions: baselineModel3Step?.diagnostics.retryRegions ?? null,
                baseline_retry_recall_invocations:
                  baselineModel3Step?.diagnostics.retryRecallInvocations ?? null,
                baseline_inference_input_trace:
                  baselineModel3Step?.diagnostics.inferenceInputTrace ?? null,
                ...(baselineModel3Step?.diagnostics.candidateProvenance != null
                  ? {
                      baseline_candidate_provenance:
                        baselineModel3Step.diagnostics.candidateProvenance,
                    }
                  : {}),
              }
            : null,
        },
        assembly: {
          sentence_count: pathSentenceCount,
          sentences: perBucketGenerated
            .flat()
            .slice(0, 24)
            .map((c) => ({
              text: c.text,
              score: c.candidateScore,
              replacements: c.replacements?.map((r) => r.word) ?? [],
            })),
        },
      });
    }
  }

  const kenlmCap = loadFwDetectorRuntimeConfig().maxSentenceCandidates;
  // Capture V2 B5/B15 — OBSERVABILITY_ONLY; uses Production finespans field name.
  if (isFrozenEvidenceCaptureV2Enabled()) {
    captureV2Boundary('B5', {
      field_name: 'finespans',
      paths: pathAssemblyResults.map((p) => ({
        path_id: p.pathId,
        boundary_key: p.boundaryKey,
        finespans: p.pathFineSpans.map((s) => compactFineSpan(s, input.rawText)),
      })),
    });
    captureV2Boundary('B15', {
      paths: pathAssemblyResults.map((p) => ({
        path_id: p.pathId,
        domainScores: { ...p.assemblyResult.vote.domainScores },
        retainedDomains: [...p.assemblyResult.vote.retainedDomains],
        utteranceDomain: p.assemblyResult.vote.utteranceDomain,
        insufficientEvidence: p.assemblyResult.vote.insufficientEvidence === true,
        sameDomainResult: {
          retainedDomains: [...p.assemblyResult.vote.retainedDomains],
        },
        assembled_sentence_identities_or_texts: p.perBucketGenerated
          .flat()
          .map((c) => c.text),
      })),
    });
  }
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

  let candidateProvenanceUtterance: unknown = null;
  if (isCandidateProvenanceTraceEnabled()) {
    beginUtteranceProvenance();
    const crossPathInputTexts = flatPerBucketGenerated.flat().map((c) => c.text);
    const crossPathOutputTexts = crossPathMerged.combinations.map((c) => c.text);
    recordCrossPathMerge(crossPathInputTexts, crossPathOutputTexts, kenlmCap);
    recordKenlmPool(crossPathOutputTexts);
    candidateProvenanceUtterance = takeUtteranceProvenance();
  }

  const acceptanceCausal =
    acceptancePathParity.length > 0 && baselinePathAssemblyResults.length > 0
      ? (() => {
          const baselineMerged = mergeCrossPathSentenceCandidates(
            baselinePathAssemblyResults,
            kenlmCap
          );
          return {
            enabled: true as const,
            harnessVersion: 'MODEL3_ACCEPTANCE_HARNESS_V1_20260831',
            baselinePathAssemblyResults,
            baselineKenlmSentenceCandidates: {
              combinations: baselineMerged.combinations,
              uniqueBeforeCap: baselineMerged.uniqueBeforeCap,
              crossPathMerge: baselineMerged.trace,
            },
            pathParity: acceptancePathParity,
          };
        })()
      : undefined;
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
    ...(acceptanceCausal ? { acceptanceCausal } : {}),
    ...(isDialog200PathTraceEnabled()
      ? {
          model2PathTrace: {
            paths: dialog200PathAcc,
            kenlm_input: {
              combinations: kenlmSentenceCandidates.combinations.slice(0, 24).map((c) => ({
                text: c.text,
                score: c.candidateScore,
                replacements: c.replacements?.map((r) => r.word) ?? [],
              })),
              unique_before_cap: (kenlmSentenceCandidates.uniqueBeforeCap ?? [])
                .slice(0, 24)
                .map((c) => c.text),
              truncated_count: crossPathMerged.trace.crossPathTruncatedCount,
              global_cap: kenlmCap,
              pruned: (kenlmSentenceCandidates.uniqueBeforeCap ?? [])
                .slice(kenlmCap)
                .slice(0, 24)
                .map((c, i) => ({
                  text: c.text,
                  rank: kenlmCap + i + 1,
                  score: c.candidateScore,
                })),
            },
            single_char_collector: {
              contract: SINGLE_CHAR_COLLECTOR_TRACE_V1,
              windows: lattice.length1CollectorWindows ?? [],
            },
            ...(acceptanceCausal
              ? {
                  acceptance_causal: {
                    harness_version: acceptanceCausal.harnessVersion,
                    path_parity: acceptanceCausal.pathParity,
                    baseline_kenlm_pool_size:
                      acceptanceCausal.baselineKenlmSentenceCandidates.combinations.length,
                    s3_kenlm_pool_size: kenlmSentenceCandidates.combinations.length,
                  },
                }
              : {}),
            // Observation-only (MODEL3_CANDIDATE_PROVENANCE_TRACE=1) — not JobResult.
            ...(candidateProvenanceUtterance
              ? { candidate_provenance_utterance: candidateProvenanceUtterance }
              : {}),
          },
        }
      : {}),
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
