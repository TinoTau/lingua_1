/**
 * Phase 1 — Canonical RecallQueryKey + Utterance Fact Cache unit tests.
 */
import { describe, expect, it } from '@jest/globals';
import type { RecallSpanTopKV2Hit } from '../../lexicon-v2/recall-span-topk-v2';
import type { HotwordEntry } from '../../lexicon/hotword-types';
import {
  buildSpanV3CanonicalQuery,
  createUtteranceRecallContext,
  exactHitsFromLexiconFacts,
  lexiconFactsFromExactHits,
  normalizeDomainScope,
  normalizeToneNorm,
  releaseUtteranceRecallContext,
  serializeCanonicalRecallQueryKey,
  utteranceCacheGet,
  utteranceCacheSet,
} from './utterance-recall-cache';

function fakeHotword(word: string, id = `hw-${word}`): HotwordEntry {
  return {
    id,
    word,
    pinyinKey: 'ce|shi',
    priorScore: 1,
    domains: ['hotel'],
    repairTarget: true,
  } as HotwordEntry;
}

function fakeExactHit(word: string): RecallSpanTopKV2Hit {
  return {
    hotword: fakeHotword(word),
    phoneticScore: 1,
    candidateScore: 0.9,
    candidateScoreBreakdown: {} as RecallSpanTopKV2Hit['candidateScoreBreakdown'],
    source: 'exact',
  };
}

describe('Canonical RecallQueryKey', () => {
  it('serializes stable v2 key with sorted domains (no parentFragmentTopK)', () => {
    const q = buildSpanV3CanonicalQuery({
      pinyinKey: 'ji|chang',
      toneNorm: '',
      domainIds: ['hotel', 'airport'],
      exactTopK: 2,
      lexiconVersion: 'v3.5-table-v2',
      surfaceText: '机场',
    });
    expect(serializeCanonicalRecallQueryKey(q)).toBe(
      'v2|span_v3_bundle|ji|chang||airport,hotel|2|v3.5-table-v2|机场'
    );
  });

  it('normalizes undefined domainScope and empty tone to same key', () => {
    const a = serializeCanonicalRecallQueryKey(
      buildSpanV3CanonicalQuery({
        pinyinKey: 'a|b',
        toneNorm: normalizeToneNorm(undefined),
        domainIds: undefined as unknown as string[],
        exactTopK: 2,
        lexiconVersion: 'v',
        surfaceText: '',
      })
    );
    const b = serializeCanonicalRecallQueryKey(
      buildSpanV3CanonicalQuery({
        pinyinKey: 'a|b',
        toneNorm: '',
        domainIds: [],
        exactTopK: 2,
        lexiconVersion: 'v',
        surfaceText: '',
      })
    );
    expect(a).toBe(b);
    expect(normalizeDomainScope(undefined)).toEqual([]);
  });

  it('does not share keys across tone / domainScope / topK / surfaceText', () => {
    const base = {
      pinyinKey: 'jiu|dian',
      toneNorm: '',
      domainIds: ['hotel'] as string[],
      exactTopK: 2,
      lexiconVersion: 'v',
      surfaceText: '酒店',
    };
    const k0 = serializeCanonicalRecallQueryKey(buildSpanV3CanonicalQuery(base));
    const kTone = serializeCanonicalRecallQueryKey(
      buildSpanV3CanonicalQuery({ ...base, toneNorm: normalizeToneNorm([1, 2]) })
    );
    const kDom = serializeCanonicalRecallQueryKey(
      buildSpanV3CanonicalQuery({ ...base, domainIds: ['airport'] })
    );
    const kTop = serializeCanonicalRecallQueryKey(
      buildSpanV3CanonicalQuery({ ...base, exactTopK: 4 })
    );
    const kSurf = serializeCanonicalRecallQueryKey(
      buildSpanV3CanonicalQuery({ ...base, surfaceText: '酒 店' })
    );
    expect(new Set([k0, kTone, kDom, kTop, kSurf]).size).toBe(5);
  });

  it('excludes windowId from key', () => {
    const key = serializeCanonicalRecallQueryKey(
      buildSpanV3CanonicalQuery({
        pinyinKey: 'x',
        toneNorm: '',
        domainIds: [],
        exactTopK: 2,
        lexiconVersion: 'v',
        surfaceText: '字',
      })
    );
    expect(key.includes('window')).toBe(false);
    expect(key.startsWith('v2|')).toBe(true);
  });
});

describe('UtteranceRecallContext Fact cache', () => {
  it('same key hits cache; empty results are cacheable', () => {
    const ctx = createUtteranceRecallContext('v-test');
    const key = 'v2|span_v3_bundle|a|b|||2|v-test|';
    expect(utteranceCacheGet(ctx, key)).toBeUndefined();
    expect(ctx.stats.missCount).toBe(1);
    expect(ctx.stats.uniqueKeyCount).toBe(1);

    utteranceCacheSet(ctx, key, Object.freeze([]));
    const hit = utteranceCacheGet(ctx, key);
    expect(hit).toEqual([]);
    expect(ctx.stats.hitCount).toBe(1);
    expect(ctx.stats.duplicateKeyCount).toBe(1);
    expect(ctx.stats.requestCount).toBe(2);
    releaseUtteranceRecallContext(ctx);
    expect(ctx.cache.size).toBe(0);
  });

  it('window mutation does not pollute Fact cache', () => {
    const ctx = createUtteranceRecallContext('v-test');
    const key = 'k1';
    const facts = lexiconFactsFromExactHits([fakeExactHit('测试')]);
    utteranceCacheSet(ctx, key, facts);

    const rebound = exactHitsFromLexiconFacts(utteranceCacheGet(ctx, key)!);
    rebound[0].candidateScore = 0.1;
    rebound[0].hotword.word = '污染';

    const again = exactHitsFromLexiconFacts(utteranceCacheGet(ctx, key)!);
    expect(again[0].candidateScore).toBe(0.9);
    expect(again[0].hotword.word).toBe('测试');
    expect(facts[0].word).toBe('测试');
  });

  it('does not cache on caller-side exception path (set never called)', () => {
    const ctx = createUtteranceRecallContext('v-test');
    const key = 'throw-key';
    utteranceCacheGet(ctx, key);
    expect(ctx.cache.has(key)).toBe(false);
    expect(ctx.stats.missCount).toBe(1);
  });

  it('records unique vs duplicate without physical set on second miss path identity', () => {
    const ctx = createUtteranceRecallContext('v-test');
    const key = 'dup';
    utteranceCacheGet(ctx, key);
    utteranceCacheSet(ctx, key, lexiconFactsFromExactHits([fakeExactHit('a')]));
    utteranceCacheGet(ctx, key);
    utteranceCacheGet(ctx, key);
    expect(ctx.stats.uniqueKeyCount).toBe(1);
    expect(ctx.stats.duplicateKeyCount).toBe(2);
    expect(ctx.stats.hitCount).toBe(2);
    expect(ctx.stats.missCount).toBe(1);
  });
});
