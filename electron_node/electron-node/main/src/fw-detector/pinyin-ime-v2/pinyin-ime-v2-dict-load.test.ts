import { describe, expect, it } from '@jest/globals';
import { buildPinyinImeV2DictFromEntries } from './pinyin-ime-v2-dict-load';
import { decodeSyllablesTopK } from './pinyin-ime-v2-decoder';

describe('buildPinyinImeV2DictFromEntries source', () => {
  it('defaults missing source to base', () => {
    const dict = buildPinyinImeV2DictFromEntries([
      { word: '测', syllables: ['ce'], prior: 1 },
    ]);
    expect(dict.entries[0].source).toBe('base');
  });

  it('preserves fallback source on fallback beam entries', () => {
    const dict = buildPinyinImeV2DictFromEntries([
      { word: 'x', syllables: ['x'], prior: 0.1, source: 'fallback', isFallback: true },
    ]);
    const fallback = dict.byFirstFallback.get('x')?.[0];
    expect(fallback?.source).toBe('fallback');
  });
});

describe('dict entry source in decode path', () => {
  it('emits fallback source when beam uses byFirstFallback', () => {
    const dict = buildPinyinImeV2DictFromEntries([
      { word: '罕', syllables: ['han'], prior: 0.01, source: 'fallback', isFallback: true },
    ]);
    const { candidates } = decodeSyllablesTopK(['han'], dict, 1);
    expect(candidates[0].tokens?.[0].source).toBe('fallback');
  });
});
