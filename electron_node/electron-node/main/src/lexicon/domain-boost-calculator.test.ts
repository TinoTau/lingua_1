import { describe, expect, it } from '@jest/globals';
import {
  computeDomainBoost,
  WEAK_DOMAIN_WEIGHT,
  PRIMARY_WEIGHT,
  profileWeight,
} from './domain-boost-calculator';
import { defaultGeneralProfile } from '../lexicon-v2/profile-registry';

describe('domain-boost-calculator weak domain', () => {
  it('weak context gives WEAK_DOMAIN_WEIGHT for enabled domain under general profile', () => {
    const profile = defaultGeneralProfile();
    const ctx = {
      strongDomainIds: [],
      weakDomainIds: ['restaurant'],
    };
    expect(profileWeight(profile, 'restaurant', ctx)).toBe(WEAK_DOMAIN_WEIGHT);
    expect(computeDomainBoost(profile, ['restaurant'], ctx)).toBeGreaterThan(0);
    expect(computeDomainBoost(profile, ['restaurant'])).toBe(0);
  });

  it('restaurant primary stays strong under weak plan', () => {
    const profile = {
      ...defaultGeneralProfile(),
      primaryDomain: 'restaurant',
    };
    const ctx = {
      strongDomainIds: ['restaurant'],
      weakDomainIds: ['travel'],
    };
    expect(profileWeight(profile, 'restaurant', ctx)).toBe(PRIMARY_WEIGHT);
    expect(profileWeight(profile, 'travel', ctx)).toBe(WEAK_DOMAIN_WEIGHT);
  });
});
