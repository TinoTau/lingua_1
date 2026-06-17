import { describe, expect, it } from '@jest/globals';
import { buildTonePinyinKeyFromSyllablesAndPattern } from './tone-pinyin';

describe('buildTonePinyinKeyFromSyllablesAndPattern', () => {
  it('builds shao3|bing1 from shao|bing + [3,1]', () => {
    expect(buildTonePinyinKeyFromSyllablesAndPattern(['shao', 'bing'], [3, 1])).toBe('shao3|bing1');
  });

  it('returns null when syllable and pattern lengths differ', () => {
    expect(buildTonePinyinKeyFromSyllablesAndPattern(['shao', 'bing'], [3])).toBeNull();
  });

  it('returns null when tone digit out of range', () => {
    expect(buildTonePinyinKeyFromSyllablesAndPattern(['shao', 'bing'], [0, 1])).toBeNull();
    expect(buildTonePinyinKeyFromSyllablesAndPattern(['shao', 'bing'], [3, 6])).toBeNull();
  });

  it('returns null when pattern missing', () => {
    expect(buildTonePinyinKeyFromSyllablesAndPattern(['shao', 'bing'], null)).toBeNull();
    expect(buildTonePinyinKeyFromSyllablesAndPattern(['shao', 'bing'], undefined)).toBeNull();
  });

  it('returns null when syllable empty after normalize', () => {
    expect(buildTonePinyinKeyFromSyllablesAndPattern(['', 'bing'], [3, 1])).toBeNull();
  });
});
