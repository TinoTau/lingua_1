import { describe, expect, it } from '@jest/globals';
import { loadFwDetectorRuntimeConfig } from './fw-config';
import { detectSuspiciousSpansV1 } from './suspicious-span-detector-v1';
import { createSpanDetectorHint } from './span-detector-hint';

describe('P1.2c-fix detector layering', () => {
  const hintFn = createSpanDetectorHint();

  it('拿铁可触发 detector_pinyin_hint（不读 repair_target）', () => {
    const config = { ...loadFwDetectorRuntimeConfig(), maxSpans: 3 };
    const { spans } = detectSuspiciousSpansV1('拿铁', config, undefined, hintFn);
    const latte = spans.find((s) => s.text === '拿铁');
    expect(latte).toBeDefined();
    expect(latte?.signals.includes('detector_pinyin_hint')).toBe(true);
    expect(latte?.signals.includes('pinyin_proximity')).toBe(false);
    expect(latte?.detectorHint?.syllableCount).toBe(2);
  });

  it('餐厅 anchor 句中 kept span 可同时含 hint 与 domain_anchor_nearby', () => {
    const config = { ...loadFwDetectorRuntimeConfig(), maxSpans: 6 };
    const text = '麻烦帮我做一杯美食带走大背就行';
    const { spans } = detectSuspiciousSpansV1(text, config, undefined, hintFn);
    expect(
      spans.some(
        (s) =>
          s.signals.includes('detector_pinyin_hint') &&
          s.signals.includes('domain_anchor_nearby')
      )
    ).toBe(true);
  });

  it('detect budget 截断低优先级 span', () => {
    const config = { ...loadFwDetectorRuntimeConfig(), spanDetectBudget: 2 };
    const text = '蓝莓码份';
    const { spans, spanSelection } = detectSuspiciousSpansV1(text, config, undefined, hintFn);
    expect(spans.length).toBe(2);
    expect(spanSelection.dropped.some((d) => d.reason === 'maxSpans')).toBe(true);
  });

  it('输出 detectorHint 与 spanSelection.dropped，无 recallProbe', () => {
    const config = { ...loadFwDetectorRuntimeConfig(), maxSpans: 4 };
    const { spans, spanSelection } = detectSuspiciousSpansV1('一杯美食', config, undefined, hintFn);
    expect(spanSelection.enumeratedCount).toBeGreaterThan(0);
    expect(spanSelection.keptCount).toBe(spans.length);
    expect(spans[0]?.detectorHint?.syllables.length).toBeGreaterThan(0);
    expect(spans[0]).not.toHaveProperty('recallProbe');
  });
});
