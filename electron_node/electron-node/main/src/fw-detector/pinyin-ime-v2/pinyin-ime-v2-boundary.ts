import type { PinyinImeV2DiffSpan, PinyinImeV2InstabilityRegion } from './pinyin-ime-v2-types';
import { buildCharSyllableRanges, snapSpanToSyllableBoundaries } from './pinyin-ime-v2-pinyin-stream';

export function applyBoundaryDiscovery(
  rawAsrText: string,
  diffSpans: PinyinImeV2DiffSpan[],
  instabilityRegions: PinyinImeV2InstabilityRegion[]
): {
  diffSpans: PinyinImeV2DiffSpan[];
  instabilityRegions: PinyinImeV2InstabilityRegion[];
  boundaryAdjustedCount: number;
} {
  const ranges = buildCharSyllableRanges(rawAsrText);
  let boundaryAdjustedCount = 0;

  const adjustSpan = <T extends { start: number; end: number; rawSpan: string }>(span: T): T => {
    const snapped = snapSpanToSyllableBoundaries(rawAsrText, span.start, span.end, ranges);
    if (snapped.start !== span.start || snapped.end !== span.end) {
      boundaryAdjustedCount++;
    }
    const rawSpan = rawAsrText.slice(snapped.start, snapped.end);
    return { ...span, start: snapped.start, end: snapped.end, rawSpan };
  };

  return {
    diffSpans: diffSpans.map(adjustSpan),
    instabilityRegions: instabilityRegions.map(adjustSpan),
    boundaryAdjustedCount,
  };
}
