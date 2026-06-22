import { describe, expect, it } from '@jest/globals';
import {
  isExpandableCoarseDomain,
  isFineDomainEligibleForWinning,
  resolveRecallEnabledFineDomains,
} from './resolve-recall-enabled-fine-domains';

describe('resolveRecallEnabledFineDomains', () => {
  it('expands coarse restaurant into enabled fine domains', () => {
    const domains = resolveRecallEnabledFineDomains({
      configEnabledDomains: ['restaurant'],
    });
    expect(domains).toContain('coffee');
    expect(domains).toContain('food_order');
    expect(domains).not.toContain('restaurant');
  });

  it('prefers job override over config', () => {
    const domains = resolveRecallEnabledFineDomains({
      jobOverride: ['coffee'],
      configEnabledDomains: ['travel'],
    });
    expect(domains).toEqual(['coffee']);
  });

  it('passes through already-fine domain ids', () => {
    const domains = resolveRecallEnabledFineDomains({
      configEnabledDomains: ['coffee', 'milk_tea'],
    });
    expect(domains).toEqual(['coffee', 'milk_tea']);
  });
});

describe('fine domain eligibility', () => {
  it('marks expandable coarse domains ineligible for winning', () => {
    expect(isExpandableCoarseDomain('restaurant')).toBe(true);
    expect(isFineDomainEligibleForWinning('restaurant')).toBe(false);
    expect(isFineDomainEligibleForWinning('coffee')).toBe(true);
  });
});
