import { textToSyllables } from '../../lexicon/phonetic/pinyin';
import type { BoundaryCompatibleTopKSpan } from './pinyin-ime-v2-boundary-compatible-topk-diff';
import type {
  PinyinImeV2DiffSpan,
  PinyinImeV2InstabilityRegion,
  PinyinImeV2RuntimeConfig,
} from './pinyin-ime-v2-types';

export type NormalizedSpan = {
  rawSpan: string;
  start: number;
  end: number;
  supportCount: number;
  fromInstability: boolean;
  fromBoundaryTopKDiff: boolean;
};

export type NormalizerDropReason = 'single_char' | 'syllable_out_of_range' | 'too_long';

export type NormalizerResult = {
  spans: NormalizedSpan[];
  dropped: Array<{ span: NormalizedSpan; reason: NormalizerDropReason }>;
};

type RawInterval = {
  start: number;
  end: number;
  rawSpan: string;
  supportCount: number;
  fromInstability: boolean;
  fromBoundaryTopKDiff: boolean;
};

function toIntervals(
  diffSpans: PinyinImeV2DiffSpan[],
  instabilityRegions: PinyinImeV2InstabilityRegion[],
  boundaryTopKSpans: BoundaryCompatibleTopKSpan[]
): RawInterval[] {
  const intervals: RawInterval[] = [];

  for (const span of diffSpans) {
    intervals.push({
      start: span.start,
      end: span.end,
      rawSpan: span.rawSpan,
      supportCount: span.supportCount,
      fromInstability: false,
      fromBoundaryTopKDiff: false,
    });
  }

  for (const region of instabilityRegions) {
    intervals.push({
      start: region.start,
      end: region.end,
      rawSpan: region.rawSpan,
      supportCount: region.supportCount,
      fromInstability: true,
      fromBoundaryTopKDiff: false,
    });
  }

  for (const span of boundaryTopKSpans) {
    intervals.push({
      start: span.start,
      end: span.end,
      rawSpan: span.rawSpan,
      supportCount: span.supportCount,
      fromInstability: false,
      fromBoundaryTopKDiff: true,
    });
  }

  return intervals;
}

function mergeAdjacent(intervals: RawInterval[]): RawInterval[] {
  if (!intervals.length) {
    return [];
  }
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: RawInterval[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    const adjacent = current.start <= last.end + 1;
    const overlapping = current.start <= last.end;
    if (overlapping || adjacent) {
      last.end = Math.max(last.end, current.end);
      last.supportCount = Math.max(last.supportCount, current.supportCount);
      last.fromInstability = last.fromInstability || current.fromInstability;
      last.fromBoundaryTopKDiff = last.fromBoundaryTopKDiff || current.fromBoundaryTopKDiff;
      last.rawSpan = last.rawSpan.length >= current.rawSpan.length ? last.rawSpan : current.rawSpan;
    } else {
      merged.push(current);
    }
  }

  return merged;
}

function passesSyllableGate(
  rawSpan: string,
  config: Pick<PinyinImeV2RuntimeConfig, 'minSyllables' | 'maxSyllables'>
): boolean {
  const syllables = textToSyllables(rawSpan.trim());
  return syllables.length >= config.minSyllables && syllables.length <= config.maxSyllables;
}

/**
 * Mandatory normalizer: merge diff + instability spans, enforce char/syllable gates.
 * Output spans are Recall-ready (syllableCount ∈ [2,5] by default).
 */
export function normalizePinyinImeV2Spans(
  rawAsrText: string,
  diffSpans: PinyinImeV2DiffSpan[],
  instabilityRegions: PinyinImeV2InstabilityRegion[],
  boundaryCompatibleTopKSpans: BoundaryCompatibleTopKSpan[],
  config: Pick<
    PinyinImeV2RuntimeConfig,
    'minSpanChars' | 'maxSpanChars' | 'minSyllables' | 'maxSyllables'
  >
): NormalizerResult {
  const merged = mergeAdjacent(
    toIntervals(diffSpans, instabilityRegions, boundaryCompatibleTopKSpans)
  );
  const spans: NormalizedSpan[] = [];
  const dropped: NormalizerResult['dropped'] = [];

  for (const interval of merged) {
    const rawSpan = rawAsrText.slice(interval.start, interval.end);
    const span: NormalizedSpan = {
      rawSpan,
      start: interval.start,
      end: interval.end,
      supportCount: interval.supportCount,
      fromInstability: interval.fromInstability,
      fromBoundaryTopKDiff: interval.fromBoundaryTopKDiff,
    };

    const charLen = rawSpan.length;
    if (charLen < config.minSpanChars) {
      dropped.push({ span, reason: 'single_char' });
      continue;
    }
    if (charLen > config.maxSpanChars) {
      dropped.push({ span, reason: 'too_long' });
      continue;
    }
    if (!passesSyllableGate(rawSpan, config)) {
      dropped.push({ span, reason: 'syllable_out_of_range' });
      continue;
    }

    spans.push(span);
  }

  return { spans, dropped };
}
