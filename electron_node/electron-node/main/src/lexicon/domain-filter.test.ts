import { describe, expect, it } from '@jest/globals';
import { matchEnabledDomain } from './domain-filter';

describe('matchEnabledDomain', () => {
  it('匹配 enabled domain', () => {
    expect(matchEnabledDomain(['restaurant'], ['restaurant', 'tech_ai'])).toBe(true);
  });

  it('general 或未标注 domain 不匹配', () => {
    expect(matchEnabledDomain(undefined, ['restaurant'])).toBe(false);
    expect(matchEnabledDomain(['general'], ['restaurant'])).toBe(false);
  });

  it('enabledDomains 为空时拒绝', () => {
    expect(matchEnabledDomain(['restaurant'], [])).toBe(false);
  });
});
