import { describe, expect, it } from '@jest/globals';
import { buildPinyinImeV2DictFromEntries } from './pinyin-ime-v2-dict-load';
import { decodeSyllablesTopK } from './pinyin-ime-v2-decoder';

const testDict = buildPinyinImeV2DictFromEntries([
  { word: '你好', syllables: ['ni', 'hao'], prior: 1.0, source: 'base' },
  { word: '世界', syllables: ['shi', 'jie'], prior: 0.9, source: 'base' },
  { word: '钟贝', syllables: ['zhong', 'bei'], prior: 0.85, source: 'domain' },
]);

describe('decodeSyllablesTopK', () => {
  it('returns topK candidates for valid syllable stream', () => {
    const { candidates } = decodeSyllablesTopK(['ni', 'hao', 'shi', 'jie'], testDict, 3);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].rank).toBe(1);
    expect(candidates[0].text).toBe('你好世界');
  });

  it('returns empty for empty syllables', () => {
    const { candidates } = decodeSyllablesTopK([], testDict, 5);
    expect(candidates).toEqual([]);
  });

  it('attaches token path covering full syllable stream', () => {
    const { candidates, diagnostics } = decodeSyllablesTopK(['ni', 'hao', 'shi', 'jie'], testDict, 3);
    expect(candidates[0].tokens).toBeDefined();
    expect(candidates[0].tokens!.length).toBe(2);
    expect(candidates[0].tokens![0]).toMatchObject({
      word: '你好',
      syllableStart: 0,
      syllableEnd: 2,
      source: 'base',
    });
    expect(candidates[0].tokens![1]).toMatchObject({
      word: '世界',
      syllableStart: 2,
      syllableEnd: 4,
      source: 'base',
    });
    expect(diagnostics.tokenPathAvailableCount).toBe(candidates.length);
    expect(diagnostics.candidateTokenCount).toBeGreaterThan(0);
  });

  it('records source from dict entry on each token', () => {
    const dict = buildPinyinImeV2DictFromEntries([
      { word: '你好', syllables: ['ni', 'hao'], prior: 1.0, source: 'base' },
      { word: '钟贝', syllables: ['zhong', 'bei'], prior: 0.95, source: 'domain' },
    ]);
    const { candidates } = decodeSyllablesTopK(['ni', 'hao', 'zhong', 'bei'], dict, 1);
    expect(candidates[0].tokens).toEqual([
      { word: '你好', syllableStart: 0, syllableEnd: 2, source: 'base' },
      { word: '钟贝', syllableStart: 2, syllableEnd: 4, source: 'domain' },
    ]);
  });
});
