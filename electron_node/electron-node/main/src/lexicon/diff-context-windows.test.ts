import { describe, expect, it } from '@jest/globals';
import { buildDiffContextWindows, expandDiffSpanContext } from './diff-context-windows';
import type { NbestDiffSpan } from './nbest-diff-span';

describe('diff-context-windows', () => {
  const span: NbestDiffSpan = {
    hypothesisRank: 1,
    diffSpanId: 'd1-4-6-x',
    top1Start: 4,
    top1End: 6,
    top1Text: '生城',
    altText: '声城',
    diffType: 'substitution',
  };

  it('expandDiffSpanContext clamps to chunk', () => {
    const segment = '我们要做后选生城';
    const chunk = { text: '我们要做后选生城', start: 0, end: segment.length };
    const region = expandDiffSpanContext(span, segment, 2, 2, chunk);
    expect(region).not.toBeNull();
    expect(region!.start).toBeGreaterThanOrEqual(0);
    expect(region!.end).toBeLessThanOrEqual(segment.length);
  });

  it('enumerates only 2-5 char windows inside diff context', () => {
    const segment = '我们要做后选生城';
    const built = buildDiffContextWindows(segment, [span], {
      allowedWindowLengths: [2, 3, 4, 5],
      fineLengths: [2, 3],
      coarseLengths: [4, 5],
      diffContextLeft: 2,
      diffContextRight: 2,
      maxWindows: 64,
    });
    expect(built.windows.length).toBeGreaterThan(0);
    expect(built.fullChunkDualScaleCount).toBe(0);
    for (const w of built.windows) {
      const len = w.end - w.start;
      expect([2, 3, 4, 5]).toContain(len);
      expect(w.meta?.windowTrigger).toBe('nbest_diff');
    }
    const keys = Object.keys(built.windowLengthDistribution).map(Number);
    expect(keys.every((k) => [2, 3, 4, 5].includes(k))).toBe(true);
  });
});
