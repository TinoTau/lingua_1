import { describe, expect, it } from '@jest/globals';
import {
  canonicalizeDomainPriors,
  projectCurrentTurnDomains,
  sanitizeDomainPriors,
} from './domain-context-contract';

describe('domain-context-contract', () => {
  it('treats missing/null/empty as equivalent empty priors', () => {
    expect(sanitizeDomainPriors(undefined)).toEqual([]);
    expect(sanitizeDomainPriors(null)).toEqual([]);
    expect(sanitizeDomainPriors([])).toEqual([]);
  });

  it('drops invalid weights and duplicates, caps at 3, sorts by weight desc', () => {
    const out = sanitizeDomainPriors([
      { domain: 'coffee', weight: 0.2 },
      { domain: 'food_order', weight: 0 },
      { domain: 'coffee', weight: 0.9 },
      { domain: 'bakery', weight: 0.5 },
      { domain: 'hotel', weight: 0.3 },
      { domain: 'taxi', weight: 0.1 },
      { domain: '', weight: 0.8 },
    ]);
    expect(out.map((p) => p.domain)).toEqual(['bakery', 'hotel', 'coffee']);
    const sum = out.reduce((s, p) => s + p.weight, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('canonicalizes order deterministically', () => {
    const a = canonicalizeDomainPriors([
      { domain: 'b', weight: 0.5 },
      { domain: 'a', weight: 0.5 },
    ]);
    const b = canonicalizeDomainPriors([
      { domain: 'a', weight: 0.5 },
      { domain: 'b', weight: 0.5 },
    ]);
    expect(a).toEqual(b);
    expect(a[0].domain).toBe('a');
  });

  it('projects retainedDomains to Top3 without inventing base/general', () => {
    const { domains, truncated } = projectCurrentTurnDomains({
      retainedDomains: ['d', 'c', 'b', 'a', 'general', 'base_term'],
      domainScores: { d: 4, c: 4, b: 3, a: 2, general: 9, base_term: 9 },
      maxCount: 4,
    });
    expect(truncated).toBe(true);
    expect(domains.map((x) => x.domain)).toEqual(['c', 'd', 'b']);
    expect(domains[0].voteCount).toBe(4);
    expect(domains.every((x) => x.domain !== 'general')).toBe(true);
  });

  it('empty retained yields empty projection', () => {
    const { domains, truncated } = projectCurrentTurnDomains({
      retainedDomains: [],
      domainScores: {},
    });
    expect(domains).toEqual([]);
    expect(truncated).toBe(false);
  });
});
