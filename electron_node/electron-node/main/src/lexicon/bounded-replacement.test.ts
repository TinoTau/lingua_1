import { describe, expect, it } from '@jest/globals';
import { buildBoundedReplacements } from './bounded-replacement';
import type { LexiconRecallEvidence } from './lexicon-types';

function ev(partial: Partial<LexiconRecallEvidence> & Pick<LexiconRecallEvidence, 'windowText' | 'replacement'>): LexiconRecallEvidence {
  return {
    term: '后选生城',
    replacement: partial.replacement,
    source: 'confusion',
    priority: 10,
    raw: {},
    recallPath: 'pinyin',
    pinyinKey: 'hou|xuan|sheng|cheng',
    windowId: 'aw-1',
    windowText: partial.windowText,
    windowStart: 0,
    windowEnd: partial.windowText.length,
    windowPinyin: ['hou', 'xuan', 'sheng', 'cheng'],
    ...partial,
  };
}

describe('buildBoundedReplacements', () => {
  it('from is ASR window text, not lexicon term', () => {
    const bounded = buildBoundedReplacements(
      [
        ev({ windowText: '后选声城', replacement: '候选生成', term: '后选生城' }),
        ev({ windowText: '后选声城', replacement: '候选生成', term: '后选声城', recallPath: 'term' }),
      ],
      { minPhoneticScore: 0 }
    );
    expect(bounded).toHaveLength(1);
    expect(bounded[0].from).toBe('后选声城');
    expect(bounded[0].from).not.toBe('后选生城');
    expect(bounded[0].to).toBe('候选生成');
    expect(bounded[0].evidences.length).toBe(2);
  });
});
