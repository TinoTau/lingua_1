import { describe, expect, it } from '@jest/globals';
import { DEFAULT_PINYIN_IME_V2 } from './pinyin-ime-v2-config';
import { selectPinyinImeV2Spans } from './pinyin-ime-v2-span-selector';

describe('selectPinyinImeV2Spans', () => {
  const config = { ...DEFAULT_PINYIN_IME_V2 };

  it('selects span without neighbor veto when under cap', () => {
    const result = selectPinyinImeV2Spans({
      rawAsrText: '麻烦来一杯钟贝咖啡',
      diffSpans: [{ rawSpan: '钟贝', start: 5, end: 7, candidateRank: 1, supportCount: 2 }],
      instabilityRegions: [],
      boundaryCompatibleTopKSpans: [],
      config,
      lexiconNearNeighbor: () => false,
    });
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].rawSpan).toBe('钟贝');
    expect(result.diagnostics.selectionMode).toBe('all_passed');
    expect(result.diagnostics.neighborMissCount).toBe(1);
    expect(result.diagnostics.selectedSpanCount).toBe(1);
  });

  it('selects span with low support when under cap', () => {
    const result = selectPinyinImeV2Spans({
      rawAsrText: '麻烦来一杯钟贝咖啡',
      diffSpans: [{ rawSpan: '钟贝', start: 6, end: 8, candidateRank: 1, supportCount: 1 }],
      instabilityRegions: [],
      boundaryCompatibleTopKSpans: [],
      config,
      lexiconNearNeighbor: () => true,
    });
    expect(result.selected).toHaveLength(1);
    expect(result.diagnostics.neighborHitCount).toBe(1);
  });

  it('selects boundary-compatible topk diff span', () => {
    const result = selectPinyinImeV2Spans({
      rawAsrText: '麻烦来一杯钟贝咖啡',
      diffSpans: [],
      instabilityRegions: [],
      boundaryCompatibleTopKSpans: [
        {
          rawSpan: '钟贝',
          start: 5,
          end: 7,
          syllableStart: 0,
          syllableEnd: 2,
          supportCount: 2,
          confidence: 0.8,
          variants: ['钟贝', '中杯'],
          contributingRanks: [1, 2],
        },
      ],
      config,
      lexiconNearNeighbor: () => true,
    });
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].reason).toBe('ime_v2_boundary_topk_diff');
  });

  it('caps spans when normalized count exceeds maxApprovedSpans', () => {
    const rawAsrText = '麻烦来一杯钟贝咖啡！大家欢聚一堂！风景十分秀丽！心情格外舒畅！';
    const result = selectPinyinImeV2Spans({
      rawAsrText,
      diffSpans: [
        { rawSpan: '钟贝', start: 5, end: 7, candidateRank: 1, supportCount: 2 },
        { rawSpan: '大家', start: 10, end: 12, candidateRank: 1, supportCount: 2 },
        { rawSpan: '风景', start: 17, end: 19, candidateRank: 1, supportCount: 2 },
        { rawSpan: '秀丽', start: 21, end: 23, candidateRank: 1, supportCount: 2 },
        { rawSpan: '舒畅', start: 28, end: 30, candidateRank: 1, supportCount: 2 },
      ],
      instabilityRegions: [],
      boundaryCompatibleTopKSpans: [],
      config: { ...config, maxApprovedSpans: 4 },
      lexiconNearNeighbor: (raw) => raw === '舒畅',
    });
    expect(result.selected).toHaveLength(4);
    expect(result.diagnostics.selectionMode).toBe('ranked_capped');
    expect(result.diagnostics.cappedByMaxSpansCount).toBe(1);
    expect(result.selected.some((s) => s.rawSpan === '舒畅')).toBe(true);
  });

  it('returns empty_after_normalizer when all spans dropped', () => {
    const result = selectPinyinImeV2Spans({
      rawAsrText: '麻烦来一杯钟贝咖啡',
      diffSpans: [{ rawSpan: '钟', start: 5, end: 6, candidateRank: 1, supportCount: 2 }],
      instabilityRegions: [],
      boundaryCompatibleTopKSpans: [],
      config,
      lexiconNearNeighbor: () => true,
    });
    expect(result.selected).toHaveLength(0);
    expect(result.diagnostics.selectionMode).toBe('empty_after_normalizer');
  });
});
