/**
 * Pure window construction core shared by Lattice Window / Edge generators.
 *
 * Responsibilities: syllable/raw range, window text, pinyin key, coarse refs,
 * boundary metadata, stable windowId. No commit, cursor, ranking, vote, or assembly.
 */

import type { CharSyllableRange } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import { syllableRangeToRawCharRange } from '../pinyin-ime-v2/pinyin-ime-v2-boundary-compatible-topk-diff';
import type { CoarseSpan } from '../span-assembly-shared/types';
import {
  collectDistinctCoarseSpanIds,
  resolveAnchorCoarseSpanId,
} from './collect-distinct-coarse-span-ids';
import { V4_LIMITS } from './v4-limits';
import type { GlobalWindowDescriptor } from './v4-types';

export type BuildWindowDescriptorForRangeInput = {
  syllableStart: number;
  syllableEnd: number;
  rawText: string;
  globalSyllables: readonly string[];
  coarseSpans: readonly CoarseSpan[];
  charSyllableRanges: readonly CharSyllableRange[];
  /**
   * LTR default false — empty coarse refs → null (legacy hard-cut).
   * Lattice true — empty coarseBoundaryRefs allowed; window still emitted.
   */
  allowEmptyCoarseRefs?: boolean;
  /**
   * LTR default true — boundaryCrossCount > max marks blocked.
   * Lattice false — coarse cross is soft metadata only (hard blocks via lattice filter).
   */
  hardBlockOnBoundaryCross?: boolean;
};

function resolveWindowSource(
  boundaryCrossCount: number,
  hardBlockOnBoundaryCross: boolean
): GlobalWindowDescriptor['windowSource'] {
  if (hardBlockOnBoundaryCross && boundaryCrossCount > V4_LIMITS.maxBoundaryCrossCount) {
    return 'blocked';
  }
  if (boundaryCrossCount >= 1) {
    return 'boundary_window';
  }
  return 'in_span_window';
}

/**
 * Build a GlobalWindowDescriptor for half-open syllable range [start, end).
 * Returns null only when the range is out of bounds, raw mapping fails, or
 * (LTR mode) coarse refs are empty.
 */
export function buildWindowDescriptorForRange(
  input: BuildWindowDescriptorForRangeInput
): GlobalWindowDescriptor | null {
  const {
    syllableStart,
    syllableEnd,
    rawText,
    globalSyllables,
    coarseSpans,
    charSyllableRanges,
  } = input;
  const allowEmptyCoarseRefs = input.allowEmptyCoarseRefs === true;
  const hardBlockOnBoundaryCross = input.hardBlockOnBoundaryCross !== false;

  if (
    syllableStart < 0 ||
    syllableEnd <= syllableStart ||
    syllableEnd > globalSyllables.length
  ) {
    return null;
  }

  const spanIds = collectDistinctCoarseSpanIds(syllableStart, syllableEnd, [...coarseSpans]);
  if (!spanIds.length && !allowEmptyCoarseRefs) {
    return null;
  }

  const boundaryCrossCount = spanIds.length > 0 ? spanIds.length - 1 : 0;
  const charRange = syllableRangeToRawCharRange(
    charSyllableRanges.map((r) => ({ ...r })),
    syllableStart,
    syllableEnd
  );
  if (!charRange) {
    return null;
  }

  const syllables = globalSyllables.slice(syllableStart, syllableEnd);
  const blockedByBoundary =
    hardBlockOnBoundaryCross && boundaryCrossCount > V4_LIMITS.maxBoundaryCrossCount;

  return {
    windowId: `${syllableStart}:${syllableEnd}`,
    syllableStart,
    syllableEnd,
    rawStart: charRange.start,
    rawEnd: charRange.end,
    windowText: rawText.slice(charRange.start, charRange.end),
    windowPinyinKey: syllables.join('|'),
    spanIds,
    boundaryCrossCount,
    windowSource: resolveWindowSource(boundaryCrossCount, hardBlockOnBoundaryCross),
    anchorCoarseSpanId: resolveAnchorCoarseSpanId(spanIds, [...coarseSpans]),
    blocked: blockedByBoundary,
    blockedBoundaryReason: blockedByBoundary ? 'boundary_cross_count' : undefined,
  };
}

/** Lattice window length bounds (Architecture 1..5). Independent of V4_LIMITS.windowMinSyllables. */
export const LATTICE_WINDOW_MIN_SYLLABLES = 1;
export const LATTICE_WINDOW_MAX_SYLLABLES = 5;

/** Theoretical full-utterance window count for N syllables with max length L. */
export function theoreticalLexicalWindowCount(
  syllableCount: number,
  maxLen: number = LATTICE_WINDOW_MAX_SYLLABLES
): number {
  if (syllableCount <= 0) {
    return 0;
  }
  let total = 0;
  for (let start = 0; start < syllableCount; start += 1) {
    total += Math.min(maxLen, syllableCount - start);
  }
  return total;
}
