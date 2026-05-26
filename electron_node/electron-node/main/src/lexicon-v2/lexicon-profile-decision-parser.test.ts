import { beforeEach, describe, expect, it } from '@jest/globals';
import { parseLexiconProfileDecision } from './lexicon-profile-decision-parser';
import { resetLexiconProfileRegistryCache } from './profile-registry';

const ctx = { currentPrimary: 'general', finalizedTurnCount: 5 };

describe('lexicon-profile-decision-parser', () => {
  beforeEach(() => {
    resetLexiconProfileRegistryCache();
  });
  it('parses valid LLM JSON', () => {
    const decision = parseLexiconProfileDecision(
      {
        summary: 'Travel context with airport and hotel',
        primaryDomain: 'travel',
        secondaryDomains: ['transport'],
        confidence: 0.86,
        shouldSwitch: true,
        reason: ['airport', 'hotel'],
        effectiveFromTurn: 6,
      },
      ctx
    );
    expect(decision?.primaryDomain).toBe('travel');
    expect(decision?.secondaryDomains).toEqual(['transport']);
    expect(decision?.shouldSwitch).toBe(true);
  });

  it('discards unknown domain', () => {
    const decision = parseLexiconProfileDecision(
      {
        summary: 'x',
        primaryDomain: 'unknown_domain',
        secondaryDomains: [],
        confidence: 0.9,
        shouldSwitch: true,
        reason: [],
      },
      ctx
    );
    expect(decision).toBeNull();
  });

  it('discards general as primary', () => {
    const decision = parseLexiconProfileDecision(
      {
        summary: 'x',
        primaryDomain: 'general',
        secondaryDomains: [],
        confidence: 0.9,
        shouldSwitch: false,
        reason: [],
      },
      ctx
    );
    expect(decision).toBeNull();
  });

  it('discards invalid schema (bad confidence)', () => {
    const decision = parseLexiconProfileDecision(
      {
        summary: 'x',
        primaryDomain: 'travel',
        secondaryDomains: [],
        confidence: 2,
        shouldSwitch: true,
        reason: [],
      },
      ctx
    );
    expect(decision).toBeNull();
  });

  it('discards disabled allowLLMSelect domain', () => {
    const decision = parseLexiconProfileDecision(
      {
        summary: 'x',
        primaryDomain: 'general',
        secondaryDomains: [],
        confidence: 0.9,
        shouldSwitch: true,
        reason: [],
      },
      ctx
    );
    expect(decision).toBeNull();
  });
});
