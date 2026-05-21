import { describe, expect, it } from '@jest/globals';
import {
  filterRerankEligibleCandidates,
  isRerankEligible,
  resolveCandidateSource,
} from './candidate-source';
import type { SentenceCandidate } from './sentence-expansion/types';

function stubCandidate(source: SentenceCandidate['candidateSource']): SentenceCandidate {
  return {
    text: 'x',
    hypothesisIndex: 0,
    baseText: 'x',
    replacements: [],
    candidateSource: source,
    phoneticScore: 0,
    hotwordPrior: 0,
  };
}

describe('candidate-source', () => {
  it('resolveCandidateSource maps replacement count', () => {
    expect(resolveCandidateSource([])).toBe('raw_ctc_baseline');
    expect(resolveCandidateSource([{ length: 1 } as { length: number }])).toBe('window_single');
    expect(resolveCandidateSource([{}, {}] as { length: number }[])).toBe('window_pair');
  });

  it('filterRerankEligibleCandidates excludes raw_ctc_baseline', () => {
    const pool = [
      stubCandidate('raw_ctc_baseline'),
      stubCandidate('window_single'),
    ];
    const eligible = filterRerankEligibleCandidates(pool);
    expect(eligible).toHaveLength(1);
    expect(isRerankEligible(eligible[0])).toBe(true);
  });
});
