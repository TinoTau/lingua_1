import { describe, expect, it } from '@jest/globals';
import { buildAliasIndexes, lookupAliasExact } from './alias-index';
import type { HotwordEntry } from './hotword-types';

describe('alias-index', () => {
  it('builds exact alias lookup to canonical term', () => {
    const gpu: HotwordEntry = {
      id: 'hw-gpu',
      word: 'GPU',
      normalized: 'gpu',
      pinyin: [],
      priorScore: 0.92,
      frequency: 1,
      enabled: true,
      aliases: ['gpu', '显卡处理器'],
      domains: ['tech_ai'],
    };
    const { exactIndex } = buildAliasIndexes([gpu]);
    const hits = lookupAliasExact(exactIndex, 'gpu');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.hotword.word).toBe('GPU');
    expect(hits[0]?.matchedAlias).toBe('gpu');
  });
});
