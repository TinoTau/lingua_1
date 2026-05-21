import { describe, expect, it } from '@jest/globals';
import { buildHotwordPinyinIndex, syllablesKey } from './pinyin-index';
import type { HotwordEntry } from './hotword-types';

describe('buildHotwordPinyinIndex', () => {
  it('indexes hotwords by normalized syllable key', () => {
    const entries: HotwordEntry[] = [
      {
        id: '1',
        word: '候选生成',
        pinyin: ['hou', 'xuan', 'sheng', 'cheng'],
        frequency: 10,
        enabled: true,
      },
      {
        id: '2',
        word: '候选生成',
        pinyin: ['hou', 'xuan', 'sheng', 'cheng'],
        frequency: 9,
        enabled: true,
      },
    ];
    const index = buildHotwordPinyinIndex(entries);
    expect(index.size).toBe(1);
    const key = syllablesKey(['hou', 'xuan', 'sheng', 'cheng']);
    expect(index.get(key)?.length).toBe(2);
    expect(index.get(key)?.[0].frequency).toBe(10);
  });

  it('skips disabled or empty words', () => {
    const index = buildHotwordPinyinIndex([
      {
        id: 'x',
        word: '',
        pinyin: [],
        frequency: 1,
        enabled: true,
      },
    ]);
    expect(index.size).toBe(0);
  });
});
