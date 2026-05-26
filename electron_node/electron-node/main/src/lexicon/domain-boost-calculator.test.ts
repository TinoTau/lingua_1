import { describe, expect, it } from '@jest/globals';
import {
  computeDomainBoost,
  DOMAIN_BASE,
  DOMAIN_BOOST_MAX,
  PRIMARY_WEIGHT,
  SECONDARY_WEIGHT,
} from './domain-boost-calculator';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';

function profile(
  primary: string,
  secondary: string[] = []
): ActiveLexiconProfileSnapshot {
  return {
    primaryDomain: primary,
    secondaryDomains: secondary,
    boosts: { general: 1.0, [primary]: 1.15 },
    profileVersion: `${primary}-v1`,
    confidence: 0.9,
    effectiveFromTurn: 1,
  };
}

describe('computeDomainBoost', () => {
  it('primary domain = 0.12', () => {
    const boost = computeDomainBoost(profile('travel'), ['travel']);
    expect(boost).toBeCloseTo(PRIMARY_WEIGHT * DOMAIN_BASE, 5);
    expect(boost).toBeCloseTo(0.12, 5);
  });

  it('secondary domain = 0.06', () => {
    const boost = computeDomainBoost(profile('travel', ['restaurant']), ['restaurant']);
    expect(boost).toBeCloseTo(SECONDARY_WEIGHT * DOMAIN_BASE, 5);
  });

  it('general domain = 0', () => {
    expect(computeDomainBoost(profile('travel'), ['general'])).toBe(0);
  });

  it('clamps at DOMAIN_BOOST_MAX', () => {
    const snap = profile('travel');
    const boost = computeDomainBoost(snap, ['travel', 'travel']);
    expect(boost).toBeLessThanOrEqual(DOMAIN_BOOST_MAX);
  });
});
