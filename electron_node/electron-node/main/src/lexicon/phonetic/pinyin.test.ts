import { describe, expect, it } from '@jest/globals';
import { scorePinyinSimilarity, textToSyllables } from './pinyin';

describe('textToSyllables', () => {
  it('converts Chinese text without tone', () => {
    expect(textToSyllables('候选生成')).toEqual(['hou', 'xuan', 'sheng', 'cheng']);
    expect(textToSyllables('后选生城')).toEqual(['hou', 'xuan', 'sheng', 'cheng']);
  });

  it('uses raw pinyin string when provided', () => {
    expect(textToSyllables('候选生成', 'hou xuan sheng cheng')).toEqual([
      'hou',
      'xuan',
      'sheng',
      'cheng',
    ]);
  });

  it('returns empty for empty or non-CJK without raw', () => {
    expect(textToSyllables('')).toEqual([]);
    expect(textToSyllables('hello')).toEqual([]);
    expect(textToSyllables('123')).toEqual([]);
  });
});

describe('scorePinyinSimilarity', () => {
  it('returns 1 for identical syllable sequences', () => {
    const syllables = ['hou', 'xuan', 'sheng', 'cheng'];
    expect(scorePinyinSimilarity(syllables, syllables)).toBeGreaterThan(0.99);
  });

  it('returns 0 when either side empty', () => {
    expect(scorePinyinSimilarity([], ['hou'])).toBe(0);
    expect(scorePinyinSimilarity(['hou'], [])).toBe(0);
  });
});
