import { describe, expect, it } from '@jest/globals';
import type { KenLMScorer } from './kenlm-batch-types';
import {
  enumerateCjkWindows,
  mapKenlmGateSpanToFwSpan,
  selectKenlmSuspiciousSpans,
} from './kenlm-span-selector';

function mockScorer(deltas: number[]): KenLMScorer {
  return {
    scoreBatch: async (sentences) => ({
      scores: sentences.map((sentence, i) => ({
        sentence,
        score: i === 0 ? 0 : deltas[i - 1] ?? 0,
        normalizedScore: i === 0 ? 0.5 : 0.5 + (deltas[i - 1] ?? 0),
      })),
      timing: {
        batchMs: 1,
        queryCount: sentences.length,
        avgMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        maxMs: 0,
      },
    }),
  };
}

describe('enumerateCjkWindows', () => {
  it('enumerates 2~4 char windows inside CJK runs', () => {
    const windows = enumerateCjkWindows('我要一杯', 2, 4);
    expect(windows.some((w) => w.text === '一杯')).toBe(true);
    expect(windows.every((w) => w.text.length >= 2 && w.text.length <= 4)).toBe(true);
  });
});

describe('selectKenlmSuspiciousSpans', () => {
  it('maxSpans=2 keeps at most two non-overlapping spans', async () => {
    const text = '钟贝拿铁';
    const windows = enumerateCjkWindows(text, 2, 4);
    const deltas = windows.map((w) => (w.text === '钟贝' ? 0.2 : 0));
    const result = await selectKenlmSuspiciousSpans(mockScorer(deltas), {
      text,
      maxSpans: 2,
      minSpanChars: 2,
      maxSpanChars: 4,
      minLocalDelta: 0.05,
      stopwordFilterEnabled: false,
      preFilterMaxWindows: 20,
    });
    expect(result.spans.length).toBeLessThanOrEqual(2);
    expect(result.spans.some((s) => s.text === '钟贝')).toBe(true);
  });

  it('filters stopwords when enabled', async () => {
    const text = '可以一下';
    const windows = enumerateCjkWindows(text, 2, 4);
    const deltas = windows.map(() => 0.3);
    const result = await selectKenlmSuspiciousSpans(mockScorer(deltas), {
      text,
      maxSpans: 2,
      minSpanChars: 2,
      maxSpanChars: 4,
      minLocalDelta: 0.05,
      stopwordFilterEnabled: true,
      preFilterMaxWindows: 20,
    });
    expect(result.spans.every((s) => s.text !== '可以' && s.text !== '一下')).toBe(true);
  });

  it('returns no spans when KenLM unavailable', async () => {
    const result = await selectKenlmSuspiciousSpans(null, {
      text: '测试文本',
      maxSpans: 2,
      minSpanChars: 2,
      maxSpanChars: 4,
      minLocalDelta: 0.05,
      stopwordFilterEnabled: true,
      preFilterMaxWindows: 20,
    });
    expect(result.spans).toEqual([]);
    expect(result.diagnostics.skippedReason).toBe('kenlm_unavailable');
  });

  it('returns no spans when no window meets minLocalDelta', async () => {
    const text = '正常句子';
    const windows = enumerateCjkWindows(text, 2, 4);
    const result = await selectKenlmSuspiciousSpans(mockScorer(windows.map(() => 0)), {
      text,
      maxSpans: 2,
      minSpanChars: 2,
      maxSpanChars: 4,
      minLocalDelta: 0.5,
      stopwordFilterEnabled: false,
      preFilterMaxWindows: 20,
    });
    expect(result.spans).toEqual([]);
    expect(result.diagnostics.skippedReason).toBe('no_low_prob_span');
  });

  it('maps to FwSpanDiagnostics without source field', () => {
    const mapped = mapKenlmGateSpanToFwSpan({
      text: '钟贝',
      start: 0,
      end: 2,
      score: 0.2,
      delta: 0.2,
      reason: 'kenlm_local_low_prob',
    });
    expect(mapped.domain).toBe('general');
    expect(mapped.candidates).toEqual([]);
    expect(mapped.applied).toBe(false);
    expect(mapped.signals).toEqual(['kenlm_local_low_prob']);
    expect(mapped).not.toHaveProperty('source');
  });
});
