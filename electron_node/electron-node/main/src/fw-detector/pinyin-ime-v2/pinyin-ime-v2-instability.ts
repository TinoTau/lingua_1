import type { PinyinImeV2DiffSpan, PinyinImeV2InstabilityRegion } from './pinyin-ime-v2-types';

type Interval = {
  start: number;
  end: number;
  rawSpan: string;
  ranks: Set<number>;
  variants: Set<string>;
};

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (!intervals.length) {
    return [];
  }
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
      last.rawSpan = last.rawSpan.length >= current.rawSpan.length ? last.rawSpan : current.rawSpan;
      for (const rank of current.ranks) {
        last.ranks.add(rank);
      }
      for (const variant of current.variants) {
        last.variants.add(variant);
      }
    } else {
      merged.push(current);
    }
  }

  return merged;
}

/**
 * Build instability regions from TopK union diff spans.
 * supportCount = distinct candidate ranks contributing to the merged interval.
 */
export function buildInstabilityRegions(diffSpans: PinyinImeV2DiffSpan[]): PinyinImeV2InstabilityRegion[] {
  const intervals: Interval[] = diffSpans.map((span) => ({
    start: span.start,
    end: span.end,
    rawSpan: span.rawSpan,
    ranks: new Set([span.candidateRank]),
    variants: new Set([span.rawSpan]),
  }));

  const merged = mergeIntervals(intervals);

  return merged.map((interval) => ({
    rawSpan: interval.rawSpan,
    start: interval.start,
    end: interval.end,
    variants: [...interval.variants],
    supportCount: interval.ranks.size,
  }));
}

/**
 * Recompute supportCount on diff spans after union merge (for HintGate input).
 */
export function aggregateDiffSpanSupport(diffSpans: PinyinImeV2DiffSpan[]): PinyinImeV2DiffSpan[] {
  const regions = buildInstabilityRegions(diffSpans);
  const out: PinyinImeV2DiffSpan[] = [];

  for (const span of diffSpans) {
    const region = regions.find(
      (r) => span.start >= r.start && span.end <= r.end && r.supportCount > 0
    );
    out.push({
      ...span,
      supportCount: region?.supportCount ?? span.supportCount,
    });
  }

  return out;
}
