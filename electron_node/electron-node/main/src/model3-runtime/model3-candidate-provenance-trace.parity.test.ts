/**
 * TRACE-ONLY parity tests for candidate provenance collector.
 * No business-path integration; recording must not mutate caller inputs.
 */

import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import type { WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';
import {
  beginPathProvenance,
  classifyMergeDropReasons,
  isCandidateProvenanceTraceEnabled,
  recordMaterialized,
  recordMergePerSpan,
  recordPostRetryWorking,
  resetCandidateProvenanceCollectorForTests,
  takePathProvenance,
} from './model3-candidate-provenance-trace';

function makeCand(partial: Partial<WindowCandidate> & { candidateId: string; replacement: string }): WindowCandidate {
  return {
    candidateId: partial.candidateId,
    windowId: partial.windowId ?? '0:1',
    windowSource: partial.windowSource ?? 'in_span_window',
    anchorCoarseSpanId: partial.anchorCoarseSpanId ?? 'a',
    originSpanId: partial.originSpanId ?? 'span1',
    syllableStart: partial.syllableStart ?? 0,
    syllableEnd: partial.syllableEnd ?? 1,
    rawStart: partial.rawStart ?? 0,
    rawEnd: partial.rawEnd ?? 1,
    windowPinyinKey: partial.windowPinyinKey ?? 'na',
    candidateScore: partial.candidateScore ?? 1,
    score: partial.score ?? 1,
    boundaryPenalty: 1,
    candidateRank: partial.candidateRank ?? 1,
    hitKind: 'exact_term',
    replacement: partial.replacement,
    termId: partial.termId,
    domains: partial.domains,
    source: partial.source ?? 'base_term',
    recallSource: partial.recallSource ?? 'lexicon_pinyin_topk',
    repairTarget: false,
  };
}

describe('model3-candidate-provenance-trace parity', () => {
  const prev = process.env.MODEL3_CANDIDATE_PROVENANCE_TRACE;

  beforeEach(() => {
    resetCandidateProvenanceCollectorForTests();
    delete process.env.MODEL3_CANDIDATE_PROVENANCE_TRACE;
  });

  afterEach(() => {
    resetCandidateProvenanceCollectorForTests();
    if (prev === undefined) delete process.env.MODEL3_CANDIDATE_PROVENANCE_TRACE;
    else process.env.MODEL3_CANDIDATE_PROVENANCE_TRACE = prev;
  });

  it('enabled flag defaults false', () => {
    expect(isCandidateProvenanceTraceEnabled()).toBe(false);
    process.env.MODEL3_CANDIDATE_PROVENANCE_TRACE = 'true';
    expect(isCandidateProvenanceTraceEnabled()).toBe(false);
    process.env.MODEL3_CANDIDATE_PROVENANCE_TRACE = '1';
    expect(isCandidateProvenanceTraceEnabled()).toBe(true);
  });

  it('recording helpers copy data and do not mutate input arrays', () => {
    process.env.MODEL3_CANDIDATE_PROVENANCE_TRACE = '1';
    const domains = ['cafe'];
    const cands = [
      makeCand({ candidateId: 'c1', replacement: '拿铁', domains, candidateScore: 2 }),
      makeCand({ candidateId: 'c2', replacement: '那贴', domains, candidateScore: 1, termId: 't2' }),
    ];
    const beforeLen = cands.length;
    beginPathProvenance('p1');
    recordMaterialized('p1', 'r1', cands);
    recordPostRetryWorking('p1', cands);
    const snap = takePathProvenance('p1');
    expect(snap).not.toBeNull();
    expect(cands.length).toBe(beforeLen);
    expect(cands[0]!.domains).toEqual(['cafe']);
    snap!.materialized[0]!.candidates[0]!.domains = [...snap!.materialized[0]!.candidates[0]!.domains, 'mutated'];
    expect(cands[0]!.domains).toEqual(['cafe']);
    expect(domains).toEqual(['cafe']);
  });

  it('merge drop reason classification: DEDUP_EQUIVALENT and RANK_LIMIT', () => {
    const before = [
      makeCand({ candidateId: 'b1', replacement: '甲', termId: 'same', candidateScore: 5 }),
      makeCand({ candidateId: 'b2', replacement: '乙', termId: 'b2', candidateScore: 4 }),
    ];
    const retry = [
      makeCand({ candidateId: 'r1', replacement: '甲重', termId: 'same', candidateScore: 9 }),
      makeCand({ candidateId: 'r2', replacement: '丙', termId: 'r2', candidateScore: 3 }),
      makeCand({ candidateId: 'r3', replacement: '丁', termId: 'r3', candidateScore: 2 }),
    ];
    // Mirror merge: existing-first dedup → sort → slice(2)
    // kept keys: same(b1 score5), b2(score4); r2/r3 rank-dropped; r1 deduped
    const after = [
      makeCand({ candidateId: 'b1', replacement: '甲', termId: 'same', candidateScore: 5 }),
      makeCand({ candidateId: 'b2', replacement: '乙', termId: 'b2', candidateScore: 4 }),
    ];
    const removed = classifyMergeDropReasons(before, retry, after, 2);
    const byId = new Map(removed.map((r) => [r.id, r.reason]));
    expect(byId.get('r1')).toBe('DEDUP_EQUIVALENT');
    expect(byId.get('r2')).toBe('RANK_LIMIT');
    expect(byId.get('r3')).toBe('RANK_LIMIT');
    expect(byId.has('b1')).toBe(false);
    expect(byId.has('b2')).toBe(false);
  });

  it('recordMergePerSpan stores classified removals without mutating inputs', () => {
    process.env.MODEL3_CANDIDATE_PROVENANCE_TRACE = '1';
    const before = [makeCand({ candidateId: 'b1', replacement: '甲', termId: 't1', candidateScore: 1 })];
    const retry = [
      makeCand({ candidateId: 'r1', replacement: '甲', termId: 't1', candidateScore: 9 }),
      makeCand({ candidateId: 'r2', replacement: '乙', termId: 't2', candidateScore: 0.5 }),
    ];
    const after = [makeCand({ candidateId: 'b1', replacement: '甲', termId: 't1', candidateScore: 1 })];
    const beforeCopy = [...before];
    beginPathProvenance('p2');
    recordMergePerSpan('p2', 'spanA', before, retry, after, 1);
    expect(before).toEqual(beforeCopy);
    const bag = takePathProvenance('p2');
    expect(bag!.mergePerSpan[0]!.removed.some((r) => r.reason === 'DEDUP_EQUIVALENT')).toBe(true);
    expect(bag!.mergePerSpan[0]!.removed.some((r) => r.id === 'r2' && r.reason === 'RANK_LIMIT')).toBe(
      true
    );
  });
});
