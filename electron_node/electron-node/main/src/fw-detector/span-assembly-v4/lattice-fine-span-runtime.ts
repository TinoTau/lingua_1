/**
 * Lattice Fine Span Production Runtime Entry.
 *
 * Owns: Window → Base Recall → (optional Model2 pre-edge) → LexicalEdge → Fallback →
 *       SegmentationPath[] → PathFineSpanView[].
 * Does NOT own Vote / Assembly / KenLM / LTR.
 * Model2 (Aug-12 SSOT): after recallTopKForWindows, before buildLexicalEdges — ONE stage.
 * Model3 Retry must call sync path WITHOUT Model2 (MODEL2_ON_MODEL3_RETRY = NO).
 *
 * Must NOT import harness modules, LTR generator, or audit fixtures.
 */

import type { LexiconRuntimeV2 } from '../../lexicon-v2/lexicon-runtime-v2';
import type { ActiveLexiconProfileSnapshot } from '../../session-runtime/types';
import type { ToneEvidenceProductionDiagnostic } from '../../task-router/types';
import type { AcousticToneSlice, WordTimeSpan } from '../tone-time-align';
import {
  buildUtteranceSyllableCoordinate,
  type UtteranceSyllableCoordinate,
} from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import { partitionCoarseSpans } from '../span-assembly-shared/coarse-span-partition';
import { createEmptyToneDiagnostics } from '../span-assembly-shared/tone-diagnostics';
import type { CoarseSpan, CoarseAssemblyToneDiagnostics } from '../span-assembly-shared/types';
import type { PinyinImeV2Dict, PinyinImeV2RuntimeConfig } from '../pinyin-ime-v2/pinyin-ime-v2-types';
import { buildLexicalEdges, type LexicalEdge } from './build-lexical-edges';
import {
  buildLexicalWindowQueries,
  type LexicalWindowQuery,
} from './build-lexical-window-queries';
import { latticeHardBlockFilter } from './lattice-hard-block-filter';
import { recallTopKForWindows } from './recall-topk-for-windows';
import {
  createUtteranceRecallContext,
  releaseUtteranceRecallContext,
  type UtteranceRecallCacheStats,
} from './utterance-recall-cache';
import { injectFallbackEdges } from './inject-fallback-edges';
import type { FallbackInjectionRange } from './inject-fallback-edges';
import { enumerateCompleteSegmentationPaths } from './enumerate-complete-segmentation-paths';
import { materializePathFineSpans } from './materialize-path-fine-spans';
import {
  assertPathFineSpansNonOverlapping,
  type PathFineSpanView,
} from './path-fine-span-types';
import type { PathCapEvent, SegmentationPath } from './lattice-path-types';
import { V4_LIMITS } from './v4-limits';
import type { WindowCandidate } from './v4-types';
import type { V4TraceCollector } from './v4-diagnostics-trace';
import {
  captureV2Boundary,
  canonicalizeUnorderedIdentities,
  canonicalHash,
  isFrozenEvidenceCaptureV2Enabled,
} from '../../capture-v2';
import {
  makeBlockedLength1WindowTrace,
  type Length1WindowTrace,
} from '../../lexicon-v2/single-char-collector-trace';
import { expandWindowsWithModel2 } from '../../model2-runtime/expand-windows-with-model2';
import type { Model2ExpandDiagnostics } from '../../model2-runtime/types';
import type { RecallQueryEvidence } from '../../lexicon-v2/recall-query-evidence';
import type { UserProfileV1 } from '@shared/protocols/messages';
import logger from '../../logger';

export type LatticePathLimits = {
  maxActivePathsPerPosition: number;
  maxCompleteSegmentationPaths: number;
};

/** Minimal production diagnostics — not harness probe dumps. */
export type LatticeFineSpanTrace = {
  windowCount: number;
  blockedWindowCount: number;
  recallableWindowCount: number;
  lexicalEdgeCount: number;
  fallbackEdgeCount: number;
  edgeCountAfterFallback: number;
  fallbackInjectionCount: number;
  fallbackInjectionRanges: ReadonlyArray<FallbackInjectionRange>;
  completePathCount: number;
  retainedCompletePathCount: number;
  prunedPathCount: number;
  materializedPathCount: number;
  coverageStatus: 'complete' | 'incomplete';
  logicalWindowRecallCount: number;
  sqlQueryCount: number;
  pathCapEvents: ReadonlyArray<PathCapEvent>;
};

export type LatticeFineSpanGenerationInput = {
  rawText: string;
  runtime: LexiconRuntimeV2;
  profile: ActiveLexiconProfileSnapshot;
  /** Non-empty Domain Recall SSOT (same contract as production orchestrator). */
  domainIds: string[];
  minPrior: number;
  imeConfig: PinyinImeV2RuntimeConfig;
  dict: PinyinImeV2Dict;
  coarseSpans?: CoarseSpan[];
  wordTimeSpans?: WordTimeSpan[];
  acousticSlices?: AcousticToneSlice[];
  toneEvidenceProduction?: ToneEvidenceProductionDiagnostic[];
  fuzzyRecallEnabled?: boolean;
  toneTimestampOnlyEnabled?: boolean;
  /** When false, skip utterance Fact cache (test baseline). Default true. */
  enableUtteranceRecallCache?: boolean;
  /** Optional V4 diagnostics collector for recall hit traces. */
  trace?: V4TraceCollector | null;
  limits?: LatticePathLimits;
};

/** Pre-edge Model2 context — production orchestrator only; omit on Model3 Retry. */
export type LatticeModel2PreEdgeArgs = {
  userProfile: UserProfileV1 | null | undefined;
  sessionId?: string;
  forceInferenceFail?: boolean;
};

export type LatticeFineSpanFromEdgesInput = {
  rawText: string;
  coordinate: UtteranceSyllableCoordinate;
  syllableCount: number;
  lexicalEdges: readonly LexicalEdge[];
  limits?: LatticePathLimits;
};

export type LatticeFineSpanFailureCode =
  | 'EMPTY_INPUT'
  | 'EMPTY_DOMAIN_SCOPE'
  | 'NO_COMPLETE_PATH'
  | 'COVERAGE_INVARIANT'
  | 'MATERIALIZATION_FAILED';

export type LatticeFineSpanFailure = {
  ok: false;
  code: LatticeFineSpanFailureCode;
  message: string;
};

export type LatticeFineSpanSuccess = {
  ok: true;
  syllableCount: number;
  /** Lexical edges before fallback injection. */
  lexicalEdges: readonly LexicalEdge[];
  /** Edges after formal fallback coverage (lexical + fallback). */
  edgesAfterFallback: readonly LexicalEdge[];
  segmentationPaths: readonly SegmentationPath[];
  pathFineSpanViews: readonly PathFineSpanView[];
  windows: readonly LexicalWindowQuery[];
  trace: LatticeFineSpanTrace;
  tone: CoarseAssemblyToneDiagnostics;
  /** JOBRESULT_ADAPTER_DEBT — parent-fragment recall retired (Phase 2/3); always 0. */
  parentFragmentHitCount: number;
  utteranceRecallStats: UtteranceRecallCacheStats;
  /** Observation-only 1-char collector traces (recallable + hard-blocked). */
  length1CollectorWindows?: readonly Length1WindowTrace[];
  /** Present when generated via WithPreEdgeModel2. */
  model2Diagnostics?: Model2ExpandDiagnostics;
  /**
   * Utterance-local RecallQueryEvidence store (ACP V1).
   * Candidate/path independent; visible to all paths of this utterance.
   */
  recallQueryEvidence?: readonly RecallQueryEvidence[];
};

export type LatticeFineSpanGenerationResult = LatticeFineSpanSuccess | LatticeFineSpanFailure;

/** @deprecated Alias — success type already includes optional model2Diagnostics. */
export type LatticeFineSpanGenerationSuccessWithModel2 = LatticeFineSpanSuccess;

function emptyUtteranceRecallStats(): UtteranceRecallCacheStats {
  return {
    requestCount: 0,
    uniqueKeyCount: 0,
    duplicateKeyCount: 0,
    hitCount: 0,
    missCount: 0,
    exactQueryCount: 0,
    physicalSqlStatementCount: 0,
    recallRequestBuildMs: 0,
    utteranceCacheLookupMs: 0,
    lexiconFactLookupMs: 0,
    windowBindingMs: 0,
    lexiconRecallTotalMs: 0,
  };
}

function defaultLimits(limits?: LatticePathLimits): LatticePathLimits {
  if (limits) return limits;
  // Experiment-only override (unset ⇒ production PROBE 8/8). Not a freeze of new defaults.
  const expActive = Number(process.env.LINGUA_EXPERIMENT_MAX_ACTIVE_PATHS);
  const expComplete = Number(process.env.LINGUA_EXPERIMENT_MAX_COMPLETE_PATHS);
  if (
    Number.isFinite(expActive) &&
    expActive > 0 &&
    Number.isFinite(expComplete) &&
    expComplete > 0
  ) {
    return {
      maxActivePathsPerPosition: Math.floor(expActive),
      maxCompleteSegmentationPaths: Math.floor(expComplete),
    };
  }
  return {
    maxActivePathsPerPosition: V4_LIMITS.maxActivePathsPerPosition,
    maxCompleteSegmentationPaths: V4_LIMITS.maxCompleteSegmentationPaths,
  };
}

function groupCandidatesByWindow(
  windows: LexicalWindowQuery[],
  candidates: WindowCandidate[]
): Map<string, WindowCandidate[]> {
  const byId = new Map<string, WindowCandidate[]>();
  for (const c of candidates) {
    const list = byId.get(c.windowId);
    if (list) {
      list.push(c);
    } else {
      byId.set(c.windowId, [c]);
    }
  }
  const ordered = new Map<string, WindowCandidate[]>();
  for (const w of windows) {
    ordered.set(w.windowId, byId.get(w.windowId) ?? []);
  }
  return ordered;
}

function assertPathCoverage(path: SegmentationPath, syllableCount: number): void {
  if (path.edgeRefs.length === 0) {
    throw new Error(`[LATTICE_FINE_SPAN] empty path ${path.pathId}`);
  }
  if (path.edgeRefs[0]!.syllableStart !== 0) {
    throw new Error(`[LATTICE_FINE_SPAN] path ${path.pathId} does not start at 0`);
  }
  let expected = 0;
  for (const edge of path.edgeRefs) {
    if (edge.syllableStart !== expected) {
      throw new Error(
        `[LATTICE_FINE_SPAN] gap/overlap in path ${path.pathId}: expected start=${expected}, got ${edge.syllableStart}`
      );
    }
    if (edge.syllableEnd <= edge.syllableStart) {
      throw new Error(`[LATTICE_FINE_SPAN] non-advancing edge in path ${path.pathId}`);
    }
    expected = edge.syllableEnd;
  }
  if (expected !== syllableCount) {
    throw new Error(
      `[LATTICE_FINE_SPAN] path ${path.pathId} ends at ${expected}, expected ${syllableCount}`
    );
  }
}

/**
 * Production core from prebuilt LexicalEdge[] (no Recall).
 * Formal fallback coverage → complete path enum → PathFineSpanView materialization.
 */
export function runLatticeFineSpanGenerationFromLexicalEdges(
  input: LatticeFineSpanFromEdgesInput
): LatticeFineSpanGenerationResult {
  const { rawText, coordinate, syllableCount, lexicalEdges } = input;
  if (!rawText || syllableCount <= 0) {
    return {
      ok: false,
      code: 'EMPTY_INPUT',
      message: '[LATTICE_FINE_SPAN] rawText/syllableCount must be non-empty',
    };
  }

  const limits = defaultLimits(input.limits);

  let injection: ReturnType<typeof injectFallbackEdges>;
  try {
    injection = injectFallbackEdges({ syllableCount, lexicalEdges });
  } catch (err) {
    return {
      ok: false,
      code: 'COVERAGE_INVARIANT',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const edgesAfterFallback = injection.edges;
  const fallbackEdgeCount = edgesAfterFallback.filter((e) => e.edgeKind === 'fallback').length;

  const enumerated = enumerateCompleteSegmentationPaths({
    syllableCount,
    lexicalEdges: edgesAfterFallback,
    limits,
  });

  if (isFrozenEvidenceCaptureV2Enabled()) {
    const pathIdentities = enumerated.paths.map((p) => ({
      pathId: p.pathId,
      boundaryKey: p.boundaryKey,
    }));
    const sortedForHash = canonicalizeUnorderedIdentities(pathIdentities, (x) =>
      String((x as { pathId?: string }).pathId ?? '')
    );
    captureV2Boundary('B13', {
      completePathCountBeforePrune: enumerated.completePathCountBeforePrune,
      sortedPathIdentityHash: canonicalHash(sortedForHash),
      summary_or_full_path_identities_for_diagnose: pathIdentities,
    });
    captureV2Boundary('B14', {
      retained_path_ids: enumerated.paths.map((p) => p.pathId),
      boundary_keys: enumerated.paths.map((p) => p.boundaryKey),
      pathCapEvents: enumerated.capEvents ?? [],
      pruning_evidence: {
        completePathCountBeforePrune: enumerated.completePathCountBeforePrune,
        retainedCompletePathCount: enumerated.retainedCompletePathCount,
        prunedPathCount: (enumerated.prunedPaths ?? []).length,
      },
      limits: {
        maxCompleteSegmentationPaths: limits.maxCompleteSegmentationPaths,
        maxActivePathsPerPosition: limits.maxActivePathsPerPosition,
      },
    });
  }

  if (enumerated.paths.length === 0) {
    return {
      ok: false,
      code: 'NO_COMPLETE_PATH',
      message: `[LATTICE_FINE_SPAN] zero complete SegmentationPath after fallback coverage (syllableCount=${syllableCount})`,
    };
  }

  try {
    for (const path of enumerated.paths) {
      assertPathCoverage(path, syllableCount);
    }
  } catch (err) {
    return {
      ok: false,
      code: 'COVERAGE_INVARIANT',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  let pathFineSpanViews: PathFineSpanView[];
  try {
    pathFineSpanViews = enumerated.paths.map((p) => materializePathFineSpans(p, coordinate));
    for (const view of pathFineSpanViews) {
      assertPathFineSpansNonOverlapping(view.pathFineSpans);
    }
  } catch (err) {
    return {
      ok: false,
      code: 'MATERIALIZATION_FAILED',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    ok: true,
    syllableCount,
    lexicalEdges,
    edgesAfterFallback,
    segmentationPaths: enumerated.paths,
    pathFineSpanViews,
    windows: [],
    trace: {
      windowCount: 0,
      blockedWindowCount: 0,
      recallableWindowCount: 0,
      lexicalEdgeCount: lexicalEdges.length,
      fallbackEdgeCount,
      edgeCountAfterFallback: edgesAfterFallback.length,
      fallbackInjectionCount: injection.fallbackInjectionCount,
      fallbackInjectionRanges: injection.fallbackInjectionRanges,
      completePathCount: enumerated.completePathCountBeforePrune,
      retainedCompletePathCount: enumerated.retainedCompletePathCount,
      prunedPathCount: enumerated.completePathCountBeforePrune - enumerated.retainedCompletePathCount,
      materializedPathCount: pathFineSpanViews.length,
      coverageStatus: 'complete',
      logicalWindowRecallCount: 0,
      sqlQueryCount: 0,
      pathCapEvents: enumerated.capEvents,
    },
    tone: createEmptyToneDiagnostics(undefined, [], false),
    parentFragmentHitCount: 0,
    utteranceRecallStats: emptyUtteranceRecallStats(),
  };
}

/**
 * Production Lattice Fine Span entry (Base Recall only — no Model2).
 * Used by Model3 Retry resegment and tests.
 * Coordinate → Windows → hard-block → recallTopKForWindows → LexicalEdge
 * → fallback coverage → SegmentationPath[] → PathFineSpanView[].
 */
export function runLatticeFineSpanGeneration(
  input: LatticeFineSpanGenerationInput
): LatticeFineSpanGenerationResult {
  const result = runLatticeFineSpanGenerationInner(input, null);
  if (result instanceof Promise) {
    throw new Error(
      '[LATTICE_FINE_SPAN] sync path unexpectedly returned Promise — Model2 must be omitted'
    );
  }
  return result;
}

/**
 * Production Lattice Fine Span with Aug-12 Model2 pre-LexicalEdge expansion.
 * ONE Model2 stage: after Base Recall, before buildLexicalEdges.
 * Orchestrator must use this; Retry must NOT.
 */
export async function runLatticeFineSpanGenerationWithPreEdgeModel2(
  input: LatticeFineSpanGenerationInput & { model2: LatticeModel2PreEdgeArgs }
): Promise<LatticeFineSpanGenerationResult | LatticeFineSpanGenerationSuccessWithModel2> {
  return runLatticeFineSpanGenerationInner(input, input.model2);
}

function runLatticeFineSpanGenerationInner(
  input: LatticeFineSpanGenerationInput,
  model2: LatticeModel2PreEdgeArgs | null
): LatticeFineSpanGenerationResult | Promise<LatticeFineSpanGenerationResult | LatticeFineSpanGenerationSuccessWithModel2> {
  if (!input.rawText) {
    return {
      ok: false,
      code: 'EMPTY_INPUT',
      message: '[LATTICE_FINE_SPAN] rawText must be non-empty',
    };
  }
  if (!input.domainIds.length) {
    return {
      ok: false,
      code: 'EMPTY_DOMAIN_SCOPE',
      message:
        '[LATTICE_FINE_SPAN] domainIds is empty — Domain Recall must not silently degrade to Base-only',
    };
  }

  const coordinate = buildUtteranceSyllableCoordinate(input.rawText);
  const globalSyllables = coordinate.syllables;
  if (globalSyllables.length <= 0) {
    return {
      ok: false,
      code: 'EMPTY_INPUT',
      message: '[LATTICE_FINE_SPAN] syllableCount must be > 0',
    };
  }

  const coarseSpans =
    input.coarseSpans ??
    partitionCoarseSpans({
      rawText: input.rawText,
      imeConfig: input.imeConfig,
      dict: input.dict,
    }).coarseSpans;

  const windows = buildLexicalWindowQueries({
    rawText: input.rawText,
    globalSyllables,
    coarseSpans,
    charSyllableRanges: coordinate.ranges,
  });

  const filteredWindows = latticeHardBlockFilter({
    windows,
    rawText: input.rawText,
    coarseSpans,
    wordTimeSpans: input.wordTimeSpans ?? [],
  });
  const recallableWindows = filteredWindows.filter((w) => !w.blocked);
  const blockedWindowCount = filteredWindows.filter((w) => w.blocked).length;

  if (isFrozenEvidenceCaptureV2Enabled()) {
    captureV2Boundary('B6', {
      globalWindowGeneratedCount: windows.length,
      logicalWindowRecallCount: recallableWindows.length,
      blockedWindowCount,
      uniqueRecallKeyCount: new Set(recallableWindows.map((w) => w.windowId)).size,
      logicalRecallWindows: recallableWindows.map((w) => ({
        windowId: w.windowId,
        windowText: w.windowText,
        rawStart: w.rawStart,
        rawEnd: w.rawEnd,
        syllableStart: w.syllableStart,
        syllableEnd: w.syllableEnd,
        windowPinyinKey: w.windowPinyinKey,
        spanIds: w.spanIds ? [...w.spanIds] : [],
        blocked: w.blocked === true,
        windowSource: w.windowSource,
      })),
    });
  }

  const utteranceRecall =
    input.enableUtteranceRecallCache === false
      ? null
      : createUtteranceRecallContext(input.runtime.getManifestVersion() ?? 'unknown');

  const finishFromByWindow = (
    byWindow: Map<string, WindowCandidate[]>,
    recallMeta: {
      tone: CoarseAssemblyToneDiagnostics;
      parentFragmentHitCount: number;
      logicalWindowRecallCount: number;
      length1Windows: Length1WindowTrace[];
      physicalSqlStatementCount: number;
      utteranceRecallStats: UtteranceRecallCacheStats;
    },
    model2Diagnostics?: Model2ExpandDiagnostics,
    recallQueryEvidence?: readonly RecallQueryEvidence[]
  ): LatticeFineSpanGenerationResult | LatticeFineSpanGenerationSuccessWithModel2 => {
    const edgeBundles: Array<{
      windowId: string;
      syllableStart: number;
      syllableEnd: number;
      candidates: WindowCandidate[];
    }> = [];

    for (const w of recallableWindows) {
      const candidates = byWindow.get(w.windowId) ?? [];
      if (candidates.length > 0) {
        edgeBundles.push({
          windowId: w.windowId,
          syllableStart: w.syllableStart,
          syllableEnd: w.syllableEnd,
          candidates,
        });
      }
    }

    const lexicalEdges = buildLexicalEdges({ recalledWindows: edgeBundles });
    if (isFrozenEvidenceCaptureV2Enabled()) {
      if (model2Diagnostics) {
        const windowsEv = (model2Diagnostics.path_trace as { windows?: unknown[] } | undefined)?.windows;
        captureV2Boundary('B10', {
          windows: windowsEv ?? null,
          inputHash: canonicalHash(windowsEv ?? model2Diagnostics),
          model2_summary: {
            invoked: model2Diagnostics.model2_invoked,
            load_failed: model2Diagnostics.load_failed,
            inference_failed: model2Diagnostics.inference_failed,
          },
        });
        const afterItems =
          (model2Diagnostics.path_trace as { union?: { union_before_budget?: { items?: unknown[] } } } | undefined)
            ?.union?.union_before_budget?.items ?? null;
        captureV2Boundary('B11', {
          selected_actions: model2Diagnostics.selected_actions ?? [],
          introduced_candidate_identities: model2Diagnostics.introduced_term_ids ?? [],
          after_model2_candidate_set: afterItems,
          decision_evidence: {
            domain_action: model2Diagnostics.domain_action ?? null,
            pronunciation_candidates_added: model2Diagnostics.pronunciation_candidates_added ?? 0,
            domain_candidates_added: model2Diagnostics.domain_candidates_added ?? 0,
          },
        });
      } else {
        captureV2Boundary('B10', {
          windows: null,
          inputHash: canonicalHash(null),
          model2_summary: { invoked: false, note: 'model2_not_run_or_unavailable' },
        });
        captureV2Boundary('B11', {
          selected_actions: [],
          introduced_candidate_identities: [],
          after_model2_candidate_set: [],
          decision_evidence: { note: 'model2_not_run_or_unavailable' },
        });
      }
      const edgeIdentities = lexicalEdges.map((e) => ({
        syllableStart: e.syllableStart,
        syllableEnd: e.syllableEnd,
        edgeKind: e.edgeKind,
        hasExact: e.recallEvidence?.hasExact ?? false,
        hasToneRelaxed: e.recallEvidence?.hasToneRelaxed ?? false,
        hasFuzzy: e.recallEvidence?.hasFuzzy ?? false,
      }));
      captureV2Boundary('B12', {
        edges: edgeIdentities,
        edgeSetHash: canonicalHash(
          canonicalizeUnorderedIdentities(edgeIdentities, (x) =>
            JSON.stringify(x)
          )
        ),
      });
    }
    const length1WindowsAcc = [...recallMeta.length1Windows];
    for (const w of filteredWindows) {
      if (!w.blocked) continue;
      if (w.syllableEnd - w.syllableStart !== 1) continue;
      length1WindowsAcc.push(makeBlockedLength1WindowTrace(w));
    }

    const fromEdges = runLatticeFineSpanGenerationFromLexicalEdges({
      rawText: input.rawText,
      coordinate,
      syllableCount: globalSyllables.length,
      lexicalEdges,
      limits: input.limits,
    });

    if (!fromEdges.ok) {
      return fromEdges;
    }

    const success: LatticeFineSpanGenerationSuccessWithModel2 = {
      ...fromEdges,
      windows,
      tone: recallMeta.tone,
      parentFragmentHitCount: recallMeta.parentFragmentHitCount,
      utteranceRecallStats: recallMeta.utteranceRecallStats,
      length1CollectorWindows: length1WindowsAcc,
      trace: {
        ...fromEdges.trace,
        windowCount: windows.length,
        blockedWindowCount,
        recallableWindowCount: recallableWindows.length,
        logicalWindowRecallCount: recallMeta.logicalWindowRecallCount,
        sqlQueryCount: recallMeta.physicalSqlStatementCount,
      },
      ...(model2Diagnostics ? { model2Diagnostics } : {}),
      ...(recallQueryEvidence !== undefined
        ? { recallQueryEvidence: Object.freeze([...recallQueryEvidence]) }
        : {}),
    };
    return success;
  };

  const releaseRecall = (): void => {
    if (utteranceRecall) {
      releaseUtteranceRecallContext(utteranceRecall);
    }
  };

  try {
    const recall = recallTopKForWindows({
      rawText: input.rawText,
      windows: recallableWindows,
      globalSyllables: [...globalSyllables],
      runtime: input.runtime,
      profile: input.profile,
      domainIds: input.domainIds,
      minPrior: input.minPrior,
      wordTimeSpans: input.wordTimeSpans,
      acousticSlices: input.acousticSlices,
      toneEvidenceProduction: input.toneEvidenceProduction,
      fuzzyRecallEnabled: input.fuzzyRecallEnabled === true,
      toneTimestampOnlyEnabled: input.toneTimestampOnlyEnabled === true,
      trace: input.trace,
      utteranceRecall,
    });

    if (recall.logicalWindowRecallCount !== recallableWindows.length) {
      releaseRecall();
      return {
        ok: false,
        code: 'COVERAGE_INVARIANT',
        message: `[LATTICE_FINE_SPAN] Recall incompleteness: logicalWindowRecallCount=${recall.logicalWindowRecallCount} !== recallableWindowCount=${recallableWindows.length}`,
      };
    }

    const byWindow = groupCandidatesByWindow(recallableWindows, recall.candidates);
    let physicalSqlStatementCount = 0;
    let utteranceRecallStats = emptyUtteranceRecallStats();
    if (utteranceRecall) {
      utteranceRecallStats = { ...utteranceRecall.stats };
      physicalSqlStatementCount =
        utteranceRecall.stats.physicalSqlStatementCount || recall.physicalSqlStatementCount;
      utteranceRecallStats.physicalSqlStatementCount = physicalSqlStatementCount;
    } else {
      physicalSqlStatementCount = recall.physicalSqlStatementCount;
      utteranceRecallStats = {
        ...emptyUtteranceRecallStats(),
        physicalSqlStatementCount,
        requestCount: recall.logicalWindowRecallCount,
      };
    }

    const recallMeta = {
      tone: recall.tone,
      parentFragmentHitCount: recall.parentFragmentHitCount,
      logicalWindowRecallCount: recall.logicalWindowRecallCount,
      length1Windows: [...recall.length1Windows],
      physicalSqlStatementCount,
      utteranceRecallStats,
    };

    if (!model2) {
      try {
        return finishFromByWindow(byWindow, recallMeta);
      } finally {
        releaseRecall();
      }
    }

    return (async () => {
      let model2Diagnostics: Model2ExpandDiagnostics | undefined;
      let recallQueryEvidence: readonly RecallQueryEvidence[] | undefined;
      try {
        const expanded = await expandWindowsWithModel2({
          windows: recallableWindows,
          candidatesByWindow: byWindow,
          rawText: input.rawText,
          globalSyllables,
          userProfile: model2.userProfile,
          sessionId: model2.sessionId,
          runtime: input.runtime,
          lexiconProfile: input.profile,
          domainIds: input.domainIds,
          acousticSlices: input.acousticSlices,
          wordTimeSpans: input.wordTimeSpans,
          toneTimestampOnlyEnabled: input.toneTimestampOnlyEnabled === true,
          forceInferenceFail: model2.forceInferenceFail,
        });
        model2Diagnostics = expanded.diagnostics;
        recallQueryEvidence = expanded.recallQueryEvidence;
        if (
          model2Diagnostics.model2_invoked ||
          model2Diagnostics.load_failed ||
          model2Diagnostics.inference_failed
        ) {
          logger.info(
            {
              model2_invoked: model2Diagnostics.model2_invoked,
              selected_actions: model2Diagnostics.selected_actions,
              introduced: model2Diagnostics.introduced_term_ids.length,
              profile_queries: model2Diagnostics.profile_queries,
              load_failed: model2Diagnostics.load_failed,
              inference_failed: model2Diagnostics.inference_failed,
              label: model2Diagnostics.label,
              insertion: 'PRE_LEXICAL_EDGE',
            },
            '[Model2] pre-edge window expansion'
          );
        }
        return finishFromByWindow(byWindow, recallMeta, model2Diagnostics, recallQueryEvidence);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          '[Model2] unexpected error — continue base recall'
        );
        return finishFromByWindow(byWindow, recallMeta, model2Diagnostics, recallQueryEvidence);
      } finally {
        releaseRecall();
      }
    })();
  } catch (err) {
    releaseRecall();
    throw err;
  }
}
