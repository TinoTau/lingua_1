import { describe, expect, it } from '@jest/globals';
import { recallHotwordsByFuzzyPinyin } from './fuzzy-pinyin-recall';
import type { HotwordEntry } from './hotword-types';

describe('recallHotwordsByFuzzyPinyin', () => {
  const hotword: HotwordEntry = {
    id: 'hw-1',
    word: '候选生成',
    pinyin: ['hou', 'xuan', 'sheng', 'cheng'],
    priorScore: 8,
    frequency: 10,
    enabled: true,
  };

  it('matches near-homophone syllables', () => {
    const hits = recallHotwordsByFuzzyPinyin(
      ['hou', 'xuan', 'sheng', 'cheng'],
      [hotword],
      0.5,
      4
    );
    expect(hits.length).toBe(1);
    expect(hits[0].hotword.id).toBe('hw-1');
  });
});
