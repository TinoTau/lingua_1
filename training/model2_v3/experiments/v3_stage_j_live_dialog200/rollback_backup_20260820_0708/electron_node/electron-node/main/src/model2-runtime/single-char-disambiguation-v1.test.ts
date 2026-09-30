/**
 * SingleCharDisambiguationContractV1 wiring tests.
 * Test adapter is test-only — production default is ABSTAIN / HEAD_NOT_AVAILABLE.
 */

import { describe, expect, it } from '@jest/globals';
import type { HotwordEntry } from '../lexicon/hotword-types';
import {
  buildSingleCharCandidateSetV1,
  buildSingleCharDisambiguationRequestV1,
  compareSingleCharSetEntries,
} from '../lexicon-v2/single-char-candidate-set-v1';
import { materializeSelectedSingleCharCandidate } from './candidate-materialize';
import {
  SINGLE_CHAR_CANDIDATE_SET_CAP_V1,
  SINGLE_CHAR_DISAMBIGUATION_CONTRACT_V1,
  auxiliarySurfaceHash,
  createTestAmbiguityDeciderV1,
  productionAbstainDeciderV1,
  routeSingleCharAmbiguityV1,
  sliceSingleCharContextV1,
  type SingleCharCandidateV1,
  type SingleCharDisambiguationRequestV1,
} from './single-char-disambiguation-v1';
import type { Model2PolicyInput } from './types';

function hw(partial: Partial<HotwordEntry> & Pick<HotwordEntry, 'id' | 'word'>): HotwordEntry {
  return {
    pinyin: ['shi'],
    priorScore: 0.2,
    frequency: 1,
    enabled: true,
    tonePinyinKey: 'shi4',
    ...partial,
  };
}

function span() {
  return {
    origin_span_id: 'fs1',
    raw_start: 2,
    raw_end: 3,
    syllable_start: 2,
    syllable_end: 3,
    lexical_source: 'synthetic' as const,
  };
}

function reqFrom(cands: SingleCharCandidateV1[], extra?: Partial<SingleCharDisambiguationRequestV1>): SingleCharDisambiguationRequestV1 {
  return {
    request_id: 'r1',
    span_id: 'fs1',
    contract: SINGLE_CHAR_DISAMBIGUATION_CONTRACT_V1,
    span_surface: '是',
    span_canonical_surface: '是',
    acoustic_pinyin: 'shi',
    acoustic_tone_pinyin_key: 'shi4',
    left_context: '我',
    right_context: '的',
    candidates: cands,
    ...extra,
  };
}

describe('SingleChar candidate-set + ambiguity routing V1', () => {
  it('N=0 does not invoke ambiguity', () => {
    const r = routeSingleCharAmbiguityV1({ request: null, n_eligible: 0 });
    expect(r.invocation_count).toBe(0);
    expect(r.selected).toBeNull();
    expect(r.trace.decision).toBe('SKIP');
  });

  it('N=1 does not invoke ambiguity', () => {
    const set = buildSingleCharCandidateSetV1({
      eligible: [hw({ id: 't1', word: '是' })],
      truncated: false,
      ...span(),
    });
    expect(set).toHaveLength(0);
    const r = routeSingleCharAmbiguityV1({ request: null, n_eligible: 1 });
    expect(r.invocation_count).toBe(0);
  });

  it('N=2/3/8 invoke once; production default ABSTAIN fail-closed', () => {
    for (const n of [2, 3, 8]) {
      const eligible = Array.from({ length: n }, (_, i) =>
        hw({ id: `t${String(i).padStart(2, '0')}`, word: String.fromCodePoint(0x4e00 + i) })
      );
      const cands = buildSingleCharCandidateSetV1({ eligible, truncated: false, ...span() });
      expect(cands).toHaveLength(n);
      const request = reqFrom(cands);
      const r = routeSingleCharAmbiguityV1({
        request,
        n_eligible: n,
        decider: productionAbstainDeciderV1,
      });
      expect(r.invocation_count).toBe(1);
      expect(r.decision.decision).toBe('ABSTAIN');
      expect(r.decision.abstain_reason).toBe('HEAD_NOT_AVAILABLE');
      expect(r.selected).toBeNull();
    }
  });

  it('invalid N>cap and missing contract fail closed', () => {
    const over = Array.from({ length: 9 }, (_, i) =>
      hw({ id: `x${i}`, word: String.fromCodePoint(0x4e00 + i) })
    );
    const capped = buildSingleCharCandidateSetV1({ eligible: over, truncated: false, ...span() });
    expect(capped).toHaveLength(SINGLE_CHAR_CANDIDATE_SET_CAP_V1);
    const r = routeSingleCharAmbiguityV1({
      request: { ...reqFrom(capped), contract: 'nope' as never },
      n_eligible: 2,
    });
    expect(r.invocation_count).toBe(1);
    expect(r.decision.decision).toBe('ABSTAIN');
  });

  it('truncated page yields empty internal set (no Model2)', () => {
    const eligible = [hw({ id: 'a', word: '是' }), hw({ id: 'b', word: '事' })];
    const set = buildSingleCharCandidateSetV1({ eligible, truncated: true, ...span() });
    expect(set).toHaveLength(0);
  });

  it('deterministic order ignores input shuffle (not sqlite row order)', () => {
    const a = hw({ id: 'b', word: '事' });
    const b = hw({ id: 'a', word: '是' });
    const s1 = buildSingleCharCandidateSetV1({ eligible: [a, b], truncated: false, ...span() });
    const s2 = buildSingleCharCandidateSetV1({ eligible: [b, a], truncated: false, ...span() });
    expect(s1.map((c) => c.term_id)).toEqual(s2.map((c) => c.term_id));
    expect(s1.map((c) => c.term_id)).toEqual(['a', 'b']);
    expect(compareSingleCharSetEntries(a, b)).toBeGreaterThan(0);
  });

  it('test SELECT_TERM_ID follows permutation (no index0 bias)', () => {
    const eligible = [
      hw({ id: 'idA', word: '啊' }),
      hw({ id: 'idB', word: '吧' }),
      hw({ id: 'idC', word: '错' }),
    ];
    const abc = buildSingleCharCandidateSetV1({ eligible, truncated: false, ...span() });
    const cab = [abc[2]!, abc[0]!, abc[1]!];
    const reindexed = cab.map((c, i) => ({
      ...c,
      candidate_index: i,
      candidate_features: { ...c.candidate_features, relative_index: i, candidate_count: 3 },
    }));
    const decider = createTestAmbiguityDeciderV1({ type: 'SELECT_TERM_ID', term_id: 'idB' });
    const r1 = routeSingleCharAmbiguityV1({ request: reqFrom(abc), n_eligible: 3, decider });
    const r2 = routeSingleCharAmbiguityV1({ request: reqFrom(reindexed), n_eligible: 3, decider });
    expect(r1.selected?.term_id).toBe('idB');
    expect(r2.selected?.term_id).toBe('idB');
    expect(r1.selected?.candidate_index).not.toBe(r2.selected?.candidate_index);
  });

  it('SELECT index out of bounds → ABSTAIN', () => {
    const cands = buildSingleCharCandidateSetV1({
      eligible: [hw({ id: 'a', word: '是' }), hw({ id: 'b', word: '事' })],
      truncated: false,
      ...span(),
    });
    const r = routeSingleCharAmbiguityV1({
      request: reqFrom(cands),
      n_eligible: 2,
      decider: createTestAmbiguityDeciderV1({ type: 'SELECT_INDEX', index: 9 }),
    });
    expect(r.decision.decision).toBe('ABSTAIN');
    expect(r.decision.abstain_reason).toBe('INDEX_OUT_OF_RANGE');
    expect(r.selected).toBeNull();
  });

  it('output is always a member of the input set', () => {
    const cands = buildSingleCharCandidateSetV1({
      eligible: [hw({ id: 'a', word: '是' }), hw({ id: 'b', word: '事' })],
      truncated: false,
      ...span(),
    });
    const r = routeSingleCharAmbiguityV1({
      request: reqFrom(cands),
      n_eligible: 2,
      decider: createTestAmbiguityDeciderV1({ type: 'SELECT_TERM_ID', term_id: 'b' }),
    });
    expect(cands).toContain(r.selected);
  });

  it('duplicate identity still uses relative index; SELECT stays in set', () => {
    const eligible = [hw({ id: 'dup', word: '行' }), hw({ id: 'dup', word: '行' })];
    const cands = buildSingleCharCandidateSetV1({ eligible, truncated: false, ...span() });
    expect(cands).toHaveLength(2);
    const r = routeSingleCharAmbiguityV1({
      request: reqFrom(cands),
      n_eligible: 2,
      decider: createTestAmbiguityDeciderV1({ type: 'SELECT_INDEX', index: 1 }),
    });
    expect(r.selected?.candidate_index).toBe(1);
    expect(cands.includes(r.selected!)).toBe(true);
  });

  it('hashed surface is auxiliary; unknown placeholder hashes without char-class table', () => {
    const known = auxiliarySurfaceHash('是');
    const unk = auxiliarySurfaceHash('\uFFFD');
    expect(typeof known).toBe('number');
    expect(typeof unk).toBe('number');
    expect(unk).not.toBe(known);
  });

  it('context slices are deterministic', () => {
    const a = sliceSingleCharContextV1('左边中间右边', 2, 4);
    const b = sliceSingleCharContextV1('左边中间右边', 2, 4);
    expect(a).toEqual(b);
    expect(a.left_context).toBe('左边');
    expect(a.right_context).toBe('右边');
  });

  it('materialize SELECT reuses WindowCandidate and copies lexicon metadata', () => {
    const cands = buildSingleCharCandidateSetV1({
      eligible: [hw({ id: 'term-x', word: '度' }), hw({ id: 'term-y', word: '渡' })],
      truncated: false,
      ...span(),
    });
    const r = routeSingleCharAmbiguityV1({
      request: reqFrom(cands),
      n_eligible: 2,
      decider: createTestAmbiguityDeciderV1({ type: 'SELECT_TERM_ID', term_id: 'term-y' }),
    });
    const policy: Model2PolicyInput = {
      spanId: 'fs1',
      spanSyllables: ['du'],
      windowText: '度',
      windowPinyinKey: 'du',
      syllableStart: 2,
      syllableEnd: 3,
      rawStart: 2,
      rawEnd: 3,
      basePool: 0,
      phoneticBias: {},
      personalTerms: [],
      longTermDomainEvidence: {},
      personalTermEvidence: {},
    };
    const mats = materializeSelectedSingleCharCandidate({
      selected: r.selected!,
      policyInput: policy,
      seqStart: 0,
    });
    expect(mats).toHaveLength(1);
    expect(mats[0]!.termId).toBe('term-y');
    expect(mats[0]!.replacement).toBe('渡');
    expect(mats[0]!.source).toBe('base_term');
  });
});
