/**
 * Path Fine Span runtime contract (SegmentationPath materialization ownership).
 *
 * These types belong to Lattice / SegmentationPath ownership.
 * Runtime DTO = span facts for Vote / Assembly / Tone rebind / diagnostics.
 */

import type { FineSpanSelectionReason, FormalWindowSource } from '../domain-context-contract';
import type { WindowCandidate } from './v4-types';

/**
 * Optional diagnostics attached after tone rebind to the span's final range.
 * Not a Vote/Assembly input.
 */
export type PathFineSpanToneRebindTrace = {
  /** First candidate raw range before rebind (diagnostics only). */
  preRebindCandidateRawStart: number;
  preRebindCandidateRawEnd: number;
  /** PathFineSpan raw range used for rebind. */
  pathRawStart: number;
  pathRawEnd: number;
  finalToneRawStart: number;
  finalToneRawEnd: number;
  recomputedAfterRebind: true;
  acousticTonePattern: number[] | null;
};

/**
 * Unified Fine Span unit after Path materialization.
 *
 * `selectionReason` records materialization provenance (`lattice_path_edge`, window source class).
 * Ranking process fields (cursor, optionRank, tiebreak steps) must NOT be added here.
 */
export type PathFineSpan = {
  spanId: string;
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  coarseSpanIds: string[];
  boundaryCrossCount: 0 | 1;
  windowSource: FormalWindowSource;
  candidates: WindowCandidate[];
  selectionReason: FineSpanSelectionReason;
  /** Diagnostics only — set by tone fine-span rebind. */
  toneRebindTrace?: PathFineSpanToneRebindTrace;
};

export type PathFineSpanView = {
  pathId: string;
  boundaryKey: string;
  pathFineSpans: readonly PathFineSpan[];
};

/** AR-03 — reusable runtime invariant (fail-fast, not auto-repair). */
export function assertPathFineSpansNonOverlapping(spans: readonly PathFineSpan[]): void {
  const sorted = [...spans].sort((a, b) => a.syllableStart - b.syllableStart);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]!.syllableStart < sorted[i - 1]!.syllableEnd) {
      throw new Error(
        `[PATH_FINE_SPAN] PathFineSpan overlap detected (${sorted[i - 1]!.spanId} vs ${sorted[i]!.spanId}) — Assembly must fail-fast, not auto-repair`
      );
    }
  }
}
