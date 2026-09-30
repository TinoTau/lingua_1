import { describe, expect, it } from '@jest/globals';
import {
  domainHitBindingStatus,
  domainHitMatchesOriginSpanRange,
  materializeDomainHits,
  pinyinSyllableCount,
} from './candidate-materialize';
import type { Model2DomainHit, Model2PolicyInput } from './types';

function policy(partial: Partial<Model2PolicyInput> & { spanId: string }): Model2PolicyInput {
  return {
    spanSyllables: ['bang'],
    windowText: '帮',
    windowPinyinKey: 'bang',
    syllableStart: 2,
    syllableEnd: 3,
    rawStart: 2,
    rawEnd: 3,
    basePool: 0,
    phoneticBias: {},
    personalTerms: [],
    longTermDomainEvidence: {},
    personalTermEvidence: {},
    ...partial,
  };
}

function hit(partial: Partial<Model2DomainHit> & { surface: string; pinyin_key: string }): Model2DomainHit {
  return {
    term_id: partial.term_id || `t:${partial.surface}`,
    sqlite_term_id: partial.sqlite_term_id || `sql:${partial.surface}`,
    domain_ids: partial.domain_ids || ['milk_tea'],
    prior_score: partial.prior_score ?? 0.9,
    ...partial,
  };
}

describe('Model2 D origin-span binding contract', () => {
  it('counts pinyin syllables on |', () => {
    expect(pinyinSyllableCount('da|bei')).toBe(2);
    expect(pinyinSyllableCount('bang')).toBe(1);
    expect(pinyinSyllableCount('')).toBe(0);
  });

  it('rejects 2-char 大杯 bound to 1-char FineSpan 帮', () => {
    const origin = policy({ spanId: 'fine:d002:2' });
    expect(domainHitMatchesOriginSpanRange(hit({ surface: '大杯', pinyin_key: 'da|bei' }), origin)).toBe(
      false
    );
    expect(domainHitBindingStatus(hit({ surface: '大杯', pinyin_key: 'da|bei' }), origin)).toBe(
      'REJECTED_RANGE_INCONSISTENT'
    );
    const mats = materializeDomainHits({
      hits: [hit({ surface: '大杯', pinyin_key: 'da|bei', sqlite_term_id: 'term-dacup' })],
      policyInput: origin,
      actionId: 'domain_soft:milk_tea',
      seqStart: 0,
      retrievalId: 'r:d',
    });
    expect(mats).toEqual([]);
  });

  it('binds 2-char term only to the originating 2-char FineSpan', () => {
    const origin = policy({
      spanId: 'fine:ok:9',
      spanSyllables: ['da', 'bei'],
      windowText: '大背',
      windowPinyinKey: 'da|bei',
      syllableStart: 11,
      syllableEnd: 13,
      rawStart: 11,
      rawEnd: 13,
    });
    const mats = materializeDomainHits({
      hits: [hit({ surface: '大杯', pinyin_key: 'da|bei', sqlite_term_id: 'term-dacup', prior_score: 0.88 })],
      policyInput: origin,
      actionId: 'domain_soft:milk_tea',
      seqStart: 1,
      retrievalId: 'r:d',
    });
    expect(mats).toHaveLength(1);
    expect(mats[0]?.replacement).toBe('大杯');
    expect(mats[0]?.candidateId).toBe('m2d:fine:ok:9:2');
    expect(mats[0]?.originSpanId).toBe('fine:ok:9');
    expect(mats[0]?.syllableStart).toBe(11);
    expect(mats[0]?.syllableEnd).toBe(13);
    expect(mats[0]?.rawStart).toBe(11);
    expect(mats[0]?.rawEnd).toBe(13);
    expect(mats[0]?.score).toBe(0.88);
    expect(mats[0]?.windowPinyinKey).toBe('da|bei');
    expect(mats[0]?.retrievalId).toBe('r:d');
  });

  it('does not rebind a mismatched hit onto a different FineSpan', () => {
    const iterator = policy({ spanId: 'fine:bang' });
    const otherTwoChar = policy({
      spanId: 'fine:dabei',
      spanSyllables: ['da', 'bei'],
      windowText: '大背',
      windowPinyinKey: 'da|bei',
      syllableStart: 11,
      syllableEnd: 13,
      rawStart: 11,
      rawEnd: 13,
    });
    const mats = materializeDomainHits({
      hits: [hit({ surface: '大杯', pinyin_key: 'da|bei' })],
      policyInput: iterator,
      actionId: 'domain_soft:milk_tea',
      seqStart: 0,
    });
    expect(mats).toEqual([]);
    expect(otherTwoChar.spanId).toBe('fine:dabei');
  });

  it('preserves surface/score/range for length-consistent hits', () => {
    const origin = policy({
      spanId: 'fine:1c',
      spanSyllables: ['bei'],
      windowText: '杯',
      windowPinyinKey: 'bei',
      syllableStart: 6,
      syllableEnd: 7,
      rawStart: 7,
      rawEnd: 8,
    });
    const h = hit({
      surface: '杯',
      pinyin_key: 'bei',
      sqlite_term_id: 'term-bei',
      prior_score: 0.77,
      domain_ids: ['coffee'],
    });
    const mats = materializeDomainHits({
      hits: [h],
      policyInput: origin,
      actionId: 'domain_soft:coffee',
      seqStart: 3,
    });
    expect(mats).toHaveLength(1);
    expect(mats[0]?.replacement).toBe('杯');
    expect(mats[0]?.score).toBe(0.77);
    expect(mats[0]?.candidateScore).toBe(0.77);
    expect(mats[0]?.syllableStart).toBe(6);
    expect(mats[0]?.syllableEnd).toBe(7);
    expect(mats[0]?.originSpanId).toBe('fine:1c');
    expect(mats[0]?.candidateId.startsWith('m2d:fine:1c:')).toBe(true);
  });

  it('regression: d031 预订 must not bind to 1-char 大', () => {
    const origin = policy({
      spanId: 'fine:d031:5',
      spanSyllables: ['da'],
      windowText: '大',
      windowPinyinKey: 'da',
      syllableStart: 5,
      syllableEnd: 6,
      rawStart: 5,
      rawEnd: 6,
    });
    const mats = materializeDomainHits({
      hits: [hit({ surface: '预订', pinyin_key: 'yu|ding', sqlite_term_id: 'term-yuding' })],
      policyInput: origin,
      actionId: 'domain_soft:tourism_route',
      seqStart: 8,
    });
    expect(mats).toEqual([]);
  });
});
