import { describe, expect, it } from '@jest/globals';
import { buildExactWordIndex, lookupExactWord } from './exact-index';
import type { HotwordEntry } from './hotword-types';

function entry(partial: Partial<HotwordEntry> & Pick<HotwordEntry, 'id' | 'word'>): HotwordEntry {
  return {
    pinyin: [],
    priorScore: 0.8,
    frequency: 1,
    enabled: true,
    ...partial,
  };
}

describe('exact-index', () => {
  it('indexes mixed latin without pinyin and resolves case-insensitive', () => {
    const gpu = entry({ id: 'gpu', word: 'GPU', priorScore: 0.9, pinyin: [] });
    const index = buildExactWordIndex([gpu]);
    expect(index.size).toBeGreaterThan(0);
    expect(lookupExactWord(index, 'gpu')[0]?.word).toBe('GPU');
    expect(lookupExactWord(index, 'GPU')[0]?.id).toBe('gpu');
  });

  it('skips CJK without pinyin', () => {
    const index = buildExactWordIndex([
      entry({ id: 'zh', word: '词库', priorScore: 0.8, pinyin: [] }),
    ]);
    expect(lookupExactWord(index, '词库')).toEqual([]);
  });
});
