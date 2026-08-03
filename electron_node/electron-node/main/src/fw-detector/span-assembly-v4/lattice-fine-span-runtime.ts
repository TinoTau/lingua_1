/**
 * Lattice Fine Span Production Runtime Entry.
 *
 * Owns: Window → Recall → LexicalEdge → Fallback coverage → SegmentationPath[] → PathFineSpanView[].
 * Does NOT own Vote / Assembly / KenLM / Tone Mapping / LTR.
 *
 * Production Lattice Fine Span entry.
 * Owned by SegmentationPath / Lattice; callable from production orchestrator (Step 3+).
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
};

export type LatticeFineSpanGenerationResult = LatticeFineSpanSuccess | LatticeFineSpanFailure;

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
  return (
    limits ?? {
      maxActivePathsPerPosition: V4_LIMITS.maxActivePathsPerPosition,
      maxCompleteSegmentationPaths: V4_LIMITS.maxCompleteSegmentationPaths,
    }
  );
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
 * Production Lattice Fine Span entry:
 * Coordinate → Windows → hard-block → recallTopKForWindows → LexicalEdge
 * → fallback coverage → SegmentationPath[] → PathFineSpanView[].
 */
export function runLatticeFineSpanGeneration(
  input: LatticeFineSpanGenerationInput
): LatticeFineSpanGenerationResult {
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

  const utteranceRecall =
    input.enableUtteranceRecallCache === false
      ? null
      : createUtteranceRecallContext(input.runtime.getManifestVersion() ?? 'unknown');

  let lexicalEdges: LexicalEdge[] | null = null;
  let physicalSqlStatementCount = 0;
  let logicalWindowRecallCount = 0;
  let parentFragmentHitCount = 0;
  let tone: CoarseAssemblyToneDiagnostics = createEmptyToneDiagnostics(
    input.acousticSlices,
    input.wordTimeSpans ?? [],
    input.toneTimestampOnlyEnabled === true
  );
  let utteranceRecallStats = emptyUtteranceRecallStats();
  let recallFailure: LatticeFineSpanFailure | null = null;
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
      recallFailure = {
        ok: false,
        code: 'COVERAGE_INVARIANT',
        message: `[LATTICE_FINE_SPAN] Recall incompleteness: logicalWindowRecallCount=${recall.logicalWindowRecallCount} !== recallableWindowCount=${recallableWindows.length}`,
      };
    } else {
      const byWindow = groupCandidatesByWindow(recallableWindows, recall.candidates);
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

      lexicalEdges = buildLexicalEdges({ recalledWindows: edgeBundles });
      tone = recall.tone;
      parentFragmentHitCount = recall.parentFragmentHitCount;
      logicalWindowRecallCount = recall.logicalWindowRecallCount;
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
          requestCount: logicalWindowRecallCount,
        };
      }
    }
  } finally {
    if (utteranceRecall) {
      releaseUtteranceRecallContext(utteranceRecall);
    }
  }

  if (recallFailure) {
    return recallFailure;
  }
  if (!lexicalEdges) {
    return {
      ok: false,
      code: 'COVERAGE_INVARIANT',
      message: '[LATTICE_FINE_SPAN] LexicalEdge build did not complete',
    };
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

  return {
    ...fromEdges,
    windows,
    tone,
    parentFragmentHitCount,
    utteranceRecallStats,
    trace: {
      ...fromEdges.trace,
      windowCount: windows.length,
      blockedWindowCount,
      recallableWindowCount: recallableWindows.length,
      logicalWindowRecallCount,
      sqlQueryCount: physicalSqlStatementCount,
    },
  };
}
