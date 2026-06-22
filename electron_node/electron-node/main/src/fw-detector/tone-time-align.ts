import type { AcousticToneSlice, SegmentInfo } from '../task-router/types';
import { argmaxToneFromPosterior } from './tone-match-score';

export type { AcousticToneSlice };

export interface WordTimeSpan {
  word?: string;
  rawStart?: number;
  rawEnd?: number;
  start: number;
  end: number;
  segmentIndex?: number;
  probability?: number;
}

export interface WindowTimeRange {
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  start: number;
  end: number;
}

export function normalizeAcousticSlices(
  slices: AcousticToneSlice[] | undefined | null
): AcousticToneSlice[] {
  if (!slices?.length) {
    return [];
  }
  return slices.map((slice) => ({
    start: slice.start,
    end: slice.end,
    tonePosterior: slice.tonePosterior,
    confidence: slice.confidence,
  }));
}

export function offsetAcousticSlices(
  slices: AcousticToneSlice[],
  offsetSec: number
): AcousticToneSlice[] {
  if (!offsetSec) {
    return slices;
  }
  return slices.map((slice) => ({
    ...slice,
    start: slice.start + offsetSec,
    end: slice.end + offsetSec,
  }));
}

export function buildWordTimeSpans(
  rawText: string,
  asrSegments: SegmentInfo[],
  segmentTimeOffsetsSec: readonly number[],
  segmentCharOffsets: readonly number[],
  asrSegmentNodeBatchIndices: readonly number[]
): WordTimeSpan[] {
  const spans: WordTimeSpan[] = [];
  let searchFrom = 0;

  for (let segIdx = 0; segIdx < asrSegments.length; segIdx += 1) {
    const segment = asrSegments[segIdx];
    const batchIdx = asrSegmentNodeBatchIndices[segIdx] ?? 0;
    const timeOffset = segmentTimeOffsetsSec[batchIdx] ?? 0;

    if (segIdx > 0 && asrSegmentNodeBatchIndices[segIdx] !== asrSegmentNodeBatchIndices[segIdx - 1]) {
      searchFrom = segmentCharOffsets[batchIdx] ?? searchFrom;
    }

    for (const word of segment.words ?? []) {
      const token = word.word?.trim();
      if (!token || word.start == null || word.end == null) {
        continue;
      }
      const idx = rawText.indexOf(token, searchFrom);
      if (idx < 0) {
        continue;
      }
      searchFrom = idx + token.length;
      spans.push({
        word: token,
        rawStart: idx,
        rawEnd: idx + token.length,
        start: word.start + timeOffset,
        end: word.end + timeOffset,
        segmentIndex: batchIdx,
        probability: word.probability,
      });
    }
  }

  return spans;
}

export function charRangeToWindowTime(
  rawStart: number,
  rawEnd: number,
  syllableStart: number,
  syllableEnd: number,
  wordTimeSpans: WordTimeSpan[]
): WindowTimeRange | null {
  const covering = wordTimeSpans.filter(
    (span) => (span.rawEnd ?? 0) > rawStart && (span.rawStart ?? 0) < rawEnd
  );
  if (!covering.length) {
    return null;
  }
  return {
    rawStart,
    rawEnd,
    syllableStart,
    syllableEnd,
    start: covering[0].start,
    end: covering[covering.length - 1].end,
  };
}

export function selectSlicesByTimeOverlap(
  slices: AcousticToneSlice[],
  window: WindowTimeRange
): AcousticToneSlice[] {
  return slices
    .filter((slice) => slice.end > window.start && slice.start < window.end)
    .sort((a, b) => a.start - b.start);
}

export function extractAcousticTonePatternByTime(
  rawStart: number,
  rawEnd: number,
  syllableStart: number,
  syllableEnd: number,
  acousticSlices: AcousticToneSlice[],
  wordTimeSpans: WordTimeSpan[]
): { pattern: number[] | null; windowTimeRange: WindowTimeRange | null } {
  const syllableCount = rawEnd - rawStart;
  const windowTimeRange = charRangeToWindowTime(
    rawStart,
    rawEnd,
    syllableStart,
    syllableEnd,
    wordTimeSpans
  );
  if (!windowTimeRange) {
    return { pattern: null, windowTimeRange: null };
  }

  const overlapSlices = selectSlicesByTimeOverlap(acousticSlices, windowTimeRange);
  if (overlapSlices.length !== syllableCount) {
    return { pattern: null, windowTimeRange };
  }

  const pattern = overlapSlices.map((slice) => argmaxToneFromPosterior(slice.tonePosterior));
  return { pattern, windowTimeRange };
}
