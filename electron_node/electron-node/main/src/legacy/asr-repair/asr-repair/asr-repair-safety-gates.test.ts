import { describe, expect, it } from '@jest/globals';
import {
  evaluateLowCandidateScore,
  evaluateNoTopkCandidate,
  evaluateReplacementCountExceeded,
  isV5SkipReason,
} from './asr-repair-safety-gates';
import type { WindowCandidate } from '../../../lexicon/hotword-types';

function candidate(score: number): WindowCandidate {
  return {
    windowId: 'w',
    hypothesisIndex: 0,
    from: 'ab',
    to: 'cd',
    start: 0,
    end: 2,
    hotwordId: 'h',
    phoneticScore: 0.9,
    priorScore: 5,
    candidateScore: score,
    rankInTopK: 1,
    termLength: 2,
    source: 'lexicon_pinyin_topk',
  };
}

describe('asr-repair-safety-gates', () => {
  it('evaluateNoTopkCandidate', () => {
    expect(evaluateNoTopkCandidate([])).toBe('no_topk_candidate');
    expect(evaluateNoTopkCandidate([{ ...candidate(5), source: 'hotword' }])).toBe(
      'no_topk_candidate'
    );
    expect(evaluateNoTopkCandidate([candidate(5)])).toBeNull();
    expect(
      evaluateNoTopkCandidate([{ ...candidate(5), source: 'lexicon_pinyin_topk' as const }])
    ).toBeNull();
  });

  it('evaluateReplacementCountExceeded uses maxReplacements=2', () => {
    expect(evaluateReplacementCountExceeded(3)).toBe('replacement_count_exceeded');
    expect(evaluateReplacementCountExceeded(2)).toBeNull();
  });

  it('isV5SkipReason', () => {
    expect(isV5SkipReason('no_diff_span')).toBe(true);
    expect(isV5SkipReason('no_window_expansion_candidate')).toBe(true);
  });
});
