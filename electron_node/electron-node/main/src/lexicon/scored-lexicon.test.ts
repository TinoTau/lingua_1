import { describe, expect, it } from '@jest/globals';
import {
  assertLexiconManifestReady,
  buildManifestStats,
  initialPriorScoreFromFrequency,
  isIndexableHotwordEntry,
  isMixedLatinToken,
  LEXICON_SCHEMA_VERSION,
  parseTagsField,
  SCORED_LEXICON_VERSION,
} from './scored-lexicon';
import type { HotwordEntry } from './hotword-types';

function entry(partial: Partial<HotwordEntry> & Pick<HotwordEntry, 'id' | 'word'>): HotwordEntry {
  return {
    pinyin: ['a'],
    priorScore: 0.8,
    frequency: 10,
    enabled: true,
    ...partial,
  };
}

describe('scored-lexicon', () => {
  it('initialPriorScoreFromFrequency is monotonic and within 0-1', () => {
    expect(initialPriorScoreFromFrequency(10)).toBeGreaterThan(initialPriorScoreFromFrequency(1));
    expect(initialPriorScoreFromFrequency(100)).toBeLessThanOrEqual(1);
  });

  it('parseTagsField parses json array', () => {
    expect(parseTagsField('["technical","asr"]')).toEqual(['technical', 'asr']);
  });

  it('isMixedLatinToken detects GPU not 候选', () => {
    expect(isMixedLatinToken('GPU')).toBe(true);
    expect(isMixedLatinToken('候选生成')).toBe(false);
  });

  it('isIndexableHotwordEntry requires enabled, priorScore; latin may omit pinyin', () => {
    expect(
      isIndexableHotwordEntry(
        entry({ id: '1', word: 'x', enabled: false, priorScore: 0.8, pinyin: ['a'] })
      )
    ).toBe(false);
    expect(
      isIndexableHotwordEntry(entry({ id: '2', word: 'y', priorScore: 0, pinyin: ['a'] }))
    ).toBe(false);
    expect(
      isIndexableHotwordEntry(entry({ id: '3', word: '词库', priorScore: 0.8, pinyin: [] }))
    ).toBe(false);
    expect(
      isIndexableHotwordEntry(entry({ id: '4', word: 'w', priorScore: 0.3, pinyin: ['hou'] }))
    ).toBe(true);
    expect(
      isIndexableHotwordEntry(entry({ id: '5', word: 'GPU', priorScore: 0.9, pinyin: [] }))
    ).toBe(true);
  });

  it('buildManifestStats and assertLexiconManifestReady require final-v1', () => {
    const rows = [
      entry({ id: '1', word: 'GPU', pinyin: ['ji', 'pu', 'you'], priorScore: 0.9 }),
      entry({ id: '2', word: '无', priorScore: 0, pinyin: [] }),
    ];
    const indexable = rows.filter(isIndexableHotwordEntry);
    const stats = buildManifestStats(rows, indexable, 1);
    expect(stats.scored_lexicon_version).toBe(SCORED_LEXICON_VERSION);
    expect(SCORED_LEXICON_VERSION).toBe(LEXICON_SCHEMA_VERSION);
    expect(stats.terms_without_prior_count).toBe(1);
    expect(stats.mixed_token_count).toBe(1);
    expect(() =>
      assertLexiconManifestReady({
        version: 'final',
        checksum: 'x',
        createdAt: 't',
        backend: 'sqlite',
        schemaVersion: LEXICON_SCHEMA_VERSION,
        terms_without_prior_count: 1,
      })
    ).toThrow();
    expect(() =>
      assertLexiconManifestReady({
        version: 'final',
        checksum: 'x',
        createdAt: 't',
        backend: 'sqlite',
        schemaVersion: 'v5',
        terms_without_prior_count: 0,
      })
    ).toThrow(/schemaVersion/);
  });
});
