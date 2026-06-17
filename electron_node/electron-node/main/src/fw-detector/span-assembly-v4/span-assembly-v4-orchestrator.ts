import type { SegmentInfo, UtteranceAcousticTonePayload } from '../../task-router/types';
import { loadFwDetectorRuntimeConfig } from '../fw-config';
import { buildWordTimeSpans, type AcousticToneSlice } from '../tone-time-align';
import type { LexiconRuntimeV2 } from '../../lexicon-v2/lexicon-runtime-v2';
import { LEXICON_V3_FIVE_TABLE_RUNTIME_SCHEMA_VERSION } from '../../lexicon-v2/lexicon-types-v2';
import {
  isFuzzyPinyinRecallEnabled,
  isWeakDomainRecallEnabled,
} from '../../lexicon-v2/lexicon-fw-recall-config';
import { resolveWeakDomainRecallPlan } from '../../lexicon-v2/weak-domain-recall-resolver';
import type { ActiveLexiconProfileSnapshot } from '../../session-runtime/types';
import type { PinyinImeV2Dict, PinyinImeV2RuntimeConfig } from '../pinyin-ime-v2/pinyin-ime-v2-types';
import { textToPinyinStream } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import { assembleCoarsePaths } from '../span-assembly-shared/coarse-path-assembly';
import { buildCandidateGraph } from '../span-assembly-shared/coarse-candidate-graph';
import { partitionCoarseSpans } from '../span-assembly-shared/coarse-span-partition';
import { createEmptyToneDiagnostics } from '../span-assembly-shared/tone-diagnostics';
import type { CoarseBoundaryImportDiagnostics } from '../span-assembly-shared/coarse-boundary-import';
import type { CoarseAssemblyInternalResult, CoarseAssemblyToneDiagnostics } from '../span-assembly-shared/types';
import { applyDomainVoteToEdges, voteUtteranceDomain } from '../span-assembly-shared/utterance-domain-vote';
import { runDomainAwareAssembly } from './assemble-domain-aware-span-sets';
import { assembleParentTermSpanCandidatesV4 } from './assemble-parent-term-span-candidates-v4';
import { blockedFilter, truncateWindows } from './blocked-window-filter';
import { buildCandidateCompatibilityGraph, resolveCompatibilityRelations } from './candidate-compatibility-graph';
import { emitParentEvidenceAndExactEdges } from './emit-v4-evidence';
import { generateGlobalWindows } from './generate-global-windows';
import { recallTopKForWindows } from './recall-topk-for-windows';
import { buildFwSpansFromCoarseAssemblyV4 } from './build-fw-spans-from-coarse-assembly-v4';
import { runCoarseSentenceBeamV4 } from './run-coarse-sentence-beam-v4';
import type { SpanAssemblyV4Metrics } from './v4-types';
import type { V4TraceCollector } from './v4-diagnostics-trace';
import { createV4TraceCollector } from './v4-diagnostics-trace';
import { resolveV4DiagnosticsConfig } from './v4-diagnostics-config';
import {
  toBeamSpanSetTrace,
  toBoundaryWindowTrace,
  toCoarsePathTrace,
  toCoarseSpanTrace,
  toEmittedEdgeFromCandidate,
  toEmittedEdgeFromParentEvidence,
  toGraphEdgeTrace,
  toParentSpanCandidateTraceFromGraphEdge,
} from './v4-diagnostics-mappers';
import { buildSentenceCandidates } from '../build-sentence-candidates';

export type SpanAssemblyV4OrchestratorInput = {
  rawText: string;
  runtime: LexiconRuntimeV2;
  profile: ActiveLexiconProfileSnapshot;
  enabledDomains: string[];
  minPrior: number;
  imeConfig: PinyinImeV2RuntimeConfig;
  dict: PinyinImeV2Dict;
  asrSegments?: SegmentInfo[];
  tonePayload?: UtteranceAcousticTonePayload | null;
  acousticSlices?: AcousticToneSlice[];
  asrSegmentNodeBatchIndices?: number[];
  segmentTimeOffsetsSec?: number[];
  segmentCharOffsets?: number[];
  /** Batch/probe case id for diagnostics targetIds matching (e.g. d001). */
  traceCaseId?: string;
};

export type SpanAssemblyV4OrchestratorResult = {
  internal: CoarseAssemblyInternalResult;
  spanSets: ReturnType<typeof runDomainAwareAssembly>['spanSets'];
  shadowBeamSpanSets: ReturnType<typeof runCoarseSentenceBeamV4>['spanSets'];
  shadowBeamSentenceTexts: ReturnType<typeof runCoarseSentenceBeamV4>['sentenceTexts'];
  fwSpans: ReturnType<typeof buildFwSpansFromCoarseAssemblyV4>;
  boundaryImport: CoarseBoundaryImportDiagnostics;
  tone: CoarseAssemblyToneDiagnostics;
  metrics: SpanAssemblyV4Metrics;
  trace?: ReturnType<V4TraceCollector['toDiagnostics']>;
  kenlmSentenceCandidates?: ReturnType<typeof buildSentenceCandidates>;
};

export function runSpanAssemblyV4Orchestrator(
  input: SpanAssemblyV4OrchestratorInput
): SpanAssemblyV4OrchestratorResult {
  const assemblyStart = Date.now();
  const diagnosticsConfig = resolveV4DiagnosticsConfig(input.traceCaseId);
  const trace = createV4TraceCollector(diagnosticsConfig.traceActive);
  const { syllables, hasCjk } = textToPinyinStream(input.rawText);

  if (!hasCjk || !syllables.length) {
    return emptyResult(assemblyStart, { fallbackReason: 'no_cjk' }, input.acousticSlices, trace);
  }

  if (input.runtime.getManifestVersion() !== LEXICON_V3_FIVE_TABLE_RUNTIME_SCHEMA_VERSION) {
    throw new Error(
      `[SPAN_ASSEMBLY_V4] requires ${LEXICON_V3_FIVE_TABLE_RUNTIME_SCHEMA_VERSION}, got ${input.runtime.getManifestVersion() ?? 'unknown'}`
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

  if (trace) {
    for (const span of coarseSpans) {
      trace.pushCoarseSpan(toCoarseSpanTrace(span));
    }
  }

  const weakEnabled = isWeakDomainRecallEnabled();
  const fuzzyEnabled = isFuzzyPinyinRecallEnabled();
  const weakDomainPlan = resolveWeakDomainRecallPlan(
    input.profile,
    input.enabledDomains,
    weakEnabled
  );

  const toneTimestampOnlyEnabled = loadFwDetectorRuntimeConfig().toneTimestampOnlyEnabled;
  const wordTimeSpans = buildWordTimeSpans(
    input.rawText,
    input.asrSegments ?? [],
    input.segmentTimeOffsetsSec ?? [],
    input.segmentCharOffsets ?? [],
    input.asrSegmentNodeBatchIndices ?? []
  );

  const generated = generateGlobalWindows({
    rawText: input.rawText,
    globalSyllables: syllables,
    coarseSpans,
  });
  const blocked = blockedFilter({
    windows: generated,
    rawText: input.rawText,
    coarseSpans,
    wordTimeSpans,
  });
  const blockedWindowCount = blocked.filter((w) => w.blocked).length;
  const { windows: truncated, truncatedCount, truncatedWindows } = truncateWindows(blocked);

  if (trace) {
    for (const window of blocked) {
      if (window.boundaryCrossCount === 1) {
        trace.pushBoundaryWindow(toBoundaryWindowTrace(window));
      }
    }
    for (const window of truncatedWindows) {
      trace.pushTruncatedWindow({
        windowId: window.windowId,
        reason: 'budget_truncated',
        windowPinyinKey: window.windowPinyinKey,
      });
    }
  }

  const recall = recallTopKForWindows({
    rawText: input.rawText,
    globalSyllables: syllables,
    windows: truncated,
    runtime: input.runtime,
    profile: input.profile,
    domainIds: weakEnabled ? weakDomainPlan.queryDomainIds : input.enabledDomains,
    minPrior: input.minPrior,
    weakDomainPlan: weakEnabled ? weakDomainPlan : undefined,
    fuzzyRecallEnabled: fuzzyEnabled,
    acousticSlices: input.acousticSlices,
    wordTimeSpans,
    toneTimestampOnlyEnabled,
    trace,
  });

  const { edges: compatibilityEdges, edgeCount: compatibilityEdgeCount } =
    buildCandidateCompatibilityGraph(recall.candidates);
  const compatibility = resolveCompatibilityRelations(recall.candidates, trace);
  const activeCandidates = compatibility.activeCandidates;

  const domainAssembly = runDomainAwareAssembly(activeCandidates, coarseSpans, input.rawText);
  const domainAwareSpanSets = domainAssembly.spanSets;

  const emitted = emitParentEvidenceAndExactEdges(activeCandidates);
  if (trace) {
    for (const evidence of emitted.parentEvidence) {
      trace.pushEmittedParentEvidence(toEmittedEdgeFromParentEvidence(evidence));
    }
    for (const candidate of activeCandidates) {
      if (candidate.isCovered) {
        continue;
      }
      if (candidate.hitKind === 'exact_term') {
        trace.pushEmittedEdge(toEmittedEdgeFromCandidate(candidate, 'exact_term'));
      }
    }
  }
  const shadowVote = voteUtteranceDomain({
    parentEvidence: emitted.parentEvidence,
    exactEdges: emitted.exactEdges,
  });
  const parentSpanAssembly = assembleParentTermSpanCandidatesV4(
    coarseSpans,
    emitted.parentEvidence,
    input.rawText,
    shadowVote.utteranceDomain
  );
  if (trace) {
    for (const edge of parentSpanAssembly.edges) {
      trace.pushEmittedParentSpanCandidate(toParentSpanCandidateTraceFromGraphEdge(edge));
    }
  }
  const votedExact = applyDomainVoteToEdges(emitted.exactEdges, shadowVote);
  const votedParent = applyDomainVoteToEdges(parentSpanAssembly.edges, shadowVote);
  const graph = buildCandidateGraph(input.rawText, syllables, coarseSpans, [
    ...votedParent,
    ...votedExact,
  ], compatibility.conflictRelations);
  const adjustedEdges = graph.edges;

  const pathStart = Date.now();
  const coarsePaths = assembleCoarsePaths(coarseSpans, adjustedEdges);
  const coarsePathAssemblyMs = Date.now() - pathStart;

  const beam = runCoarseSentenceBeamV4(input.rawText, coarseSpans, coarsePaths);
  const fwSpans = buildFwSpansFromCoarseAssemblyV4(
    input.rawText,
    coarseSpans,
    domainAwareSpanSets,
    domainAssembly.vote.utteranceDomain
  );

  if (trace) {
    adjustedEdges.forEach((edge, idx) => {
      trace.pushGraphEdge(toGraphEdgeTrace(edge, `ge:${idx}`));
    });
    const pathsBySpan = new Map<string, number>();
    for (const path of coarsePaths) {
      const rank = pathsBySpan.get(path.coarseSpanId) ?? 0;
      trace.pushCoarsePath(toCoarsePathTrace(path, rank, input.rawText));
      pathsBySpan.set(path.coarseSpanId, rank + 1);
    }
    for (let i = 0; i < coarseSpans.length; i += 1) {
      trace.pushBeamSpanSet(toBeamSpanSetTrace(i, coarseSpans[i].id, beam.spanSets[i] ?? []));
    }
  }

  const kenlmSentenceCandidates = buildSentenceCandidates(
    input.rawText,
    domainAwareSpanSets,
    loadFwDetectorRuntimeConfig().maxSentenceCandidates
  );
  if (trace) {
    for (const combo of kenlmSentenceCandidates) {
      trace.pushSentenceCandidate({
        sentence: combo.text,
        replacements: combo.replacements.map((r) => r.word),
        score: combo.candidateScore,
      });
    }
  }

  const internal: CoarseAssemblyInternalResult = {
    coarseSpans,
    graphEdges: adjustedEdges,
    utteranceDomain: domainAssembly.vote.utteranceDomain,
    coarsePaths,
    sentenceCandidates: kenlmSentenceCandidates.map((c) => c.text),
  };

  const inSpanWindowCount = truncated.filter((w) => w.windowSource === 'in_span_window').length;
  const boundaryWindowCount = truncated.filter((w) => w.windowSource === 'boundary_window').length;
  const shadowBeamSpanSetsTotal = beam.spanSets.reduce((sum, set) => sum + set.length, 0);

  return {
    internal,
    spanSets: domainAwareSpanSets,
    shadowBeamSpanSets: beam.spanSets,
    shadowBeamSentenceTexts: beam.sentenceTexts,
    fwSpans,
    boundaryImport: partition.diagnostics,
    tone: recall.tone,
    metrics: {
      coarseSpanCount: coarseSpans.length,
      globalWindowGeneratedCount: generated.length,
      blockedWindowCount,
      truncatedWindowCount: truncatedCount,
      ngramQueryCount: recall.ngramQueryCount,
      windowCandidatePoolCount: compatibility.metrics.activeCandidateCount,
      activeCandidateCount: compatibility.metrics.activeCandidateCount,
      compatibilityEdgeCount,
      droppedCandidateCount: compatibility.metrics.hardDropCount,
      coverageCount: compatibility.metrics.coverageCount,
      conflictCount: 0,
      conflictRelationCount: compatibility.metrics.conflictRelationCount,
      hardDropCount: compatibility.metrics.hardDropCount,
      compatibleCount: compatibility.metrics.compatibleCount,
      parentEvidenceCount: emitted.parentEvidence.length,
      exactEdgeCount: emitted.exactEdges.length,
      candidateEdgeCount: adjustedEdges.length,
      overlapMergeCount: graph.overlapMergeCount,
      residualSpanCount: graph.residualSpanCount,
      utteranceDomain: domainAssembly.vote.utteranceDomain,
      domainVoteMs: domainAssembly.vote.domainVoteMs,
      coarsePathAssemblyMs,
      sentenceBeamMs: beam.sentenceBeamMs,
      assemblyMs: Date.now() - assemblyStart,
      parentFragmentHitCount: recall.parentFragmentHitCount,
      parentSpanCandidateEmittedCount: parentSpanAssembly.parentSpanCandidateEmittedCount,
      parentSpanCandidateSelectedCount: parentSpanAssembly.parentSpanCandidateSelectedCount,
      dominatedPrunedCount: parentSpanAssembly.dominatedPrunedCount,
      ruleBRejectedByHoleCount: parentSpanAssembly.ruleBRejectedByHoleCount,
      parentSpanCoverageAvg: parentSpanAssembly.parentSpanCoverageAvg,
      parentTermVoteCount: domainAssembly.vote.parentTermVoteCount,
      inSpanWindowCount,
      boundaryWindowCount,
      domainCandidateCount: domainAssembly.metrics.domainCandidateCount,
      baseCandidateCount: domainAssembly.metrics.baseCandidateCount,
      sameDomainCandidateCount: domainAssembly.metrics.sameDomainCandidateCount,
      domainFilteredSpanCount: domainAssembly.metrics.domainFilteredSpanCount,
      selectedCandidatesPerSpanAvg: domainAssembly.metrics.selectedCandidatesPerSpanAvg,
      domainAssemblyMs: domainAssembly.metrics.domainAssemblyMs,
      mainDomainAwareSpanSetsTotal: domainAssembly.metrics.mainDomainAwareSpanSetsTotal,
      shadowBeamSpanSetsTotal,
    },
    trace: trace?.toDiagnostics(),
    kenlmSentenceCandidates,
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
      graphEdges: [],
      utteranceDomain: 'general',
      coarsePaths: [],
      sentenceCandidates: [],
    },
    spanSets: [],
    shadowBeamSpanSets: [],
    shadowBeamSentenceTexts: [],
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
      parentEvidenceCount: 0,
      exactEdgeCount: 0,
      candidateEdgeCount: 0,
      overlapMergeCount: 0,
      residualSpanCount: 0,
      utteranceDomain: 'general',
      domainVoteMs: 0,
      coarsePathAssemblyMs: 0,
      sentenceBeamMs: 0,
      assemblyMs: Date.now() - assemblyStart,
      parentFragmentHitCount: 0,
      parentSpanCandidateEmittedCount: 0,
      parentSpanCandidateSelectedCount: 0,
      dominatedPrunedCount: 0,
      ruleBRejectedByHoleCount: 0,
      parentSpanCoverageAvg: 0,
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
      shadowBeamSpanSetsTotal: 0,
    },
    trace: trace?.toDiagnostics(),
  };
}
