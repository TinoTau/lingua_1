import { textToSyllables } from './phonetic/pinyin';
import {
  findConfusionObservedSpans,
  findChunkPinyinAlignedObservedSpans,
  findFuzzyConfusionObservedSpans,
} from './confusion-observed-spans';
import { classifyNoWindowBucket } from './no-window-bucket';
import { enumerateAsrWindows } from './enumerate-asr-windows';
import {
  emptyHotwordRecallStats,
  recallHotwordsForWindow,
  type HotwordRecallStats,
} from './hotword-recall';
import type { ASRHypothesis } from '../asr/types';
import type { AsrWindow } from './lexicon-types';
import type { TextSpan } from './suspicious-span-detector';
import type { WindowCandidate } from './hotword-types';
import type { LexiconRuntime } from './lexicon-runtime';
import { buildNbestAugmentDiagnostics } from '../asr/segment-alignment-diagnostics';
import {
  emptyWindowRecallDiagnostics,
  type NbestAugmentDropEvent,
  type WindowRecallDiagnostics,
} from './window-recall-diagnostics';

const MAX_NBEST_AUGMENT_DROP_EVENTS = 32;

function recordNbestAugmentDrop(
  diagnostics: WindowRecallDiagnostics,
  dropReason: string,
  coords?: { windowStart?: number; windowEnd?: number; hypothesisRank?: number }
): void {
  diagnostics.nbestAugmentDroppedSlices = (diagnostics.nbestAugmentDroppedSlices ?? 0) + 1;
  diagnostics.nbestAugmentDropReason = dropReason;
  const events = diagnostics.nbestAugmentDropEvents ?? [];
  if (events.length < MAX_NBEST_AUGMENT_DROP_EVENTS) {
    const event: NbestAugmentDropEvent = {
      augmentSliceDropped: true,
      dropReason,
      windowStart: coords?.windowStart,
      windowEnd: coords?.windowEnd,
      hypothesisRank: coords?.hypothesisRank,
    };
    diagnostics.nbestAugmentDropEvents = [...events, event];
  }
}

export const DEFAULT_MAX_WINDOW_CANDIDATES = 192;
/** Segment-first: all window spans use rank 0 coordinates on segment text. */
export const SEGMENT_HYPOTHESIS_INDEX = 0;

export type SegmentWindowRecallResult = {
  candidates: WindowCandidate[];
  truncated: boolean;
  windowCount: number;
  diagnostics: WindowRecallDiagnostics;
};

function hashShort(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function windowKey(start: number, end: number, text: string): string {
  return `${start}:${end}:${text}`;
}

function spanToAsrWindow(span: TextSpan, hypothesisIndex: number, tag: string): AsrWindow {
  const syllables = textToSyllables(span.text);
  return {
    windowId: `h${hypothesisIndex}-${tag}-${span.start}-${span.end}-${hashShort(span.text)}`,
    text: span.text,
    start: span.start,
    end: span.end,
    syllables,
  };
}

function mergeAsrWindows(sliding: AsrWindow[], extra: AsrWindow[]): AsrWindow[] {
  const seen = new Set<string>();
  const out: AsrWindow[] = [];
  for (const w of [...sliding, ...extra]) {
    if (!w.syllables.length) {
      continue;
    }
    const key = windowKey(w.start, w.end, w.text);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(w);
  }
  return out;
}

function confusionSpansToWindows(
  text: string,
  observedStrings: readonly string[],
  hypothesisIndex: number,
  tag: string
): AsrWindow[] {
  return findConfusionObservedSpans(text, observedStrings).map((span) =>
    spanToAsrWindow(span, hypothesisIndex, tag)
  );
}

function hitToWindowCandidate(
  hit: ReturnType<typeof recallHotwordsForWindow>[number],
  window: { windowId: string; text: string; start: number; end: number },
  fromText: string
): WindowCandidate {
  const source =
    hit.recallPath === 'fuzzy_observed'
      ? 'fuzzy_observed'
      : hit.recallPath === 'confusion_evidence'
        ? 'confusion_evidence'
        : hit.recallPath === 'exact'
          ? 'exact'
          : 'hotword';
  return {
    windowId: window.windowId,
    hypothesisIndex: SEGMENT_HYPOTHESIS_INDEX,
    from: fromText,
    to: hit.hotword.word,
    start: window.start,
    end: window.end,
    hotwordId: hit.hotword.id,
    phoneticScore: hit.phoneticScore,
    priorScore: hit.priorScore,
    source,
  };
}

function candidateKey(c: WindowCandidate): string {
  return [c.start, c.end, c.hotwordId, c.to].join('\0');
}

function mergeStats(target: WindowRecallDiagnostics, win: HotwordRecallStats): void {
  target.hitsObserved += win.hitsObserved;
  target.hitsPinyin += win.hitsPinyin;
  target.hitsConfusion += win.hitsConfusion;
  target.hitsFuzzyObserved += win.hitsFuzzyObserved;
  target.droppedBelowPinyinThreshold += win.droppedBelowPinyinThreshold;
  target.fuzzyObservedAttemptCount =
    (target.fuzzyObservedAttemptCount ?? 0) + win.fuzzyObservedAttemptCount;
  target.fuzzyObservedHitCount = (target.fuzzyObservedHitCount ?? 0) + win.fuzzyObservedHitCount;
  target.fuzzyObservedRejectedCount =
    (target.fuzzyObservedRejectedCount ?? 0) + win.fuzzyObservedRejectedCount;
  target.pinyinAttemptCount = (target.pinyinAttemptCount ?? 0) + win.pinyinAttemptCount;
  target.pinyinHitCount = (target.pinyinHitCount ?? 0) + win.pinyinHitCount;
  target.pinyinNoHitCount = (target.pinyinNoHitCount ?? 0) + win.pinyinNoHitCount;
}

function pushHits(
  segmentText: string,
  window: AsrWindow,
  hits: ReturnType<typeof recallHotwordsForWindow>,
  seen: Set<string>,
  out: WindowCandidate[],
  maxCandidates: number,
  diagnostics: WindowRecallDiagnostics
): boolean {
  const fromText = segmentText.slice(window.start, window.end);
  for (const hit of hits) {
    if (hit.hotword.word === fromText) {
      continue;
    }
    const candidate = hitToWindowCandidate(hit, window, fromText);
    const key = candidateKey(candidate);
    if (seen.has(key)) {
      diagnostics.candidateDedupDropped += 1;
      continue;
    }
    seen.add(key);
    out.push(candidate);
    if (out.length >= maxCandidates) {
      diagnostics.droppedByQuota += 1;
      return true;
    }
  }
  return false;
}

function recallOnWindows(
  segmentText: string,
  windows: AsrWindow[],
  runtime: LexiconRuntime,
  seen: Set<string>,
  out: WindowCandidate[],
  maxCandidates: number,
  diagnostics: WindowRecallDiagnostics
): boolean {
  for (const window of windows) {
    const winStats = emptyHotwordRecallStats();
    const hits = recallHotwordsForWindow(window, runtime, undefined, winStats);
    const before = out.length;
    if (hits.length > 0) {
      diagnostics.windowsWithRecallTriggered += 1;
    }
    mergeStats(diagnostics, winStats);
    if (pushHits(segmentText, window, hits, seen, out, maxCandidates, diagnostics)) {
      return true;
    }
    if (hits.length > 0 && out.length === before) {
      diagnostics.pinyinNormalizationMismatchCount =
        (diagnostics.pinyinNormalizationMismatchCount ?? 0) + 1;
    }
  }
  return false;
}

/**
 * Map confusion span in n-best text to segment coordinates when possible.
 */
function mapHypothesisSpanToSegment(
  segmentText: string,
  hypText: string,
  span: TextSpan
): TextSpan | null {
  if (hypText.length === segmentText.length) {
    return { text: span.text, start: span.start, end: span.end };
  }
  const at = segmentText.indexOf(span.text);
  if (at < 0) {
    return null;
  }
  return { text: span.text, start: at, end: at + span.text.length };
}

function buildSegmentWindows(
  segmentText: string,
  hypotheses: ASRHypothesis[],
  observedStrings: readonly string[],
  diagnostics: WindowRecallDiagnostics
): AsrWindow[] {
  const sliding = enumerateAsrWindows(segmentText, {
    hypothesisIndex: SEGMENT_HYPOTHESIS_INDEX,
  });
  const confusionOnSegment = confusionSpansToWindows(
    segmentText,
    observedStrings,
    SEGMENT_HYPOTHESIS_INDEX,
    'cf'
  );
  diagnostics.confusionSpansOnSegment = confusionOnSegment.length;
  const fuzzySpans = findFuzzyConfusionObservedSpans(segmentText, observedStrings);
  const chunkPinyinSpans = findChunkPinyinAlignedObservedSpans(segmentText, observedStrings);
  diagnostics.confusionSpansFuzzyOnSegment = fuzzySpans.length;
  diagnostics.confusionSpansChunkPinyinOnSegment = chunkPinyinSpans.length;
  const fuzzyOnSegment = [
    ...fuzzySpans.map((span) => spanToAsrWindow(span, SEGMENT_HYPOTHESIS_INDEX, 'cffz')),
    ...chunkPinyinSpans.map((span) => spanToAsrWindow(span, SEGMENT_HYPOTHESIS_INDEX, 'cfpy')),
  ];

  const fromNbest: AsrWindow[] = [];
  for (const hypothesis of hypotheses) {
    if (hypothesis.rank === SEGMENT_HYPOTHESIS_INDEX) {
      continue;
    }
    const hypText = hypothesis.text.trim();
    if (!hypText) {
      continue;
    }
    const hypSpans = findConfusionObservedSpans(hypText, observedStrings);
    for (const span of hypSpans) {
      const mapped = mapHypothesisSpanToSegment(segmentText, hypText, span);
      if (!mapped) {
        recordNbestAugmentDrop(diagnostics, 'span_out_of_range', {
          windowStart: span.start,
          windowEnd: span.end,
          hypothesisRank: hypothesis.rank,
        });
        continue;
      }
      diagnostics.nbestConfusionSpansMapped += 1;
      fromNbest.push(spanToAsrWindow(mapped, SEGMENT_HYPOTHESIS_INDEX, `nb${hypothesis.rank}cf`));
    }
  }

  return mergeAsrWindows(sliding, [...confusionOnSegment, ...fuzzyOnSegment, ...fromNbest]);
}

/**
 * N-best phonetic evidence at segment coordinates (same length only).
 */
function augmentFromNbestSlices(
  segmentText: string,
  windows: AsrWindow[],
  hypotheses: ASRHypothesis[],
  runtime: LexiconRuntime,
  seen: Set<string>,
  out: WindowCandidate[],
  maxCandidates: number,
  diagnostics: WindowRecallDiagnostics
): void {
  for (const hypothesis of hypotheses) {
    if (hypothesis.rank === SEGMENT_HYPOTHESIS_INDEX) {
      continue;
    }
    const hypText = hypothesis.text.trim();
    if (hypText.length !== segmentText.length) {
      for (let i = 0; i < windows.length; i++) {
        recordNbestAugmentDrop(diagnostics, 'segment_hypothesis_mismatch', {
          windowStart: windows[i]?.start,
          windowEnd: windows[i]?.end,
          hypothesisRank: hypothesis.rank,
        });
      }
      continue;
    }

    for (const window of windows) {
      const fromText = segmentText.slice(window.start, window.end);
      const hypSlice = hypText.slice(window.start, window.end);
      if (hypSlice === fromText) {
        continue;
      }
      diagnostics.nbestAugmentSlices += 1;

      const hypWindow: AsrWindow = {
        windowId: `${window.windowId}-nb${hypothesis.rank}`,
        text: hypSlice,
        start: window.start,
        end: window.end,
        syllables: textToSyllables(hypSlice),
      };
      const winStats = emptyHotwordRecallStats();
      const hits = recallHotwordsForWindow(hypWindow, runtime, undefined, winStats);
      if (hits.length > 0) {
        diagnostics.windowsWithRecallTriggered += 1;
      }
      mergeStats(diagnostics, winStats);
      if (pushHits(segmentText, window, hits, seen, out, maxCandidates, diagnostics)) {
        return;
      }
    }
  }
}

/**
 * Segment-first window recall (V3 Phase B / GB-1).
 */
export function recallSegmentWindowCandidates(
  segmentText: string,
  hypotheses: ASRHypothesis[],
  runtime: LexiconRuntime,
  maxCandidates: number = DEFAULT_MAX_WINDOW_CANDIDATES
): SegmentWindowRecallResult {
  const trimmed = segmentText.trim();
  const diagnostics = emptyWindowRecallDiagnostics();
  diagnostics.segmentTextLength = trimmed.length;
  diagnostics.hypothesisCount = hypotheses.length;

  const rank0 = hypotheses.find((h) => h.rank === SEGMENT_HYPOTHESIS_INDEX)?.text?.trim() ?? '';
  diagnostics.segmentHypothesisAligned = rank0 === trimmed || !rank0;

  if (!trimmed) {
    return { candidates: [], truncated: false, windowCount: 0, diagnostics };
  }

  const observedStrings = runtime.getConfusionObservedStrings();
  const windows = buildSegmentWindows(trimmed, hypotheses, observedStrings, diagnostics);
  diagnostics.windowsEnumerated = windows.length;

  const seen = new Set<string>();
  const out: WindowCandidate[] = [];

  let truncated = recallOnWindows(trimmed, windows, runtime, seen, out, maxCandidates, diagnostics);
  if (!truncated) {
    augmentFromNbestSlices(trimmed, windows, hypotheses, runtime, seen, out, maxCandidates, diagnostics);
    truncated = out.length >= maxCandidates;
  }

  out.sort((a, b) => {
    if (b.phoneticScore !== a.phoneticScore) {
      return b.phoneticScore - a.phoneticScore;
    }
    return b.priorScore - a.priorScore;
  });

  diagnostics.windowCandidateCount = out.length;
  diagnostics.truncated = truncated;

  if (out.length === 0) {
    diagnostics.noWindowBucket = classifyNoWindowBucket({
      segmentTextLength: trimmed.length,
      diagnostics,
      confusionObservedCount: observedStrings.length,
    });
  }

  diagnostics.nbestAugment = buildNbestAugmentDiagnostics({
    nbestAugmentSlices: diagnostics.nbestAugmentSlices,
    nbestAugmentDroppedSlices: diagnostics.nbestAugmentDroppedSlices ?? 0,
    nbestAugmentDropReason: diagnostics.nbestAugmentDropReason,
  });

  return {
    candidates: out,
    truncated,
    windowCount: windows.length,
    diagnostics,
  };
}
