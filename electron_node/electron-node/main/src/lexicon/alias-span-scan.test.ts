import { describe, expect, it } from '@jest/globals';
import { scanAliasExactHitsInText } from './alias-span-scan';

describe('scanAliasExactHitsInText', () => {
  it('finds alias substring in text', () => {
    const hits = scanAliasExactHitsInText('我要一杯钟贝咖啡', ['钟贝', '中杯'], 2);
    expect(hits).toEqual([{ text: '钟贝', start: 4, end: 6 }]);
  });

  it('respects maxSpans', () => {
    const hits = scanAliasExactHitsInText('钟贝中杯', ['钟贝', '中杯'], 1);
    expect(hits.length).toBe(1);
  });

  it('avoids overlapping hits', () => {
    const hits = scanAliasExactHitsInText('abc', ['ab', 'bc'], 2);
    expect(hits.length).toBe(1);
  });
});
