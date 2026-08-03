import { buildCharSyllableRanges } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import type { CoarseSpan } from '../span-assembly-shared/types';
import { V4_LIMITS } from './v4-limits';
import type { GlobalWindowDescriptor } from './v4-types';
import { buildWindowDescriptorForRange } from './window-construction-core';

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
      const window = buildWindowDescriptorForRange({
        syllableStart: i,
        syllableEnd: i + len,
        rawText,
        globalSyllables,
        coarseSpans,
        charSyllableRanges: ranges,
        allowEmptyCoarseRefs: false,
        hardBlockOnBoundaryCross: true,
      });
      if (window) {
        windows.push(window);
      }
    }
  }

  return windows;
}
