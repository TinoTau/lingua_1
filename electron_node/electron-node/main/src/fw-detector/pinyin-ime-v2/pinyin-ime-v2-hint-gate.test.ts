import { describe, expect, it } from '@jest/globals';
import { mapApprovedSpanToFwSpan } from './map-approved-span-to-fw';
import { runPinyinImeV2HintGate } from './pinyin-ime-v2-hint-gate';
import { DEFAULT_PINYIN_IME_V2 } from './pinyin-ime-v2-config';

describe('mapApprovedSpanToFwSpan', () => {
  it('maps to FwSpanDiagnostics with ime_v2_diff_hint', () => {
    const fw = mapApprovedSpanToFwSpan({
      rawSpan: '钟贝',
      start: 5,
      end: 7,
      confidence: 0.8,
      reason: 'ime_v2_diff',
    });
    expect(fw.text).toBe('钟贝');
    expect(fw.signals).toEqual(['ime_v2_diff_hint']);
    expect(fw.candidates).toEqual([]);
    expect(fw.applied).toBe(false);
  });

  it('maps boundary topk diff reason to ime_v2_boundary_topk_diff_hint', () => {
    const fw = mapApprovedSpanToFwSpan({
      rawSpan: '钟贝',
      start: 5,
      end: 7,
      confidence: 0.8,
      reason: 'ime_v2_boundary_topk_diff',
    });
    expect(fw.signals).toEqual(['ime_v2_boundary_topk_diff_hint']);
  });

  it('maps instability reason to ime_v2_instability_hint', () => {
    const fw = mapApprovedSpanToFwSpan({
      rawSpan: '钟贝',
      start: 5,
      end: 7,
      confidence: 0.8,
      reason: 'ime_v2_instability',
    });
    expect(fw.signals).toEqual(['ime_v2_instability_hint']);
  });
});

describe('runPinyinImeV2HintGate', () => {
  const config = { ...DEFAULT_PINYIN_IME_V2 };

  it('approves span with supportCount >= 2 and lexicon neighbor', () => {
    const result = runPinyinImeV2HintGate({
      rawAsrText: '麻烦来一杯钟贝咖啡',
      diffSpans: [{ rawSpan: '钟贝', start: 5, end: 7, candidateRank: 1, supportCount: 2 }],
      instabilityRegions: [],
      boundaryCompatibleTopKSpans: [],
      config,
      lexiconNearNeighbor: () => true,
    });
    expect(result.approved).toHaveLength(1);
    expect(result.approved[0].rawSpan).toBe('钟贝');
    expect(result.diagnostics.approvedSpanCount).toBe(1);
  });

  it('rejects span without lexicon neighbor', () => {
    const result = runPinyinImeV2HintGate({
      rawAsrText: '麻烦来一杯钟贝咖啡',
      diffSpans: [{ rawSpan: '钟贝', start: 5, end: 7, candidateRank: 1, supportCount: 2 }],
      instabilityRegions: [],
      boundaryCompatibleTopKSpans: [],
      config,
      lexiconNearNeighbor: () => false,
    });
    expect(result.approved).toHaveLength(0);
    expect(result.diagnostics.gateDroppedNoNeighbor).toBe(1);
  });

  it('rejects span with supportCount < minSupportCount', () => {
    const result = runPinyinImeV2HintGate({
      rawAsrText: '麻烦来一杯钟贝咖啡',
      diffSpans: [{ rawSpan: '钟贝', start: 6, end: 8, candidateRank: 1, supportCount: 1 }],
      instabilityRegions: [],
      boundaryCompatibleTopKSpans: [],
      config,
      lexiconNearNeighbor: () => true,
    });
    expect(result.approved).toHaveLength(0);
    expect(result.diagnostics.gateDroppedSupport).toBe(1);
  });

  it('approves boundary-compatible topk diff span with ime_v2_boundary_topk_diff reason', () => {
    const result = runPinyinImeV2HintGate({
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
    expect(result.approved).toHaveLength(1);
    expect(result.approved[0].reason).toBe('ime_v2_boundary_topk_diff');
  });
});
