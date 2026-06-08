import { describe, expect, it } from '@jest/globals';
import { defaultGeneralProfile } from './profile-registry';
import { resolveWeakDomainRecallPlan } from './weak-domain-recall-resolver';

const ENABLED = ['tech_ai', 'travel', 'transport', 'restaurant'];

describe('resolveWeakDomainRecallPlan', () => {
  it('disabled → empty plan', () => {
    expect(
      resolveWeakDomainRecallPlan(defaultGeneralProfile(), ENABLED, false)
    ).toEqual({
      enabled: false,
      strongDomainIds: [],
      weakDomainIds: [],
      queryDomainIds: [],
    });
  });

  it('general → all enabled domains weak', () => {
    const plan = resolveWeakDomainRecallPlan(defaultGeneralProfile(), ENABLED, true);
    expect(plan.enabled).toBe(true);
    expect(plan.strongDomainIds).toEqual([]);
    expect(plan.weakDomainIds).toEqual(ENABLED);
    expect(plan.queryDomainIds).toEqual(ENABLED);
  });

  it('restaurant → strong restaurant + other domains weak', () => {
    const plan = resolveWeakDomainRecallPlan(
      {
        ...defaultGeneralProfile(),
        primaryDomain: 'restaurant',
      },
      ENABLED,
      true
    );
    expect(plan.strongDomainIds).toEqual(['restaurant']);
    expect(plan.weakDomainIds).toEqual(['tech_ai', 'travel', 'transport']);
    expect(plan.queryDomainIds).toEqual(['restaurant', 'tech_ai', 'travel', 'transport']);
  });
});
