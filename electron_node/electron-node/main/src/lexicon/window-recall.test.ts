import { describe, expect, it } from '@jest/globals';
import { SEGMENT_HYPOTHESIS_INDEX, recallSegmentWindowCandidates } from './window-recall';
import type { LexiconRuntime } from './lexicon-runtime';

function mockRuntime(
  pinyinHits: Record<string, { id: string; word: string }> = {}
): LexiconRuntime {
  const hotword = {
    id: 'hw-1',
    word: '候选生成',
    pinyin: ['hou', 'xuan', 'sheng', 'cheng'],
    priorScore: 8,
    frequency: 10,
    enabled: true,
  };
  return {
    getEnabledHotwords: () => [hotword],
    recallHotwordsByPinyin(syllables: string[]) {
      const key = syllables.join('|');
      const hit = pinyinHits[key];
      if (!hit) {
        return [];
      }
      return [{ ...hotword, id: hit.id, word: hit.word }];
    },
    getPinyinBucket(key: string) {
      const hit = pinyinHits[key];
      return hit ? [{ ...hotword, id: hit.id, word: hit.word }] : [];
    },
    forEachPinyinBucket(fn: (key: string, bucket: readonly typeof hotword[]) => void) {
      for (const [key, hit] of Object.entries(pinyinHits)) {
        fn(key, [{ ...hotword, id: hit.id, word: hit.word }]);
      }
    },
    lookupHotwordsByExactWord(word: string) {
      return word === hotword.word ? [hotword] : [];
    },
    lookupAliasExactMatches: () => [],
    lookupAliasPinyinMatches: () => [],
  } as unknown as LexiconRuntime;
}

describe('recallSegmentWindowCandidates (V5 diff)', () => {
  it('builds diff-triggered windows when n-best differs', () => {
    const segment = '我们要做后选生城';
    const runtime = mockRuntime({ 'hou|xuan|sheng|cheng': { id: 'hw-1', word: '候选生成' } });
    const { candidates, diagnostics } = recallSegmentWindowCandidates(
      segment,
      [
        { text: segment, rank: 0 },
        { text: '我们要做后选声城', rank: 1 },
      ],
      runtime
    );
    expect(diagnostics.windowsFromNbestDiffCount).toBeGreaterThan(0);
    expect(diagnostics.slidingWindowCount).toBe(0);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.hypothesisIndex === SEGMENT_HYPOTHESIS_INDEX)).toBe(true);
  });

  it('returns empty diagnostics for empty segment', () => {
    const runtime = mockRuntime();
    const { candidates, diagnostics } = recallSegmentWindowCandidates('', [], runtime);
    expect(candidates).toEqual([]);
    expect(diagnostics.windowCandidateCount).toBe(0);
  });
});
