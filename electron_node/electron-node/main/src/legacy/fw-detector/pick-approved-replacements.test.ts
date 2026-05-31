import { describe, expect, it } from '@jest/globals';
import type { FwDetectorSignal, FwSpanCandidateDiag } from '../../fw-detector/types';
import {
  pickApprovedReplacementsGreedy,
  pickBestCandidatePerSpan,
} from './pick-approved-replacements';

function cand(
  index: number,
  word: string,
  finalScore: number,
  vetoed = false
): FwSpanCandidateDiag {
  return {
    candidateIndex: index,
    word,
    priorScore: 0.5,
    candidateScore: 0.5,
    phoneticScore: 0.5,
    source: 'pinyin',
    candidateSentence: word,
    domains: [],
    domainMatched: false,
    domainScore: 0.5,
    kenlmDelta: 0,
    finalScore: vetoed ? 0 : finalScore,
    vetoed,
  };
}

describe('pick-approved-replacements', () => {
  it('picks highest non-vetoed finalScore per span', () => {
    const span = { text: '咖啡厅', start: 0, end: 3 };
    const meta = { domain: 'restaurant', riskScore: 2, signals: [] as FwDetectorSignal[] };
    const pick = pickBestCandidatePerSpan(span, meta, [
      cand(0, '咖啡店', 0.6),
      cand(1, '咖啡馆', 0.9),
    ]);
    expect(pick?.candidate.word).toBe('咖啡馆');
  });

  it('D-greedy prefers higher finalScore and skips overlaps', () => {
    const spanA = { text: 'ab', start: 0, end: 2 };
    const spanB = { text: 'bc', start: 1, end: 3 };
    const meta = { domain: 'general', riskScore: 2, signals: [] as FwDetectorSignal[] };
    const picks = [
      {
        span: spanA,
        spanMeta: meta,
        candidate: cand(0, 'AX', 0.7),
      },
      {
        span: spanB,
        spanMeta: meta,
        candidate: cand(0, 'BY', 0.95),
      },
    ];
    const approved = pickApprovedReplacementsGreedy(picks);
    expect(approved).toHaveLength(1);
    expect(approved[0]?.candidateText).toBe('BY');
    expect(approved[0]?.start).toBe(1);
  });
});
