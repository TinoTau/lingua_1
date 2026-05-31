import { describe, expect, it } from '@jest/globals';
import { resolveDomainIdsForRecall } from './domain-recall-merge';

describe('resolveDomainIdsForRecall', () => {
  it('general / invalid domain → base only (empty domain list)', () => {
    expect(
      resolveDomainIdsForRecall({
        primaryDomain: 'general',
        secondaryDomains: [],
        boosts: {},
        profileVersion: 't',
        confidence: 1,
        effectiveFromTurn: 0,
      })
    ).toEqual([]);
  });

  it('valid primary + secondary domains', () => {
    expect(
      resolveDomainIdsForRecall({
        primaryDomain: 'restaurant',
        secondaryDomains: ['travel', 'general', 'invalid_x'],
        boosts: {},
        profileVersion: 't',
        confidence: 1,
        effectiveFromTurn: 0,
      })
    ).toEqual(['restaurant', 'travel']);
  });
});
