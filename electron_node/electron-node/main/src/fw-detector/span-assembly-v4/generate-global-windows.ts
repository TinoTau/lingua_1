import { buildCharSyllableRanges } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import { syllableRangeToRawCharRange } from '../pinyin-ime-v2/pinyin-ime-v2-boundary-compatible-topk-diff';
import type { CoarseSpan } from '../span-assembly-shared/types';
import {
  collectDistinctCoarseSpanIds,
  resolveAnchorCoarseSpanId,
} from './collect-distinct-coarse-span-ids';
import { V4_LIMITS } from './v4-limits';
import type { GlobalWindowDescriptor } from './v4-types';

function syllablesKey(syllables: string[]): string {
  return syllables.join('|');
}

function resolveWindowSource(boundaryCrossCount: number): GlobalWindowDescriptor['windowSource'] {
  if (boundaryCrossCount > V4_LIMITS.maxBoundaryCrossCount) {
    return 'blocked';
  }
  if (boundaryCrossCount === 1) {
    return 'boundary_window';
  }
  return 'in_span_window';
}

export function generateGlobalWindows(input: {
  rawText: string;
  globalSyllables: string[];
  coarseSpans: CoarseSpan[];
}): GlobalWindowDescriptor[] {
  const { rawText, globalSyllables, coarseSpans } = input;
  const ranges = buildCharSyllableRanges(rawText);
  const windows: GlobalWindowDescriptor[] = [];

  for (
    let len = V4_LIMITS.windowMinSyllables;
    len <= Math.min(V4_LIMITS.windowMaxSyllables, globalSyllables.length);
    len += 1
  ) {
    for (let i = 0; i <= globalSyllables.length - len; i += 1) {
      const syllableEnd = i + len;
      const spanIds = collectDistinctCoarseSpanIds(i, syllableEnd, coarseSpans);
      if (!spanIds.length) {
        continue;
      }
      const boundaryCrossCount = spanIds.length - 1;
      const charRange = syllableRangeToRawCharRange(ranges, i, syllableEnd);
      if (!charRange) {
        continue;
      }
      const syllables = globalSyllables.slice(i, syllableEnd);
      windows.push({
        windowId: `${i}:${syllableEnd}`,
        syllableStart: i,
        syllableEnd,
        rawStart: charRange.start,
        rawEnd: charRange.end,
        windowText: rawText.slice(charRange.start, charRange.end),
        windowPinyinKey: syllablesKey(syllables),
        spanIds,
        boundaryCrossCount,
        windowSource: resolveWindowSource(boundaryCrossCount),
        anchorCoarseSpanId: resolveAnchorCoarseSpanId(spanIds, coarseSpans),
        blocked: boundaryCrossCount > V4_LIMITS.maxBoundaryCrossCount,
        blockedBoundaryReason:
          boundaryCrossCount > V4_LIMITS.maxBoundaryCrossCount
            ? 'boundary_cross_count'
            : undefined,
      });
    }
  }

  return windows;
}
