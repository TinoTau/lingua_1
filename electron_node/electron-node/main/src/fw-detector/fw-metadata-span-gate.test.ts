import { describe, expect, it } from '@jest/globals';
import { selectFwMetadataSpans } from './fw-metadata-span-gate';
import type { FwMetadataSpanGateRuntimeConfig } from './fw-config';

const baseConfig: FwMetadataSpanGateRuntimeConfig = {
  enabled: true,
  maxSpans: 2,
  minSpanChars: 2,
  maxSpanChars: 4,
  wordProbabilityThreshold: 0.65,
  segmentAvgLogprobThreshold: -1.0,
  allowAliasExactHit: true,
  allowSegmentFallbackScan: false,
  fallbackLegacyMaxSpans: 1,
};

describe('selectFwMetadataSpans', () => {
  it('returns alias_exact_hit span', () => {
    const result = selectFwMetadataSpans({
      text: '麻烦来一杯钟贝咖啡',
      aliasKeys: ['钟贝'],
      config: baseConfig,
    });
    expect(result.spans.length).toBe(1);
    expect(result.spans[0].signals).toContain('alias_exact_hit');
    expect(result.diagnostics.aliasHitCount).toBe(1);
  });

  it('returns low_word_probability span from metadata', () => {
    const result = selectFwMetadataSpans({
      text: '我要中杯',
      aliasKeys: [],
      config: baseConfig,
      segments: [
        {
          text: '我要中杯',
          words: [
            { word: '我要', probability: 0.9 },
            { word: '中杯', probability: 0.4 },
          ],
        },
      ],
    });
    expect(result.spans.some((s) => s.signals.includes('low_word_probability'))).toBe(true);
    expect(result.diagnostics.lowConfidenceWordCount).toBe(1);
  });

  it('skips when disabled', () => {
    const result = selectFwMetadataSpans({
      text: '钟贝',
      aliasKeys: ['钟贝'],
      config: { ...baseConfig, enabled: false },
    });
    expect(result.spans).toEqual([]);
    expect(result.diagnostics.skippedReason).toBe('disabled');
  });

  it('respects maxSpans=2', () => {
    const result = selectFwMetadataSpans({
      text: '钟贝中杯',
      aliasKeys: ['钟贝', '中杯'],
      config: baseConfig,
    });
    expect(result.spans.length).toBeLessThanOrEqual(2);
  });

  it('does not emit detector_pinyin_hint', () => {
    const result = selectFwMetadataSpans({
      text: '钟贝',
      aliasKeys: ['钟贝'],
      config: baseConfig,
    });
    for (const span of result.spans) {
      expect(span.signals).not.toContain('detector_pinyin_hint');
    }
  });

  it('returns all_signals_normal when nothing matches', () => {
    const result = selectFwMetadataSpans({
      text: '你好世界',
      aliasKeys: [],
      config: baseConfig,
      segments: [{ text: '你好世界', words: [{ word: '你好', probability: 0.99 }] }],
    });
    expect(result.spans).toEqual([]);
    expect(result.diagnostics.skippedReason).toBe('all_signals_normal');
  });
});
