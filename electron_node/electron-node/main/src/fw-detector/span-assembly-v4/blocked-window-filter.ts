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

function hasSentenceBoundary(rawText: string, rawStart: number, rawEnd: number): boolean {
  const slice = rawText.slice(rawStart, rawEnd);
  if (SENTENCE_BOUNDARY_RE.test(slice)) {
    return true;
  }
  if (rawStart > 0 && SENTENCE_BOUNDARY_RE.test(rawText[rawStart - 1] ?? '')) {
    return true;
  }
  if (rawEnd < rawText.length && SENTENCE_BOUNDARY_RE.test(rawText[rawEnd] ?? '')) {
    return true;
  }
  return false;
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

export function blockedFilter(input: {
  windows: GlobalWindowDescriptor[];
  rawText: string;
  coarseSpans: CoarseSpan[];
  wordTimeSpans: WordTimeSpan[];
}): GlobalWindowDescriptor[] {
  return input.windows.map((window) => {
    if (window.blocked) {
      return window;
    }

    if (window.boundaryCrossCount > V4_LIMITS.maxBoundaryCrossCount) {
      return markBlocked(window, 'boundary_cross_count');
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
    if (hasAsrWordGap(window.rawStart, window.rawEnd, input.wordTimeSpans)) {
      return markBlocked(window, 'asr_word_gap_ms');
    }

    return window;
  });
}

export function truncateWindows(windows: GlobalWindowDescriptor[]): {
  windows: GlobalWindowDescriptor[];
  truncatedCount: number;
  truncatedWindows: GlobalWindowDescriptor[];
} {
  const recallable = windows.filter((w) => !w.blocked);
  const inSpan = recallable
    .filter((w) => w.windowSource === 'in_span_window')
    .sort((a, b) => a.syllableStart - b.syllableStart);
  const boundary = recallable
    .filter((w) => w.windowSource === 'boundary_window')
    .sort((a, b) => a.syllableStart - b.syllableStart);

  const kept: GlobalWindowDescriptor[] = [];
  const keptIds = new Set<string>();

  for (const w of inSpan) {
    if (kept.length >= V4_LIMITS.maxGlobalWindowCount) {
      break;
    }
    kept.push(w);
    keptIds.add(w.windowId);
  }
  let boundaryKept = 0;
  for (const w of boundary) {
    if (kept.length >= V4_LIMITS.maxGlobalWindowCount) {
      break;
    }
    if (boundaryKept >= V4_LIMITS.maxBoundaryWindowCount) {
      break;
    }
    kept.push(w);
    keptIds.add(w.windowId);
    boundaryKept += 1;
  }

  const truncatedWindows = recallable.filter((w) => !keptIds.has(w.windowId));

  return {
    windows: kept,
    truncatedCount: truncatedWindows.length,
    truncatedWindows,
  };
}
