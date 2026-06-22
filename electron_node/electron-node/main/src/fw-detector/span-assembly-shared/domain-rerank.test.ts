import { describe, expect, it } from '@jest/globals';
import {
  DOMAIN_RERANK_PENALTY,
  classifyDomainRerankRelation,
  computeDomainRerankPenalty,
  domainRerankPenaltyForRelation,
} from './domain-rerank';
import type { UtteranceDomainVoteResult } from './utterance-domain-vote';

function vote(overrides: Partial<UtteranceDomainVoteResult>): UtteranceDomainVoteResult {
  return {
    utteranceDomain: 'general',
    insufficientEvidence: true,
    domainScores: {},
    domainVoteMs: 0,
    parentTermVoteCount: 0,
    ...overrides,
  };
}

describe('domain-rerank', () => {
  it('uses contract penalty coefficients', () => {
    expect(DOMAIN_RERANK_PENALTY).toEqual({
      winning: 1.0,
      sibling: 0.8,
      parent: 0.7,
      other: 0.5,
    });
    expect(domainRerankPenaltyForRelation('winning')).toBe(1.0);
    expect(domainRerankPenaltyForRelation('sibling')).toBe(0.8);
    expect(domainRerankPenaltyForRelation('parent')).toBe(0.7);
    expect(domainRerankPenaltyForRelation('other')).toBe(0.5);
    expect(domainRerankPenaltyForRelation('none')).toBe(1.0);
  });

  it('classifies sibling domains under same parent', () => {
    expect(
      classifyDomainRerankRelation('coffee', 'milk_tea', false)
    ).toBe('sibling');
  });

  it('classifies parent relation between coarse parent and fine child', () => {
    expect(
      classifyDomainRerankRelation('coffee', 'restaurant', false)
    ).toBe('parent');
  });

  it('does not drop candidates — other domains get 0.5 penalty only', () => {
    const penalty = computeDomainRerankPenalty(
      vote({ utteranceDomain: 'coffee', insufficientEvidence: false }),
      'tourism_hotel'
    );
    expect(penalty).toBe(0.5);
  });
});
