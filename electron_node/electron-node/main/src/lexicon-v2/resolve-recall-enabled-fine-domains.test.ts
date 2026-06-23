import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  expandPolicyToFineDomains,
  isExpandableCoarseDomain,
  isFineDomainEligibleForWinning,
  resolveRecallEnabledFineDomains,
  resolveRecallScope,
} from './resolve-recall-enabled-fine-domains';
import {
  resetRuntimeDomainRegistryForTest,
  setRuntimeDomainRegistry,
  type RuntimeDomainRegistry,
} from './runtime-domain-registry';

const mockRegistry: RuntimeDomainRegistry = {
  availableFineDomains: ['coffee', 'milk_tea', 'bakery', 'food_order', 'tourism_hotel'],
  availableCoarseDomains: ['restaurant', 'travel'],
  llmAllowedDomains: ['restaurant', 'travel'],
  fineToCoarseMap: {
    coffee: 'restaurant',
    milk_tea: 'restaurant',
    bakery: 'restaurant',
    food_order: 'restaurant',
    tourism_hotel: 'travel',
  },
  coarseToFineMap: {
    restaurant: ['coffee', 'milk_tea', 'bakery', 'food_order'],
    travel: ['tourism_hotel'],
  },
  domainHierarchyVersion: 'test',
};

describe('resolveRecallEnabledFineDomains', () => {
  beforeEach(() => {
    resetRuntimeDomainRegistryForTest();
    setRuntimeDomainRegistry(mockRegistry);
  });

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

  it('defaults to availableFineDomains when policy empty', () => {
    const scope = resolveRecallScope({ configEnabledDomains: [] });
    expect(scope.source).toBe('available');
    expect(scope.domainIds).toEqual([...mockRegistry.availableFineDomains].sort());
  });

  it('RS-03A: medical policy with no terms yields empty scope', () => {
    const expanded = expandPolicyToFineDomains(['medical'], mockRegistry);
    expect(expanded).toEqual([]);
    const scope = resolveRecallScope({ configEnabledDomains: ['medical'] });
    expect(scope.domainIds).toEqual([]);
  });
});

describe('fine domain eligibility', () => {
  beforeEach(() => {
    resetRuntimeDomainRegistryForTest();
    setRuntimeDomainRegistry(mockRegistry);
  });

  it('marks expandable coarse domains ineligible for winning', () => {
    expect(isExpandableCoarseDomain('restaurant')).toBe(true);
    expect(isFineDomainEligibleForWinning('restaurant')).toBe(false);
    expect(isFineDomainEligibleForWinning('coffee')).toBe(true);
  });
});
