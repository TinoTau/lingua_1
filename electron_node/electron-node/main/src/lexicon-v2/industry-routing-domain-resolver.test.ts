import { describe, expect, it, jest } from '@jest/globals';
import { resolveRecallDomains } from './industry-routing-domain-resolver';
import type { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import type { LexiconSessionIntent } from '../session-runtime/types';

function makeIntent(partial: Partial<LexiconSessionIntent>): LexiconSessionIntent {
  return {
    summary: '',
    topicKeywords: [],
    topicKeywordPinyinKeys: [],
    primaryDomain: 'general',
    secondaryDomains: [],
    confidence: 0,
    updatedAt: 0,
    effectiveFromTurn: 0,
    source: 'cpu_llm',
    reason: [],
    ...partial,
  };
}

describe('resolveRecallDomains', () => {
  const enabledDomains = ['tech_ai', 'travel', 'transport', 'restaurant'];
  const runtimeV2 = {
    lookupIndustryRoutes: jest.fn(() => []),
  } as unknown as LexiconRuntimeV2;

  it('high-confidence session intent wins', () => {
    const result = resolveRecallDomains({
      sessionIntent: makeIntent({
        primaryDomain: 'restaurant',
        secondaryDomains: ['travel'],
        confidence: 0.9,
      }),
      enabledDomains,
      runtimeV2,
    });
    expect(result.source).toBe('session_intent');
    expect(result.domainIds).toEqual(['restaurant', 'travel']);
  });

  it('low confidence falls through to enabledDomains when routing/anchor miss', () => {
    const result = resolveRecallDomains({
      sessionIntent: makeIntent({
        primaryDomain: 'restaurant',
        confidence: 0.5,
        topicKeywordPinyinKeys: [],
      }),
      enabledDomains,
      runtimeV2,
    });
    expect(result.source).toBe('enabled_domains');
    expect(result.domainIds).toEqual(enabledDomains);
  });

  it('industry routing vote when session confidence low', () => {
    const routingRuntime = {
      lookupIndustryRoutes: jest.fn(() => [
        { pinyinKey: 'ka|fei', keyword: '咖啡', domainId: 'restaurant', weight: 2 },
        { pinyinKey: 'ka|fei', keyword: '咖啡', domainId: 'travel', weight: 1 },
      ]),
    } as unknown as LexiconRuntimeV2;

    const result = resolveRecallDomains({
      sessionIntent: makeIntent({
        confidence: 0.5,
        topicKeywordPinyinKeys: ['ka|fei'],
      }),
      enabledDomains,
      runtimeV2: routingRuntime,
    });
    expect(result.source).toBe('industry_routing');
    expect(result.domainIds[0]).toBe('restaurant');
  });
});
