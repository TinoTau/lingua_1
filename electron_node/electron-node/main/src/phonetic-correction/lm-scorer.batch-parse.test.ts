import { describe, expect, it } from '@jest/globals';
import {
  parseQueryLines,
  parseQueryLinesStrict,
} from './lm-scorer';

describe('parseQueryLines', () => {
  it('按序提取多个 Total 行并忽略 footer', () => {
    const stdout = [
      'Loading the LM...',
      'This is not a score line',
      'Total: -18.23 OOV: 0',
      'more ngram detail',
      'Total: -23.51 OOV: 1',
      'Perplexity including OOVs: 142.5',
      'OOVs: 1',
      'Tokens: 10',
      'Name:query VmPeak: 123',
    ].join('\n');

    const results = parseQueryLines(stdout);
    expect(results).toHaveLength(2);
    expect(results[0].score).toBeCloseTo(-18.23);
    expect(results[0].oovCount).toBe(0);
    expect(results[1].score).toBeCloseTo(-23.51);
    expect(results[1].oovCount).toBe(1);
  });

  it('parseQueryLinesStrict 行数不匹配时失败', () => {
    const stdout = 'Total: -1 OOV: 0\nPerplexity including OOVs: 1';
    const parsed = parseQueryLinesStrict(stdout, 2);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.actual).toBe(1);
    }
  });

  it('parseQueryLinesStrict 行数匹配时成功', () => {
    const stdout = 'Total: -1 OOV: 0\nTotal: -2 OOV: 1';
    const parsed = parseQueryLinesStrict(stdout, 2);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.results[1].score).toBe(-2);
    }
  });
});
