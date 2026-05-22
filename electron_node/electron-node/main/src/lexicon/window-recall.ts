import { textToSyllables } from './phonetic/pinyin';
import {
  findConfusionObservedSpans,
  findChunkPinyinAlignedObservedSpans,
  findFuzzyConfusionObservedSpans,
} from './confusion-observed-spans';
import { classifyNoWindowBucket } from './no-window-bucket';
import { enumerateAsrWindows } from './enumerate-asr-windows';
import { buildDiffContextWindows } from './diff-context-windows';
import { detectNbestDiffSpans } from './nbest-diff-span';
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
import { resolveRecoverQualityConfig } from '../recover-quality/quality-config';
import {
  emptyWindowRecallDiagnostics,
  type WindowRecallDiagnostics,
} from './window-recall-diagnostics';

export const DEFAULT_MAX_WINDOW_CANDIDATES = 192;
export const DEFAULT_MAX_DIFF_WINDOWS = 64;
/** Segment-first: all window spans use rank 0 coordinates on segment text. */
export const SEGMENT_HYPOTHESIS_INDEX = 0;

export type SegmentWindowRecallResult = {
  candidates: WindowCandidate[];
  truncated: boolean;
  windowCount: number;
  diagnostics: WindowRecallDiagnostics;
  noDiffSpan?: boolean;
};

function legacySlidingEnabled(): boolean {
  return process.env.LEXICON_LEGACY_SLIDING_WINDOW === '1';
}

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
  const spans = findConfusionObservedSpans(text, observedStrings);
  return spans.map((span) => spanToAsrWindow(span, hypothesisIndex, tag));
}

/** V5 diff-first window enumeration (no sliding / observed fallback). */
function buildV5DiffWindows(
  segmentText: string,
  hypotheses: ASRHypothesis[],
  diagnostics: WindowRecallDiagnostics
): { windows: AsrWindow[]; noDiffSpan: boolean } {
  const diffSpans = detectNbestDiffSpans(segmentText, hypotheses);
  diagnostics.diffSpanCount = diffSpans.length;

  if (diffSpans.length === 0) {
    diagnostics.noDiffSpan = true;
    diagnostics.slidingWindowCount = 0;
    diagnostics.windowsFromNbestDiffCount = 0;
    diagnostics.fullChunkDualScaleCount = 0;
    return { windows: [], noDiffSpan: true };
  }

  const cfg = resolveRecoverQualityConfig();
  const built = buildDiffContextWindows(segmentText, diffSpans, {
    allowedWindowLengths: cfg.allowedWindowLengths,
    fineLengths: [2, 3],
    coarseLengths: [4, 5],
    diffContextLeft: cfg.diffContextLeft,
    diffContextRight: cfg.diffContextRight,
    maxWindows: DEFAULT_MAX_DIFF_WINDOWS,
    hypothesisIndex: SEGMENT_HYPOTHESIS_INDEX,
  });

  diagnostics.noDiffSpan = false;
  diagnostics.slidingWindowCount = 0;
  diagnostics.windowsFromNbestDiffCount = built.windows.length;
  diagnostics.windowLengthDistribution = built.windowLengthDistribution;
  diagnostics.fullChunkDualScaleCount = built.fullChunkDualScaleCount;
  return { windows: built.windows, noDiffSpan: false };
}

/** Legacy V3/V4 path — debug only (`LEXICON_LEGACY_SLIDING_WINDOW=1`). */
function buildLegacySegmentWindows(
  segmentText: string,
  hypotheses: ASRHypothesis[],
  observedStrings: readonly string[],
  diagnostics: WindowRecallDiagnostics
): AsrWindow[] {
  const sliding = enumerateAsrWindows(segmentText, {
    hypothesisIndex: SEGMENT_HYPOTHESIS_INDEX,
  });
  diagnostics.slidingWindowCount = sliding.length;
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
  return mergeAsrWindows(sliding, [...confusionOnSegment, ...fuzzyOnSegment]);
}

function hitToWindowCandidate(
  hit: ReturnType<typeof recallHotwordsForWindow>[number],
  window: {
    windowId: string;
    text: string;
    start: number;
    end: number;
    syllables: string[];
    meta?: { diffSpanId?: string; windowTrigger?: string; hypothesisRank?: number };
  },
  fromText: string
): WindowCandidate {
  const source =
    hit.recallPath === 'lexicon_pinyin_topk'
      ? 'lexicon_pinyin_topk'
      : hit.recallPath === 'fuzzy_observed'
        ? 'fuzzy_observed'
        : hit.recallPath === 'confusion_evidence'
          ? 'confusion_evidence'
          : hit.recallPath === 'exact'
            ? 'exact'
            : 'hotword';
  const termLength = hit.termLength ?? window.text.length;
  const candidateScore = hit.candidateScore ?? hit.priorScore + hit.phoneticScore;
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
    candidateScore,
    rankInTopK: hit.rankInTopK ?? 1,
    termLength,
    source,
    matchType: hit.matchType,
    windowPinyin: [...window.syllables],
    candidatePinyin: [...hit.hotword.pinyin],
    diffSpanId: window.meta?.diffSpanId,
    windowTrigger: window.meta?.windowTrigger,
    sourceHypothesisRank: window.meta?.hypothesisRank,
    candidateScoreBreakdown: hit.candidateScoreBreakdown,
  };
}

function mergeCountMaps(
  a: Record<string, number> | undefined,
  b: Record<string, number>
): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

function candidateKey(c: WindowCandidate): string {
  return [c.start, c.end, c.hotwordId, c.to].join('\0');
}

function mergeStats(target: WindowRecallDiagnostics, win: HotwordRecallStats): void {
  target.hitsObserved += win.hitsObserved;
  target.hitsPinyin += win.hitsPinyin;
  target.hitsConfusion += win.hitsConfusion;
  target.hitsFuzzyObserved += win.hitsFuzzyObserved;
  target.lexiconPinyinTopkCandidateCount =
    (target.lexiconPinyinTopkCandidateCount ?? 0) + win.hitsLexiconPinyinTopk;
  target.topkDroppedBelowMinScore =
    (target.topkDroppedBelowMinScore ?? 0) + win.topkDroppedBelowMinScore;
  target.outOfBundleCandidateCount =
    (target.outOfBundleCandidateCount ?? 0) + win.outOfBundleCandidateCount;
  target.topkAttemptsByTermLength = mergeCountMaps(
    target.topkAttemptsByTermLength,
    win.topkAttemptsByTermLength
  );
  target.topkHitsByTermLength = mergeCountMaps(target.topkHitsByTermLength, win.topkHitsByTermLength);
  target.droppedBelowPinyinThreshold += win.droppedBelowPinyinThreshold;
  target.fuzzyObservedAttemptCount =
    (target.fuzzyObservedAttemptCount ?? 0) + win.fuzzyObservedAttemptCount;
  target.fuzzyObservedHitCount = (target.fuzzyObservedHitCount ?? 0) + win.fuzzyObservedHitCount;
  target.fuzzyObservedRejectedCount =
    (target.fuzzyObservedRejectedCount ?? 0) + win.fuzzyObservedRejectedCount;
  target.pinyinAttemptCount = (target.pinyinAttemptCount ?? 0) + win.pinyinAttemptCount;
  target.pinyinHitCount = (target.pinyinHitCount ?? 0) + win.pinyinHitCount;
  target.pinyinNoHitCount = (target.pinyinNoHitCount ?? 0) + win.pinyinNoHitCount;
  target.nearPinyinAttemptCount =
    (target.nearPinyinAttemptCount ?? 0) + (win.nearPinyinAttemptCount ?? 0);
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
    if (out.length >= maxCandidates) {
      return true;
    }
    const before = out.length;
    const winStats = emptyHotwordRecallStats();
    const hits = recallHotwordsForWindow(window, runtime, undefined, winStats);
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
 * Segment-first window recall (V5: n-best diff → diff context dual-scale).
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

  let windows: AsrWindow[];
  let noDiffSpan = false;

  if (legacySlidingEnabled()) {
    const observedStrings = runtime.getConfusionObservedStrings();
    windows = buildLegacySegmentWindows(trimmed, hypotheses, observedStrings, diagnostics);
    diagnostics.windowsFromNbestDiffCount = 0;
    diagnostics.noDiffSpan = false;
  } else {
    const built = buildV5DiffWindows(trimmed, hypotheses, diagnostics);
    windows = built.windows;
    noDiffSpan = built.noDiffSpan;
    if (noDiffSpan) {
      diagnostics.windowsEnumerated = 0;
      diagnostics.windowCandidateCount = 0;
      diagnostics.noWindowBucket = 'no_diff_span';
      return {
        candidates: [],
        truncated: false,
        windowCount: 0,
        diagnostics,
        noDiffSpan: true,
      };
    }
  }

  diagnostics.windowsEnumerated = windows.length;

  const seen = new Set<string>();
  const out: WindowCandidate[] = [];
  const truncated = recallOnWindows(trimmed, windows, runtime, seen, out, maxCandidates, diagnostics);

  out.sort((a, b) => {
    const scoreA = a.candidateScore ?? 0;
    const scoreB = b.candidateScore ?? 0;
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    return (a.rankInTopK ?? 99) - (b.rankInTopK ?? 99);
  });

  const outOfBundle = out.filter((c) => c.source !== 'lexicon_pinyin_topk').length;
  diagnostics.outOfBundleCandidateCount = outOfBundle;
  diagnostics.lexiconPinyinTopkCandidateCount = out.filter(
    (c) => c.source === 'lexicon_pinyin_topk'
  ).length;

  diagnostics.windowCandidateCount = out.length;
  diagnostics.truncated = truncated;

  if (out.length === 0 && !noDiffSpan) {
    diagnostics.noWindowBucket = classifyNoWindowBucket({
      segmentTextLength: trimmed.length,
      diagnostics,
      confusionObservedCount: runtime.getConfusionObservedStrings().length,
    });
  }

  return {
    candidates: out,
    truncated,
    windowCount: windows.length,
    diagnostics,
    noDiffSpan: noDiffSpan || undefined,
  };
}
