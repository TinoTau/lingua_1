import { describe, expect, it } from '@jest/globals';
import { SEGMENT_HYPOTHESIS_INDEX, recallSegmentWindowCandidates } from './window-recall';
import type { LexiconRuntime } from './lexicon-runtime';

function mockRuntime(
  observedMap: Record<string, string>,
  pinyinMap: Record<string, string>
): LexiconRuntime {
  const hotword = {
    id: 'hw-1',
    word: '候选生成',
    pinyin: ['hou', 'xuan', 'sheng', 'cheng'],
    frequency: 10,
    enabled: true,
  };
  return {
    getConfusionObservedStrings: () => Object.keys(observedMap),
    getEnabledHotwords: () => [hotword],
    recallHotwordsByObserved(text: string) {
      const id = observedMap[text];
      if (!id) {
        return [];
      }
      return [{ hotword, recallPath: 'confusion_evidence' as const }];
    },
    recallHotwordsByObservedLoose(text: string) {
      return this.recallHotwordsByObserved(text);
    },
    recallHotwordsByPinyin() {
      return [];
    },
  } as unknown as LexiconRuntime;
}

describe('recallSegmentWindowCandidates', () => {
  it('enumerates windows on segment text only', () => {
    const segment = '我们要做后选生城';
    const runtime = mockRuntime({ 后选生城: 'hw-1' }, {});
    const { candidates, diagnostics } = recallSegmentWindowCandidates(
      segment,
      [{ text: segment, rank: 0 }],
      runtime
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.hypothesisIndex === SEGMENT_HYPOTHESIS_INDEX)).toBe(true);
    expect(diagnostics.segmentTextLength).toBe(segment.length);
  });

  it('returns empty diagnostics for empty segment', () => {
    const runtime = mockRuntime({}, {});
    const { candidates, diagnostics } = recallSegmentWindowCandidates('', [], runtime);
    expect(candidates).toEqual([]);
    expect(diagnostics.windowCandidateCount).toBe(0);
  });
});
