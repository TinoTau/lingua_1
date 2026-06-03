import { describe, expect, it } from '@jest/globals';
import { normalizePinyinImeV2Spans } from './pinyin-ime-v2-span-normalizer';
import { DEFAULT_PINYIN_IME_V2 } from './pinyin-ime-v2-config';

const baseConfig = {
  minSpanChars: DEFAULT_PINYIN_IME_V2.minSpanChars,
  maxSpanChars: DEFAULT_PINYIN_IME_V2.maxSpanChars,
  minSyllables: DEFAULT_PINYIN_IME_V2.minSyllables,
  maxSyllables: DEFAULT_PINYIN_IME_V2.maxSyllables,
};

describe('normalizePinyinImeV2Spans', () => {
  it('rejects single-char span', () => {
    const result = normalizePinyinImeV2Spans(
      '你号世界',
      [{ rawSpan: '号', start: 1, end: 2, candidateRank: 1, supportCount: 2 }],
      [],
      [],
      baseConfig
    );
    expect(result.spans).toHaveLength(0);
    expect(result.dropped.some((d) => d.reason === 'single_char')).toBe(true);
  });

  it('accepts 2-syllable span for Recall', () => {
    const result = normalizePinyinImeV2Spans(
      '麻烦来一杯钟贝咖啡',
      [{ rawSpan: '钟贝', start: 5, end: 7, candidateRank: 1, supportCount: 2 }],
      [],
      [],
      baseConfig
    );
    expect(result.spans).toHaveLength(1);
    expect(result.spans[0].rawSpan).toBe('钟贝');
  });

  it('rejects span outside syllable [2,5] range', () => {
    const longSpan = '一二三四五六';
    const result = normalizePinyinImeV2Spans(
      longSpan,
      [
        {
          rawSpan: longSpan,
          start: 0,
          end: longSpan.length,
          candidateRank: 1,
          supportCount: 2,
        },
      ],
      [],
      [],
      baseConfig
    );
    expect(result.spans).toHaveLength(0);
    expect(
      result.dropped.some(
        (d) => d.reason === 'syllable_out_of_range' || d.reason === 'too_long'
      )
    ).toBe(true);
  });
});
