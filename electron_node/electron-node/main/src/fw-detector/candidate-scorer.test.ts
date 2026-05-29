import { describe, expect, it } from '@jest/globals';
import {
  computeCandidateFinalScore,
  computeDomainScore,
  normalizeKenlmDeltaForScore,
} from './candidate-scorer';

const WEIGHTS = { pinyin: 0.4, prior: 0.3, domain: 0.2, kenlm: 0.1 };

describe('candidate-scorer', () => {
  it('domain only boosts (matched > unmatched)', () => {
    expect(computeDomainScore(true)).toBeGreaterThan(computeDomainScore(false));
  });

  it('normalizes kenlm delta into [0,1]', () => {
    expect(normalizeKenlmDeltaForScore(-1)).toBe(0);
    expect(normalizeKenlmDeltaForScore(1)).toBe(1);
    expect(normalizeKenlmDeltaForScore(0)).toBeCloseTo(0.5);
  });

  it('weights pinyin/prior/domain/kenlm per V1.1', () => {
    const high = computeCandidateFinalScore(
      {
        phoneticScore: 1,
        priorScore: 1,
        domainMatched: true,
        kenlmDelta: 1,
        kenlmEnabled: true,
      },
      WEIGHTS
    );
    const low = computeCandidateFinalScore(
      {
        phoneticScore: 0,
        priorScore: 0,
        domainMatched: false,
        kenlmDelta: -1,
        kenlmEnabled: true,
      },
      WEIGHTS
    );
    expect(high.finalScore).toBeGreaterThan(low.finalScore);
    expect(high.finalScore).toBeCloseTo(1, 5);
  });
});
