import { describe, expect, it } from '@jest/globals';
import { buildAsrHypotheses } from './build-asr-hypotheses';

describe('buildAsrHypotheses', () => {
  it('marks synthetic when n-best missing', () => {
    const result = buildAsrHypotheses('你好', undefined);
    expect(result.nbestSynthetic).toBe(true);
    expect(result.hypotheses).toHaveLength(1);
    expect(result.hypotheses[0].text).toBe('你好');
  });

  it('uses n-best when present', () => {
    const result = buildAsrHypotheses('top1', [
      { rank: 0, text: 'a' },
      { rank: 1, text: 'b', acousticScore: -2 },
    ]);
    expect(result.nbestSynthetic).toBe(false);
    expect(result.hypotheses).toHaveLength(2);
  });
});
