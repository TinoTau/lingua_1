import { describe, expect, it } from '@jest/globals';
import { applyDomainPriorQuota } from './apply-domain-prior-quota';

describe('applyDomainPriorQuota', () => {
  const priors = [
    { domain: 'coffee', weight: 0.7 },
    { domain: 'bakery', weight: 0.3 },
  ];

  it('without priors keeps score order and limit', () => {
    const out = applyDomainPriorQuota(
      [
        { candidateId: 'a', score: 1, source: 'domain_term', domains: ['coffee'] },
        { candidateId: 'b', score: 3, source: 'base_term', domains: [] },
        { candidateId: 'c', score: 2, source: 'domain_term', domains: ['hotel'] },
      ],
      [],
      2
    );
    expect(out.map((x) => x.candidateId)).toEqual(['b', 'c']);
  });

  it('reserves base and other-domain while preferring prior', () => {
    const out = applyDomainPriorQuota(
      [
        { candidateId: 'p1', score: 1, source: 'domain_term', domains: ['coffee'] },
        { candidateId: 'p2', score: 1, source: 'domain_term', domains: ['bakery'] },
        { candidateId: 'p3', score: 9, source: 'domain_term', domains: ['coffee'] },
        { candidateId: 'base', score: 0.1, source: 'base_term', domains: [] },
        { candidateId: 'hotel', score: 0.5, source: 'domain_term', domains: ['hotel'] },
      ],
      priors,
      4
    );
    const ids = out.map((x) => x.candidateId);
    expect(ids).toContain('base');
    expect(ids).toContain('hotel');
    expect(ids.filter((id) => id.startsWith('p')).length).toBeGreaterThanOrEqual(1);
    expect(out).toHaveLength(4);
  });
});
