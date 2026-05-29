import { describe, expect, it } from '@jest/globals';
import { loadFwDetectorRuntimeConfig } from './fw-config';
import { detectSuspiciousSpansV1 } from './suspicious-span-detector-v1';
import { createSpanDetectorHint } from './span-detector-hint';

describe('detectSuspiciousSpansV1', () => {
  it('领域锚点附近产出可疑 span', () => {
    const config = loadFwDetectorRuntimeConfig();
    const text = '我想买一块英伟达显卡做推理';
    const { spans } = detectSuspiciousSpansV1(text, config);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.some((s) => s.signals.includes('domain_anchor_nearby'))).toBe(true);
  });

  it('空文本返回空', () => {
    const config = loadFwDetectorRuntimeConfig();
    const result = detectSuspiciousSpansV1('', config);
    expect(result.spans).toEqual([]);
    expect(result.spanSelection).toEqual({ enumeratedCount: 0, keptCount: 0, dropped: [] });
  });

  it('餐厅锚点附近产出可疑 span', () => {
    const config = loadFwDetectorRuntimeConfig();
    const text = '麻烦帮我做一杯美食带走大背就行';
    const { spans } = detectSuspiciousSpansV1(text, config);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.some((s) => s.signals.includes('domain_anchor_nearby'))).toBe(true);
  });

  it('detector hint 可单独触发 detector_pinyin_hint', () => {
    const config = { ...loadFwDetectorRuntimeConfig(), maxSpans: 6 };
    const hintFn = createSpanDetectorHint();
    const { spans } = detectSuspiciousSpansV1('麻烦帮我做一杯美食带走', config, undefined, hintFn);
    expect(spans.some((s) => s.signals.includes('detector_pinyin_hint'))).toBe(true);
  });
});
