import { describe, expect, it } from '@jest/globals';
import { mapSelectedSpanToFwSpan } from './map-selected-span-to-fw';

describe('mapSelectedSpanToFwSpan', () => {
  it('maps to FwSpanDiagnostics with ime_v2_diff_hint', () => {
    const fw = mapSelectedSpanToFwSpan({
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
    const fw = mapSelectedSpanToFwSpan({
      rawSpan: '钟贝',
      start: 5,
      end: 7,
      confidence: 0.8,
      reason: 'ime_v2_boundary_topk_diff',
    });
    expect(fw.signals).toEqual(['ime_v2_boundary_topk_diff_hint']);
  });

  it('maps instability reason to ime_v2_instability_hint', () => {
    const fw = mapSelectedSpanToFwSpan({
      rawSpan: '钟贝',
      start: 5,
      end: 7,
      confidence: 0.8,
      reason: 'ime_v2_instability',
    });
    expect(fw.signals).toEqual(['ime_v2_instability_hint']);
  });
});
