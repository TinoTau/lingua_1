import { describe, expect, it } from '@jest/globals';
import { buildInstabilityRegions } from './pinyin-ime-v2-instability';
import type { PinyinImeV2DiffSpan } from './pinyin-ime-v2-types';

describe('buildInstabilityRegions', () => {
  it('merges overlapping spans and counts support from distinct ranks', () => {
    const diffSpans: PinyinImeV2DiffSpan[] = [
      { rawSpan: '钟', start: 0, end: 1, candidateRank: 1, supportCount: 1 },
      { rawSpan: '钟贝', start: 0, end: 2, candidateRank: 2, supportCount: 1 },
      { rawSpan: '贝', start: 1, end: 2, candidateRank: 3, supportCount: 1 },
    ];
    const regions = buildInstabilityRegions(diffSpans);
    expect(regions.length).toBe(1);
    expect(regions[0].supportCount).toBe(3);
    expect(regions[0].start).toBe(0);
    expect(regions[0].end).toBe(2);
  });
});
