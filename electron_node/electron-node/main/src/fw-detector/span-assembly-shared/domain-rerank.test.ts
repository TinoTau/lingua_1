import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  CONTEXT_PRIOR_MULTIPLIER_MATCH,
  CONTEXT_PRIOR_MULTIPLIER_MISMATCH,
  computeContextPriorMultiplier,
  DOMAIN_RERANK_PENALTY,
  classifyDomainRerankRelation,
  computeDomainRerankPenalty,
  domainRerankPenaltyForRelation,
  resolveContextPriorEligibility,
} from './domain-rerank';
import type { UtteranceDomainVoteResult } from './utterance-domain-vote';
import {
  resetRuntimeDomainRegistryForTest,
  setRuntimeDomainRegistry,
  type RuntimeDomainRegistry,
} from '../../lexicon-v2/runtime-domain-registry';

const mockRegistry: RuntimeDomainRegistry = {
  availableFineDomains: [
    'coffee',
    'milk_tea',
    'bakery',
    'food_order',
    'tourism_hotel',
    'tourism_pickup',
    'tourism_route',
    'tourism_transport',
  ],
  availableCoarseDomains: ['restaurant', 'travel'],
  llmAllowedDomains: ['restaurant', 'travel'],
  fineToCoarseMap: {
    coffee: 'restaurant',
    milk_tea: 'restaurant',
    bakery: 'restaurant',
    food_order: 'restaurant',
    tourism_hotel: 'travel',
    tourism_pickup: 'travel',
    tourism_route: 'travel',
    tourism_transport: 'travel',
  },
  coarseToFineMap: {
    restaurant: ['bakery', 'coffee', 'food_order', 'milk_tea'],
    travel: ['tourism_hotel', 'tourism_pickup', 'tourism_route', 'tourism_transport'],
  },
  domainHierarchyVersion: 'test',
};

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
  beforeEach(() => {
    resetRuntimeDomainRegistryForTest();
    setRuntimeDomainRegistry(mockRegistry);
  });

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

  it('computeContextPriorMultiplier uses scheme A match/mismatch', () => {
    expect(computeContextPriorMultiplier('restaurant', 'coffee', mockRegistry)).toBe(
      CONTEXT_PRIOR_MULTIPLIER_MATCH
    );
    expect(computeContextPriorMultiplier('restaurant', 'tourism_hotel', mockRegistry)).toBe(
      CONTEXT_PRIOR_MULTIPLIER_MISMATCH
    );
    expect(computeContextPriorMultiplier('restaurant', undefined, mockRegistry)).toBe(1);
  });

  it('resolveContextPriorEligibility rejects insufficient evidence', () => {
    const result = resolveContextPriorEligibility('restaurant', vote({ insufficientEvidence: true }));
    expect(result.eligible).toBe(false);
    expect(result.skippedReason).toBe('insufficient_evidence');
  });

  it('resolveContextPriorEligibility accepts coarse prior when vote is sufficient', () => {
    const result = resolveContextPriorEligibility(
      'restaurant',
      vote({ utteranceDomain: 'coffee', insufficientEvidence: false })
    );
    expect(result.eligible).toBe(true);
    expect(result.coarsePriorDomain).toBe('restaurant');
  });
});
