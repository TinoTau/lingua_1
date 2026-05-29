import { describe, expect, it } from '@jest/globals';
import { applyFwSpanReplacements } from './apply-span-replacements';

describe('applyFwSpanReplacements', () => {
  it('从右到左应用多个不重叠替换', () => {
    const out = applyFwSpanReplacements('我们要做后选生城', [
      { start: 4, end: 6, candidateText: '候选', span: { text: '后选', start: 4, end: 6 } },
      { start: 6, end: 8, candidateText: '生成', span: { text: '生城', start: 6, end: 8 } },
    ]);
    expect(out).toBe('我们要做候选生成');
  });
});
