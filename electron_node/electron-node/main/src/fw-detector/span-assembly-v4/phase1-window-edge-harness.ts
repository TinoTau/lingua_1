/**
 * Lattice Phase 1 independent harness — WindowQuery → Lattice hard-block → Recall → LexicalEdge.
 * Tests / offline probes only. Must NOT be called from production orchestrator.
 */

import type { LexiconRuntimeV2 } from '../../lexicon-v2/lexicon-runtime-v2';
import type { ActiveLexiconProfileSnapshot } from '../../session-runtime/types';
import type { WordTimeSpan } from '../tone-time-align';
import type { AcousticToneSlice } from '../tone-time-align';
import { buildUtteranceSyllableCoordinate } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import { partitionCoarseSpans } from '../span-assembly-shared/coarse-span-partition';
import type { CoarseSpan } from '../span-assembly-shared/types';
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
  type UtteranceRecallContext,
} from './utterance-recall-cache';
import type { WindowCandidate } from './v4-types';
import { theoreticalLexicalWindowCount } from './window-construction-core';

export type Phase1WindowTraceEvent =
  | { kind: 'windowGenerated'; windowId: string }
  | { kind: 'windowBlocked'; windowId: string; reason?: string }
  | { kind: 'windowRecalled'; windowId: string; candidateCount: number }
  | { kind: 'windowNoCandidate'; windowId: string }
  | { kind: 'lexicalEdgeCreated'; edgeId: string; candidateCount: number };

export type Phase1WindowEdgeDiagnostics = {
  windowCount: number;
  blockedWindowCount: number;
  recallableWindowCount: number;
  logicalWindowRecallCount: number;
  windowNoCandidateCount: number;
  theoreticalWindowCount: number;
  canonicalRecallQueryCount: number;
  uniqueRecallKeyCount: number;
  cacheHitCount: number;
  cacheMissCount: number;
  physicalSqlStatementCount: number;
  edgeCount: number;
  candidateCount: number;
  /** Length=1 windows generated (all sources, including blocked). */
  singleCharWindowCount: number;
  /** Length=1 windows that entered Recall (not blocked). */
  singleCharRecallCount: number;
  /** Length=1 windows with ≥1 candidate after Recall. */
  singleCharHitCount: number;
  /** Total candidates from length=1 windows. */
  singleCharCandidateCount: number;
  /** Length=1 windows that returned exactly 1 candidate under cap=1. */
  singleCharCandidateCapHitCount: number;
  /** Lexical edges spanning exactly 1 syllable. */
  singleCharLexicalEdgeCount: number;
  latencyMs: number;
  heapDeltaBytes: number | null;
  harnessOnly: true;
};

export type Phase1WindowEdgeHarnessResult = {
  syllableCount: number;
  windows: LexicalWindowQuery[];
  filteredWindows: LexicalWindowQuery[];
  recalledWindows: Array<{
    windowId: string;
    candidates: WindowCandidate[];
  }>;
  edges: LexicalEdge[];
  diagnostics: Phase1WindowEdgeDiagnostics;
  trace: Phase1WindowTraceEvent[];
};

export type Phase1WindowEdgeHarnessInput = {
  rawText: string;
  runtime: LexiconRuntimeV2;
  profile: ActiveLexiconProfileSnapshot;
  domainIds: string[];
  minPrior: number;
  imeConfig: PinyinImeV2RuntimeConfig;
  dict: PinyinImeV2Dict;
  /** Optional precomputed coarse spans (tests). */
  coarseSpans?: CoarseSpan[];
  wordTimeSpans?: WordTimeSpan[];
  acousticSlices?: AcousticToneSlice[];
  fuzzyRecallEnabled?: boolean;
  /** Batch 1.1C: when true + acoustic payload, Mandatory Tone Recall may run. Default false. */
  toneTimestampOnlyEnabled?: boolean;
  measureHeap?: boolean;
};

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
  // Preserve window generation order when iterating.
  const ordered = new Map<string, WindowCandidate[]>();
  for (const w of windows) {
    ordered.set(w.windowId, byId.get(w.windowId) ?? []);
  }
  return ordered;
}

/**
 * Phase 1 harness main chain (Architecture / Implementation Contract):
 * rawText → Coordinate → partitionCoarseSpans → buildLexicalWindowQueries
 * → latticeHardBlockFilter → recallTopKForWindows → buildLexicalEdges
 */
export function runPhase1WindowEdgeHarness(
  input: Phase1WindowEdgeHarnessInput
): Phase1WindowEdgeHarnessResult {
  const t0 = Date.now();
  const heapBefore =
    input.measureHeap && typeof process !== 'undefined' && typeof process.memoryUsage === 'function'
      ? process.memoryUsage().heapUsed
      : null;

  const coordinate = buildUtteranceSyllableCoordinate(input.rawText);
  const globalSyllables = coordinate.syllables;
  const coarseSpans =
    input.coarseSpans ??
    partitionCoarseSpans({
      rawText: input.rawText,
      imeConfig: input.imeConfig,
      dict: input.dict,
    }).coarseSpans;

  const trace: Phase1WindowTraceEvent[] = [];

  const windows = buildLexicalWindowQueries({
    rawText: input.rawText,
    globalSyllables,
    coarseSpans,
    charSyllableRanges: coordinate.ranges,
  });
  for (const w of windows) {
    trace.push({ kind: 'windowGenerated', windowId: w.windowId });
  }

  const filteredWindows = latticeHardBlockFilter({
    windows,
    rawText: input.rawText,
    coarseSpans,
    wordTimeSpans: input.wordTimeSpans ?? [],
  });

  const recallableWindows = filteredWindows.filter((w) => !w.blocked);
  for (const w of filteredWindows) {
    if (w.blocked) {
      trace.push({
        kind: 'windowBlocked',
        windowId: w.windowId,
        reason: w.blockedBoundaryReason,
      });
    }
  }

  const utteranceRecall: UtteranceRecallContext = createUtteranceRecallContext(
    input.runtime.getManifestVersion() ?? 'unknown'
  );

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
    fuzzyRecallEnabled: input.fuzzyRecallEnabled === true,
    toneTimestampOnlyEnabled: input.toneTimestampOnlyEnabled === true,
    utteranceRecall,
  });

  if (recall.logicalWindowRecallCount !== recallableWindows.length) {
    releaseUtteranceRecallContext(utteranceRecall);
    throw new Error(
      `[PHASE1_HARNESS] Recall incompleteness: logicalWindowRecallCount=${recall.logicalWindowRecallCount} !== recallableWindowCount=${recallableWindows.length}`
    );
  }

  const byWindow = groupCandidatesByWindow(recallableWindows, recall.candidates);
  const recalledWindows: Phase1WindowEdgeHarnessResult['recalledWindows'] = [];
  const edgeBundles: Array<{
    windowId: string;
    syllableStart: number;
    syllableEnd: number;
    candidates: WindowCandidate[];
  }> = [];

  for (const w of recallableWindows) {
    const candidates = byWindow.get(w.windowId) ?? [];
    recalledWindows.push({ windowId: w.windowId, candidates });
    if (candidates.length > 0) {
      trace.push({
        kind: 'windowRecalled',
        windowId: w.windowId,
        candidateCount: candidates.length,
      });
      edgeBundles.push({
        windowId: w.windowId,
        syllableStart: w.syllableStart,
        syllableEnd: w.syllableEnd,
        candidates,
      });
    } else {
      trace.push({ kind: 'windowNoCandidate', windowId: w.windowId });
    }
  }

  const edges = buildLexicalEdges({ recalledWindows: edgeBundles });
  for (const e of edges) {
    trace.push({
      kind: 'lexicalEdgeCreated',
      edgeId: e.edgeId,
      candidateCount: e.candidates.length,
    });
  }

  const stats = { ...utteranceRecall.stats };
  const heapAfter =
    heapBefore != null && typeof process.memoryUsage === 'function'
      ? process.memoryUsage().heapUsed
      : null;

  const singleCharWindows = windows.filter((w) => w.syllableEnd - w.syllableStart === 1);
  const singleCharRecallable = recallableWindows.filter(
    (w) => w.syllableEnd - w.syllableStart === 1
  );
  let singleCharHitCount = 0;
  let singleCharCandidateCount = 0;
  let singleCharCandidateCapHitCount = 0;
  for (const w of singleCharRecallable) {
    const cands = byWindow.get(w.windowId) ?? [];
    singleCharCandidateCount += cands.length;
    if (cands.length > 0) {
      singleCharHitCount += 1;
    }
    if (cands.length === 1) {
      singleCharCandidateCapHitCount += 1;
    }
  }
  const singleCharLexicalEdgeCount = edges.filter(
    (e) => e.edgeKind === 'lexical' && e.syllableEnd - e.syllableStart === 1
  ).length;

  const diagnostics: Phase1WindowEdgeDiagnostics = {
    windowCount: windows.length,
    blockedWindowCount: filteredWindows.filter((w) => w.blocked).length,
    recallableWindowCount: recallableWindows.length,
    logicalWindowRecallCount: recall.logicalWindowRecallCount,
    windowNoCandidateCount: recallableWindows.filter(
      (w) => (byWindow.get(w.windowId) ?? []).length === 0
    ).length,
    theoreticalWindowCount: theoreticalLexicalWindowCount(globalSyllables.length),
    canonicalRecallQueryCount: stats.exactQueryCount,
    uniqueRecallKeyCount: stats.uniqueKeyCount,
    cacheHitCount: stats.hitCount,
    cacheMissCount: stats.missCount,
    physicalSqlStatementCount: stats.physicalSqlStatementCount || recall.physicalSqlStatementCount,
    edgeCount: edges.length,
    candidateCount: edges.reduce((n, e) => n + e.candidates.length, 0),
    singleCharWindowCount: singleCharWindows.length,
    singleCharRecallCount: singleCharRecallable.length,
    singleCharHitCount,
    singleCharCandidateCount,
    singleCharCandidateCapHitCount,
    singleCharLexicalEdgeCount,
    latencyMs: Date.now() - t0,
    heapDeltaBytes: heapBefore != null && heapAfter != null ? heapAfter - heapBefore : null,
    harnessOnly: true,
  };

  releaseUtteranceRecallContext(utteranceRecall);

  return {
    syllableCount: globalSyllables.length,
    windows,
    filteredWindows,
    recalledWindows,
    edges,
    diagnostics,
    trace,
  };
}
