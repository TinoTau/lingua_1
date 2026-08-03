/**
 * Phase 2 Path harness — offline audit / test wrapper.
 *
 * Production algorithm lives in lattice-fine-span-runtime.ts.
 * This file MUST NOT be wired into production orchestrator.
 *
 * Dependency direction (frozen):
 *   phase2-path-harness → lattice-fine-span-runtime
 *   lattice-fine-span-runtime ↛ phase2-path-harness
 */

import type { LexiconRuntimeV2 } from '../../lexicon-v2/lexicon-runtime-v2';
import type { ActiveLexiconProfileSnapshot } from '../../session-runtime/types';
import type { WordTimeSpan } from '../tone-time-align';
import type { AcousticToneSlice } from '../tone-time-align';
import type { CoarseSpan } from '../span-assembly-shared/types';
import type { PinyinImeV2Dict, PinyinImeV2RuntimeConfig } from '../pinyin-ime-v2/pinyin-ime-v2-types';
import type { UtteranceSyllableCoordinate } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import type { LexicalEdge } from './build-lexical-edges';
import type { PathFineSpanView, PathCapEvent, SegmentationPath } from './lattice-path-types';
import {
  runLatticeFineSpanGeneration,
  runLatticeFineSpanGenerationFromLexicalEdges,
  type LatticeFineSpanSuccess,
  type LatticePathLimits,
} from './lattice-fine-span-runtime';

export type Phase2PathHarnessInput = {
  sentenceId?: string;
  rawText: string;
  runtime: LexiconRuntimeV2;
  profile: ActiveLexiconProfileSnapshot;
  domainIds: string[];
  minPrior: number;
  imeConfig: PinyinImeV2RuntimeConfig;
  dict: PinyinImeV2Dict;
  coarseSpans?: CoarseSpan[];
  wordTimeSpans?: WordTimeSpan[];
  acousticSlices?: AcousticToneSlice[];
  fuzzyRecallEnabled?: boolean;
  toneTimestampOnlyEnabled?: boolean;
  measureHeap?: boolean;
};

export type Phase2PathDiagnostics = {
  singleCharLexicalEdgeCount: number;
  singleCharLexicalEdgeUsedCount: number;
  singleCharFallbackEdgeCount: number;
  harnessOnly: true;
};

export type Phase2PathHarnessResult = {
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
  fallbackInjectionRanges: ReadonlyArray<{ start: number; end: number }>;
  fallbackInjectionEdgeIds: ReadonlyArray<string>;
  capEvents: ReadonlyArray<PathCapEvent>;
  paths: ReadonlyArray<SegmentationPath>;
  pathFineSpanViews: ReadonlyArray<PathFineSpanView>;
  diagnostics: Phase2PathDiagnostics;
  /** Window/recall counters from production entry (slim; replaces Phase1-only dump). */
  productionTrace?: LatticeFineSpanSuccess['trace'];
};

function harnessAuditFromSuccess(
  core: LatticeFineSpanSuccess,
  lexicalEdgesBeforeFallback: readonly LexicalEdge[],
  sentenceId?: string
): Phase2PathHarnessResult {
  const fallbackInjectionEdgeIds = core.edgesAfterFallback
    .filter((e) => e.edgeKind === 'fallback')
    .map((e) => e.edgeId)
    .sort((a, b) => a.localeCompare(b));

  const singleCharLexicalEdgeCount = lexicalEdgesBeforeFallback.filter(
    (e) => e.edgeKind === 'lexical' && e.syllableEnd - e.syllableStart === 1
  ).length;
  const singleCharFallbackEdgeCount = core.edgesAfterFallback.filter(
    (e) => e.edgeKind === 'fallback' && e.syllableEnd - e.syllableStart === 1
  ).length;
  const usedSingleCharLexical = new Set<string>();
  for (const path of core.segmentationPaths) {
    for (const edge of path.edgeRefs) {
      if (edge.edgeKind === 'lexical' && edge.syllableEnd - edge.syllableStart === 1) {
        usedSingleCharLexical.add(edge.edgeId);
      }
    }
  }

  return {
    sentenceId,
    syllableCount: core.syllableCount,
    lexicalEdgeCount: lexicalEdgesBeforeFallback.length,
    fallbackEdgeCount: core.trace.fallbackEdgeCount,
    completePathCountBeforePrune: core.trace.completePathCount,
    retainedCompletePathCount: core.trace.retainedCompletePathCount,
    prunedPathCount: core.trace.prunedPathCount,
    boundaryKeys: core.segmentationPaths.map((p) => p.boundaryKey),
    prunedBoundaryKeys: [],
    pruneReasons: core.trace.pathCapEvents.map((e) => e.reason),
    fallbackInjectionCount: core.trace.fallbackInjectionCount,
    fallbackInjectionRanges: core.trace.fallbackInjectionRanges,
    fallbackInjectionEdgeIds,
    capEvents: core.trace.pathCapEvents,
    paths: core.segmentationPaths,
    pathFineSpanViews: core.pathFineSpanViews,
    diagnostics: {
      singleCharLexicalEdgeCount,
      singleCharLexicalEdgeUsedCount: usedSingleCharLexical.size,
      singleCharFallbackEdgeCount,
      harnessOnly: true,
    },
    productionTrace: core.trace,
  };
}

export function runPhase2PathHarnessFromLexicalEdges(input: {
  sentenceId?: string;
  rawText: string;
  coordinate: UtteranceSyllableCoordinate;
  syllableCount: number;
  lexicalEdges: readonly LexicalEdge[];
  limits?: LatticePathLimits;
}): Phase2PathHarnessResult {
  const core = runLatticeFineSpanGenerationFromLexicalEdges({
    rawText: input.rawText,
    coordinate: input.coordinate,
    syllableCount: input.syllableCount,
    lexicalEdges: input.lexicalEdges,
    limits: input.limits,
  });
  if (!core.ok) {
    throw new Error(`[PHASE2_HARNESS] production lattice entry failed: ${core.code} ${core.message}`);
  }
  return harnessAuditFromSuccess(core, input.lexicalEdges, input.sentenceId);
}

/**
 * Phase 2 Path harness — offline only.
 * Full path: Production Lattice Entry (real Recall → Edge → fallback → Path → PathFineSpanView).
 */
export function runPhase2PathHarness(input: Phase2PathHarnessInput): Phase2PathHarnessResult {
  const core = runLatticeFineSpanGeneration({
    rawText: input.rawText,
    runtime: input.runtime,
    profile: input.profile,
    domainIds: input.domainIds,
    minPrior: input.minPrior,
    imeConfig: input.imeConfig,
    dict: input.dict,
    coarseSpans: input.coarseSpans,
    wordTimeSpans: input.wordTimeSpans,
    acousticSlices: input.acousticSlices,
    fuzzyRecallEnabled: input.fuzzyRecallEnabled,
    toneTimestampOnlyEnabled: input.toneTimestampOnlyEnabled,
  });
  if (!core.ok) {
    throw new Error(`[PHASE2_HARNESS] production lattice entry failed: ${core.code} ${core.message}`);
  }
  return harnessAuditFromSuccess(core, core.lexicalEdges, input.sentenceId);
}
