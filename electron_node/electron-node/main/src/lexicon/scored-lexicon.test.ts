import { describe, expect, it } from '@jest/globals';
import {
  assertV5ManifestReady,
  buildManifestStats,
  initialPriorScoreFromFrequency,
  isIndexableHotwordEntry,
  isMixedLatinToken,
  parseTagsField,
  SCORED_LEXICON_VERSION,
} from './scored-lexicon';
import type { HotwordEntry } from './hotword-types';

function entry(partial: Partial<HotwordEntry> & Pick<HotwordEntry, 'id' | 'word'>): HotwordEntry {
  return {
    pinyin: ['a'],
    priorScore: 5,
    frequency: 10,
    enabled: true,
    ...partial,
  };
}

describe('scored-lexicon', () => {
  it('initialPriorScoreFromFrequency is monotonic', () => {
    expect(initialPriorScoreFromFrequency(10)).toBeGreaterThan(initialPriorScoreFromFrequency(1));
  });

  it('parseTagsField parses json array', () => {
    expect(parseTagsField('["technical","asr"]')).toEqual(['technical', 'asr']);
  });

  it('isMixedLatinToken detects GPU not 候选', () => {
    expect(isMixedLatinToken('GPU')).toBe(true);
    expect(isMixedLatinToken('候选生成')).toBe(false);
  });

  it('isIndexableHotwordEntry requires enabled, priorScore, pinyin', () => {
    expect(
      isIndexableHotwordEntry(
        entry({ id: '1', word: 'x', enabled: false, priorScore: 5, pinyin: ['a'] })
      )
    ).toBe(false);
    expect(
      isIndexableHotwordEntry(entry({ id: '2', word: 'y', priorScore: 0, pinyin: ['a'] }))
    ).toBe(false);
    expect(
      isIndexableHotwordEntry(entry({ id: '3', word: 'z', priorScore: 5, pinyin: [] }))
    ).toBe(false);
    expect(
      isIndexableHotwordEntry(entry({ id: '4', word: 'w', priorScore: 3, pinyin: ['hou'] }))
    ).toBe(true);
  });

  it('buildManifestStats and assertV5ManifestReady', () => {
    const rows = [
      entry({ id: '1', word: 'GPU', pinyin: ['ji', 'pu', 'you'], priorScore: 6 }),
      entry({ id: '2', word: '无', priorScore: 0, pinyin: [] }),
    ];
    const indexable = rows.filter(isIndexableHotwordEntry);
    const stats = buildManifestStats(rows, indexable, 1);
    expect(stats.scored_lexicon_version).toBe(SCORED_LEXICON_VERSION);
    expect(stats.terms_without_prior_count).toBe(1);
    expect(stats.mixed_token_count).toBe(1);
    expect(() =>
      assertV5ManifestReady({
        version: 'v5',
        checksum: 'x',
        createdAt: 't',
        backend: 'sqlite',
        scored_lexicon_version: SCORED_LEXICON_VERSION,
        terms_without_prior_count: 1,
      })
    ).toThrow();
  });
});
