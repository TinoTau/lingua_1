import { describe, expect, it, jest } from '@jest/globals';
import { loadNodeConfig } from '../node-config';
import {
  isFuzzyPinyinRecallEnabled,
  isWeakDomainRecallEnabled,
  shouldUseIndustryRouting,
} from './lexicon-fw-recall-config';

jest.mock('../node-config', () => ({
  loadNodeConfig: jest.fn(),
}));

jest.mock('./lexicon-runtime-v2-config', () => ({
  isLexiconRuntimeV2Enabled: () => true,
}));

describe('lexicon-fw-recall-config', () => {
  it('weak domain disables industry routing', () => {
    (loadNodeConfig as jest.Mock).mockReturnValue({
      features: {
        fwDetector: {
          useIndustryRouting: true,
          weakDomainRecallEnabled: true,
          fuzzyPinyinRecallEnabled: false,
        },
      },
    });
    expect(isWeakDomainRecallEnabled()).toBe(true);
    expect(shouldUseIndustryRouting()).toBe(false);
  });

  it('flags default off when unset', () => {
    (loadNodeConfig as jest.Mock).mockReturnValue({
      features: { fwDetector: { useIndustryRouting: false } },
    });
    expect(isWeakDomainRecallEnabled()).toBe(false);
    expect(isFuzzyPinyinRecallEnabled()).toBe(false);
  });
});
