import { describe, expect, it } from '@jest/globals';
import { charDiffSpansInTop1, detectNbestDiffSpans } from './nbest-diff-span';

describe('nbest-diff-span', () => {
  it('charDiffSpansInTop1 finds substitution', () => {
    const spans = charDiffSpansInTop1('后选生城', '后选声城');
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.some((s) => s.altText.includes('声'))).toBe(true);
  });

  it('detectNbestDiffSpans ignores rank0 and equal hyps', () => {
    const segment = '我们要做后选生城';
    const spans = detectNbestDiffSpans(segment, [
      { text: segment, rank: 0 },
      { text: segment, rank: 1 },
      { text: '我们要做后选声城', rank: 2 },
    ]);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.every((s) => s.hypothesisRank === 2)).toBe(true);
    expect(spans[0].diffSpanId).toBeTruthy();
  });

  it('returns empty when all hypotheses match segment', () => {
    const segment = '无差异';
    expect(detectNbestDiffSpans(segment, [{ text: segment, rank: 0 }])).toEqual([]);
  });
});
