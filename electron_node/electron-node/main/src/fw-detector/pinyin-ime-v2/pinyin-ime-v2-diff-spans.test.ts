import { describe, expect, it } from '@jest/globals';
import { collectDiffSpansFromCandidates, diffReplacementSpans } from './pinyin-ime-v2-diff-spans';

describe('diffReplacementSpans', () => {
  it('returns empty spans for identical text', () => {
    expect(diffReplacementSpans('你好世界', '你好世界')).toEqual({
      spans: [],
      alignFailed: false,
    });
  });

  it('extracts substitution span', () => {
    const result = diffReplacementSpans('你号世界', '你好世界');
    expect(result.alignFailed).toBe(false);
    expect(result.spans).toHaveLength(1);
    expect(result.spans[0]).toMatchObject({
      start: 1,
      end: 2,
      source: '号',
    });
  });
});

describe('collectDiffSpansFromCandidates', () => {
  it('collects Top5 union diff spans with candidate rank', () => {
    const { diffSpans } = collectDiffSpansFromCandidates(
      '你号世界',
      [
        { text: '你好世界', score: 1, rank: 1 },
        { text: '你号世界', score: 0.5, rank: 2 },
      ],
      5
    );
    expect(diffSpans.some((s) => s.candidateRank === 1 && s.rawSpan === '号')).toBe(true);
  });
});
