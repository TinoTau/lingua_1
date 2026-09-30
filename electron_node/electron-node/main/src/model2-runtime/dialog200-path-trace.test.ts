import { describe, expect, it } from '@jest/globals';
import {
  compactCandidate,
  isDialog200PathTraceEnabled,
  profileInputSummary,
} from './dialog200-path-trace';
import type { WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';

describe('dialog200 path trace (observation-only)', () => {
  it('TRACE_OFF by default', () => {
    delete process.env.MODEL2_DIALOG200_TRACE;
    expect(isDialog200PathTraceEnabled()).toBe(false);
  });

  it('TRACE_ON only when env is exactly 1', () => {
    process.env.MODEL2_DIALOG200_TRACE = 'true';
    expect(isDialog200PathTraceEnabled()).toBe(false);
    process.env.MODEL2_DIALOG200_TRACE = '1';
    expect(isDialog200PathTraceEnabled()).toBe(true);
    delete process.env.MODEL2_DIALOG200_TRACE;
  });

  it('compactCandidate copies fields and does not mutate input', () => {
    const c: WindowCandidate = {
      candidateId: 'c1',
      windowId: '0:2',
      windowSource: 'in_span_window',
      anchorCoarseSpanId: 'a',
      syllableStart: 0,
      syllableEnd: 2,
      rawStart: 0,
      rawEnd: 2,
      windowPinyinKey: 'na|tie',
      candidateScore: 1,
      score: 0.9,
      boundaryPenalty: 1,
      candidateRank: 1,
      hitKind: 'exact_term',
      replacement: '拿铁',
      termId: 't1',
      domains: ['cafe'],
      source: 'base_term',
      recallSource: 'lexicon_pinyin_topk',
      repairTarget: false,
      retrievalProvenance: 'BASE_FUZZY',
    };
    const snap = compactCandidate(c, 1);
    expect(snap.surface).toBe('拿铁');
    expect(snap.termId).toBe('t1');
    expect(snap.domains).toEqual(['cafe']);
    expect(snap.candidateId).toBe('c1');
    expect(snap.originSpanId).toBeNull();
    expect(snap.rawStart).toBe(0);
    expect(snap.rawEnd).toBe(2);
    expect(snap.syllableStart).toBe(0);
    expect(snap.syllableEnd).toBe(2);
    expect(snap.hitKind).toBe('exact_term');
    expect(snap.repairTarget).toBe(false);
    expect(snap.retrievalId).toBeNull();
    expect(snap.provenance).toBe('BASE_FUZZY');
    snap.domains.push('mutated');
    expect(c.domains).toEqual(['cafe']);
  });

  it('empty profile summary does not invent a default profile', () => {
    expect(profileInputSummary(null).profile_present).toBe(false);
    expect(profileInputSummary(undefined).injected_default).toBe(false);
  });
});
