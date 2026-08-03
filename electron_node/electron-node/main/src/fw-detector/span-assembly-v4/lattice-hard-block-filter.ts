/**
 * Lattice Phase 1 hard-block filter.
 *
 * Keeps Latin / whitespace / punctuation / non-CJK / ASR-gap protections from
 * blockedFilter, but does NOT hard-block solely for coarse boundaryCrossCount.
 * Production blockedFilter continues to use the same hard-block contract for boundary_cross_count.
 */

import type { WordTimeSpan } from '../tone-time-align';
import type { CoarseSpan } from '../span-assembly-shared/types';
import { V4_LIMITS } from './v4-limits';
import type { BlockedBoundaryReason, GlobalWindowDescriptor } from './v4-types';

const PUNCTUATION_RE = /[，。！？、；：,.!?;:]/;
const SENTENCE_BOUNDARY_RE = /[。！？.!?]/;
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

function spansInWindow(
  window: GlobalWindowDescriptor,
  coarseSpans: CoarseSpan[]
): CoarseSpan[] {
  return window.spanIds
    .map((id) => coarseSpans.find((s) => s.id === id))
    .filter((s): s is CoarseSpan => s != null)
    .sort((a, b) => a.rawStart - b.rawStart);
}

function hasRawGapBetweenSpans(window: GlobalWindowDescriptor, coarseSpans: CoarseSpan[]): boolean {
  const spans = spansInWindow(window, coarseSpans);
  for (let i = 1; i < spans.length; i += 1) {
    if (spans[i - 1].rawEnd !== spans[i].rawStart) {
      return true;
    }
  }
  return false;
}

function hasWhitespaceGap(rawText: string, rawStart: number, rawEnd: number): boolean {
  return /\s/.test(rawText.slice(rawStart, rawEnd));
}

function hasPunctuationInWindow(rawText: string, rawStart: number, rawEnd: number): boolean {
  return PUNCTUATION_RE.test(rawText.slice(rawStart, rawEnd));
}

/**
 * Block only when the window slice itself contains a sentence boundary.
 * Adjacency to punctuation outside [rawStart, rawEnd) is allowed (Change Record 1.0.2).
 */
function hasSentenceBoundary(rawText: string, rawStart: number, rawEnd: number): boolean {
  return SENTENCE_BOUNDARY_RE.test(rawText.slice(rawStart, rawEnd));
}

function hasNonCjkSyllable(rawText: string, rawStart: number, rawEnd: number): boolean {
  const slice = rawText.slice(rawStart, rawEnd);
  for (const ch of slice) {
    if (!CJK_RE.test(ch) && !/\s/.test(ch) && !PUNCTUATION_RE.test(ch)) {
      return true;
    }
  }
  return false;
}

function hasAsrWordGap(
  rawStart: number,
  rawEnd: number,
  wordTimeSpans: WordTimeSpan[]
): boolean {
  const covering = wordTimeSpans
    .filter((w) => (w.rawEnd ?? 0) > rawStart && (w.rawStart ?? 0) < rawEnd)
    .sort((a, b) => (a.rawStart ?? 0) - (b.rawStart ?? 0));
  for (let i = 1; i < covering.length; i += 1) {
    const gapMs = (covering[i].start - covering[i - 1].end) * 1000;
    if (gapMs > V4_LIMITS.asrWordGapMs) {
      return true;
    }
  }
  return false;
}

function markBlocked(
  window: GlobalWindowDescriptor,
  reason: BlockedBoundaryReason
): GlobalWindowDescriptor {
  return {
    ...window,
    blocked: true,
    windowSource: 'blocked',
    blockedBoundaryReason: reason,
  };
}

function softClearBoundaryCrossHardBlock(window: GlobalWindowDescriptor): GlobalWindowDescriptor {
  if (!window.blocked || window.blockedBoundaryReason !== 'boundary_cross_count') {
    return window;
  }
  return {
    ...window,
    blocked: false,
    blockedBoundaryReason: undefined,
    windowSource: window.boundaryCrossCount >= 1 ? 'boundary_window' : 'in_span_window',
  };
}

/**
 * Lattice harness blockedFilter equivalent: hard raw/gap/punct/non-CJK only.
 * Crossing coarse boundaries is soft metadata, never a sole hard block reason.
 */
export function latticeHardBlockFilter(input: {
  windows: GlobalWindowDescriptor[];
  rawText: string;
  coarseSpans: CoarseSpan[];
  wordTimeSpans?: WordTimeSpan[];
}): GlobalWindowDescriptor[] {
  const wordTimeSpans = input.wordTimeSpans ?? [];
  return input.windows.map((rawWindow) => {
    const window = softClearBoundaryCrossHardBlock(rawWindow);
    if (window.blocked) {
      return window;
    }

    if (hasRawGapBetweenSpans(window, input.coarseSpans)) {
      return markBlocked(window, 'raw_gap_between_spans');
    }
    if (hasWhitespaceGap(input.rawText, window.rawStart, window.rawEnd)) {
      return markBlocked(window, 'whitespace_gap');
    }
    if (hasPunctuationInWindow(input.rawText, window.rawStart, window.rawEnd)) {
      return markBlocked(window, 'punctuation_in_window');
    }
    if (hasSentenceBoundary(input.rawText, window.rawStart, window.rawEnd)) {
      return markBlocked(window, 'sentence_boundary');
    }
    if (hasNonCjkSyllable(input.rawText, window.rawStart, window.rawEnd)) {
      return markBlocked(window, 'non_cjk_syllable');
    }
    if (hasAsrWordGap(window.rawStart, window.rawEnd, wordTimeSpans)) {
      return markBlocked(window, 'asr_word_gap_ms');
    }

    return window;
  });
}
