import { describe, expect, it } from '@jest/globals';
import { buildHotwordPinyinIndex, syllablesKey } from './pinyin-index';
import type { HotwordEntry } from './hotword-types';

describe('buildHotwordPinyinIndex', () => {
  it('indexes hotwords by normalized syllable key and sorts by priorScore', () => {
    const entries: HotwordEntry[] = [
      {
        id: '1',
        word: '候选生成',
        pinyin: ['hou', 'xuan', 'sheng', 'cheng'],
        priorScore: 8,
        frequency: 10,
        enabled: true,
      },
      {
        id: '2',
        word: '候选生成',
        pinyin: ['hou', 'xuan', 'sheng', 'cheng'],
        priorScore: 9,
        frequency: 9,
        enabled: true,
      },
    ];
    const index = buildHotwordPinyinIndex(entries);
    expect(index.size).toBe(1);
    const key = syllablesKey(['hou', 'xuan', 'sheng', 'cheng']);
    expect(index.get(key)?.length).toBe(2);
    expect(index.get(key)?.[0].priorScore).toBe(9);
  });

  it('skips disabled, no prior, or no pinyin', () => {
    const index = buildHotwordPinyinIndex([
      {
        id: 'x',
        word: '',
        pinyin: [],
        priorScore: 1,
        frequency: 1,
        enabled: true,
      },
      {
        id: 'y',
        word: 'GPU',
        pinyin: [],
        priorScore: 5,
        frequency: 1,
        enabled: true,
      },
    ]);
    expect(index.size).toBe(0);
  });
});
