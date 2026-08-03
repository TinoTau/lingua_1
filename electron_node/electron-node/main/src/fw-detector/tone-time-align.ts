import type { AcousticToneSlice, SegmentInfo, TonePosterior } from '../task-router/types';
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

export type TonePatternMappingMissReason =
  | 'no_word_timespan_for_slot'
  | 'no_slice_overlap_word_time'
  | 'empty_posterior'
  | 'invalid_posterior';

export type MapToneEvidenceResult = {
  pattern: number[] | null;
  windowTimeRange: WindowTimeRange | null;
  /** Set only when pattern is null after windowTimeRange was found (or slot-level fail). */
  missReason?: TonePatternMappingMissReason;
  /** WordTimeSpan selected at the failing syllable slot (for attribution). */
  failedWordSpan?: WordTimeSpan;
};

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

function selectRealSliceForWordSpan(
  slices: AcousticToneSlice[],
  span: WordTimeSpan
): AcousticToneSlice | null {
  const hits = slices
    .filter((slice) => slice.end > span.start && slice.start < span.end)
    .sort((a, b) => a.start - b.start);
  return hits[0] ?? null;
}

export function isInvalidTonePosterior(posterior: TonePosterior | null | undefined): boolean {
  if (!posterior) {
    return true;
  }
  const vals = [posterior.t1, posterior.t2, posterior.t3, posterior.t4, posterior.t5];
  return vals.some((v) => typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v));
}

export function isEmptyTonePosterior(posterior: TonePosterior | null | undefined): boolean {
  if (!posterior || isInvalidTonePosterior(posterior)) {
    return false;
  }
  const vals = [posterior.t1, posterior.t2, posterior.t3, posterior.t4, posterior.t5];
  return vals.every((v) => v === 0);
}

/**
 * Tone Participation Mapping (not Participation Fill).
 *
 * Tone Observation remains AcousticToneSlice posteriors only.
 * Mapping: Fine-Span syllable slot → covering FW WordTimeSpan → that word's real slice.
 * Pattern digits are argmax of real inference posteriors only — no invented/copied tensors.
 *
 * Deletes the old gate: overlapSlices.length !== (rawEnd-rawStart) → null.
 * missReason is additive observability only for null patterns.
 */
export function mapToneEvidenceForRecall(
  rawStart: number,
  rawEnd: number,
  syllableStart: number,
  syllableEnd: number,
  acousticSlices: AcousticToneSlice[],
  wordTimeSpans: WordTimeSpan[]
): MapToneEvidenceResult {
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

  const syllableCount = Math.max(0, Math.floor(syllableEnd) - Math.floor(syllableStart));
  const charLen = Math.max(0, Math.floor(rawEnd) - Math.floor(rawStart));
  if (syllableCount <= 0 || charLen <= 0 || !acousticSlices.length) {
    return {
      pattern: null,
      windowTimeRange,
      missReason: !acousticSlices.length
        ? 'no_slice_overlap_word_time'
        : 'no_word_timespan_for_slot',
    };
  }

  const pattern: number[] = [];
  for (let i = 0; i < syllableCount; i += 1) {
    const charOffset =
      syllableCount === charLen
        ? i
        : Math.min(charLen - 1, Math.floor((i * charLen) / syllableCount));
    const charStart = Math.floor(rawStart) + charOffset;
    const charEnd = charStart + 1;

    const covering = wordTimeSpans.filter(
      (span) => (span.rawEnd ?? 0) > charStart && (span.rawStart ?? 0) < charEnd
    );
    if (!covering.length) {
      return {
        pattern: null,
        windowTimeRange,
        missReason: 'no_word_timespan_for_slot',
      };
    }
    covering.sort(
      (a, b) =>
        (a.rawEnd ?? 0) -
        (a.rawStart ?? 0) -
        ((b.rawEnd ?? 0) - (b.rawStart ?? 0))
    );
    const span = covering[0];
    const slice = selectRealSliceForWordSpan(acousticSlices, span);
    if (!slice) {
      return {
        pattern: null,
        windowTimeRange,
        missReason: 'no_slice_overlap_word_time',
        failedWordSpan: span,
      };
    }
    if (isInvalidTonePosterior(slice.tonePosterior)) {
      return {
        pattern: null,
        windowTimeRange,
        missReason: 'invalid_posterior',
        failedWordSpan: span,
      };
    }
    if (isEmptyTonePosterior(slice.tonePosterior)) {
      return {
        pattern: null,
        windowTimeRange,
        missReason: 'empty_posterior',
        failedWordSpan: span,
      };
    }
    pattern.push(argmaxToneFromPosterior(slice.tonePosterior));
  }

  return { pattern, windowTimeRange };
}

/** @deprecated Prefer mapToneEvidenceForRecall — kept as alias for existing call sites/tests. */
export function extractAcousticTonePatternByTime(
  rawStart: number,
  rawEnd: number,
  syllableStart: number,
  syllableEnd: number,
  acousticSlices: AcousticToneSlice[],
  wordTimeSpans: WordTimeSpan[]
): MapToneEvidenceResult {
  return mapToneEvidenceForRecall(
    rawStart,
    rawEnd,
    syllableStart,
    syllableEnd,
    acousticSlices,
    wordTimeSpans
  );
}
