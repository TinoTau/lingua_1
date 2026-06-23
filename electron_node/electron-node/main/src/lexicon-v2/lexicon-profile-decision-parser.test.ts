import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  classifyLexiconIntentParseFailure,
  parseLexiconProfileDecision,
} from './lexicon-profile-decision-parser';
import { resetLexiconProfileRegistryCache } from './profile-registry';
import {
  resetRuntimeDomainRegistryForTest,
  setRuntimeDomainRegistry,
  type RuntimeDomainRegistry,
} from './runtime-domain-registry';

const ctx = { currentPrimary: 'general', finalizedTurnCount: 5 };

const mockRegistry: RuntimeDomainRegistry = {
  availableFineDomains: ['coffee', 'milk_tea', 'bakery', 'food_order'],
  availableCoarseDomains: ['restaurant'],
  llmAllowedDomains: ['restaurant'],
  fineToCoarseMap: {
    coffee: 'restaurant',
    milk_tea: 'restaurant',
    bakery: 'restaurant',
    food_order: 'restaurant',
  },
  coarseToFineMap: {
    restaurant: ['coffee', 'milk_tea', 'bakery', 'food_order'],
  },
  domainHierarchyVersion: 'test',
};

describe('lexicon-profile-decision-parser', () => {
  beforeEach(() => {
    resetLexiconProfileRegistryCache();
    resetRuntimeDomainRegistryForTest();
    setRuntimeDomainRegistry(mockRegistry);
  });

  it('parses valid coarse LLM JSON', () => {
    const decision = parseLexiconProfileDecision(
      {
        summary: 'Restaurant context',
        primaryDomain: 'restaurant',
        secondaryDomains: [],
        confidence: 0.86,
        shouldSwitch: true,
        reason: ['menu'],
        effectiveFromTurn: 6,
        topicKeywords: ['菜单'],
      },
      ctx
    );
    expect(decision?.primaryDomain).toBe('restaurant');
  });

  it('PAR-01: rejects fine primary with schema_invalid classification', () => {
    const decision = parseLexiconProfileDecision(
      {
        summary: 'x',
        primaryDomain: 'coffee',
        secondaryDomains: [],
        confidence: 0.9,
        shouldSwitch: true,
        reason: [],
      },
      ctx
    );
    expect(decision).toBeNull();
    expect(
      classifyLexiconIntentParseFailure({ primaryDomain: 'coffee', confidence: 0.9 }, ctx)
    ).toBe('schema_invalid');
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
});
