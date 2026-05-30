import { describe, expect, it } from '@jest/globals';
import type { WindowCandidate } from '../../../../lexicon/hotword-types';
import type { SentenceCandidate } from '../sentence-expansion/types';
import {
  computeHistoricalPickedReason,
  resolveTop1HypothesisIndex,
} from './picked-reason';

function candidate(partial: Partial<SentenceCandidate> & Pick<SentenceCandidate, 'text'>): SentenceCandidate {
  return {
    hypothesisIndex: 0,
    baseText: partial.text,
    replacements: [],
    phoneticScore: 0,
    hotwordPrior: 0,
    candidateSource: 'window_single',
    ...partial,
  };
}

describe('picked-reason (historical-restore)', () => {
  it('resolveTop1HypothesisIndex 取 rank=0', () => {
    expect(
      resolveTop1HypothesisIndex([
        { text: 'a', rank: 1 },
        { text: 'b', rank: 0 },
      ])
    ).toBe(1);
  });

  it('hotword_recall 当 picked 含 replacements', () => {
    const replacement: WindowCandidate = {
      windowId: 'w1',
      hypothesisIndex: 0,
      from: '后选',
      to: '候选',
      start: 0,
      end: 2,
      hotwordId: 'hw',
      phoneticScore: 0.9,
      priorScore: 1,
      source: 'lexicon_pinyin_topk',
    };
    const picked = candidate({ text: '候选', replacements: [replacement] });
    expect(computeHistoricalPickedReason(picked)).toBe('hotword_recall');
  });

  it('window_phonetic_expansion 当无 replacement 且为窗扩展候选', () => {
    const picked = candidate({ text: '候选句', candidateSource: 'window_single' });
    expect(computeHistoricalPickedReason(picked)).toBe('window_phonetic_expansion');
  });

  it('none 当非窗扩展候选', () => {
    const picked = candidate({ text: '裸句', candidateSource: 'raw_ctc_baseline' });
    expect(computeHistoricalPickedReason(picked)).toBe('none');
  });
});
