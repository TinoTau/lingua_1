import { describe, expect, it, beforeEach } from '@jest/globals';
import {
  resetPinyinImeV2DictCacheForTest,
  resolvePinyinImeV2Spans,
} from './resolve-pinyin-ime-v2-spans';
import { defaultGeneralProfile } from '../../lexicon-v2/profile-registry';

describe('resolvePinyinImeV2Spans', () => {
  beforeEach(() => {
    resetPinyinImeV2DictCacheForTest();
  });

  it('returns empty spans when IME disabled', () => {
    const result = resolvePinyinImeV2Spans({
      rawText: '你好',
      profile: defaultGeneralProfile(),
      enabledDomains: [],
      minPrior: 0.5,
      imeConfig: {
        enabled: false,
        topK: 5,
        maxApprovedSpans: 4,
        minSupportCount: 2,
        minSpanChars: 2,
        maxSpanChars: 6,
        minSyllables: 2,
        maxSyllables: 5,
        directRepair: false,
        dictDir: '<test>',
        enabledDomains: [],
      },
    });
    expect(result.spans).toEqual([]);
    expect(result.pinyinImeV2.skippedReason).toBe('no_selected_spans');
  });

  it('returns ime_dict_unavailable when dict dir missing', () => {
    const result = resolvePinyinImeV2Spans({
      rawText: '你好世界',
      profile: defaultGeneralProfile(),
      enabledDomains: [],
      minPrior: 0.5,
      imeConfig: {
        enabled: true,
        topK: 5,
        maxApprovedSpans: 4,
        minSupportCount: 2,
        minSpanChars: 2,
        maxSpanChars: 6,
        minSyllables: 2,
        maxSyllables: 5,
        directRepair: false,
        dictDir: '/nonexistent/pinyin-ime-v2/dict',
        enabledDomains: [],
      },
    });
    expect(result.spans).toEqual([]);
    expect(result.pinyinImeV2.skippedReason).toBe('ime_dict_unavailable');
    expect(result.pinyinImeV2.loadError).toBeDefined();
  });
});
