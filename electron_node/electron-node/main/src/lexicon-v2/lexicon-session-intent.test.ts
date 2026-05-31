import { describe, expect, it } from '@jest/globals';
import {
  buildLexiconSessionIntentFromDecision,
  computeTopicKeywordPinyinKeys,
  normalizeTopicKeywords,
} from './lexicon-session-intent';

describe('lexicon-session-intent', () => {
  it('normalizes topic keywords to CJK-only deduped list', () => {
    expect(
      normalizeTopicKeywords(['咖啡', 'coffee', '咖啡', '中杯', ' ', '123'])
    ).toEqual(['咖啡', '中杯']);
  });

  it('computes pinyin keys with pipe separator', () => {
    expect(computeTopicKeywordPinyinKeys(['候选'])).toEqual(['hou|xuan']);
  });

  it('builds LexiconSessionIntent from profile decision', () => {
    const intent = buildLexiconSessionIntentFromDecision({
      summary: '点咖啡',
      topicKeywords: ['咖啡', '中杯'],
      primaryDomain: 'restaurant',
      secondaryDomains: [],
      confidence: 0.88,
      shouldSwitch: true,
      reason: ['coffee order'],
      effectiveFromTurn: 3,
    });

    expect(intent.topicKeywords).toEqual(['咖啡', '中杯']);
    expect(intent.topicKeywordPinyinKeys.length).toBe(2);
    expect(intent.primaryDomain).toBe('restaurant');
    expect(intent.source).toBe('cpu_llm');
  });
});
