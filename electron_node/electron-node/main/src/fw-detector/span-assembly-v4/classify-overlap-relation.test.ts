import { describe, expect, it } from '@jest/globals';
import {
  classifyOverlapRelation,
  pickCoverageParent,
  resolveCoverageParentChild,
} from './classify-overlap-relation';
import type { WindowCandidate } from './v4-types';

function makeCandidate(
  overrides: Partial<WindowCandidate> & Pick<WindowCandidate, 'candidateId' | 'replacement'>
): WindowCandidate {
  return {
    windowId: 'w1',
    windowSource: 'in_span_window',
    anchorCoarseSpanId: 'c0',
    syllableStart: 0,
    syllableEnd: 2,
    rawStart: 0,
    rawEnd: 2,
    windowPinyinKey: 'lan|mei',
    candidateScore: 1,
    score: 1,
    boundaryPenalty: 1,
    candidateRank: 1,
    hitKind: 'exact_term',
    source: 'base_term',
    recallSource: 'canonical_exact',
    repairTarget: true,
    ...overrides,
  };
}

describe('classifyOverlapRelation', () => {
  it('classifies non-overlapping candidates as COMPATIBLE', () => {
    const a = makeCandidate({ candidateId: 'a', replacement: '甲', syllableStart: 0, syllableEnd: 2 });
    const b = makeCandidate({
      candidateId: 'b',
      replacement: '乙',
      syllableStart: 2,
      syllableEnd: 4,
      rawStart: 2,
      rawEnd: 4,
    });
    expect(classifyOverlapRelation(a, b)).toBe('COMPATIBLE');
  });

  it('classifies equal overlap slice as COMPATIBLE', () => {
    const a = makeCandidate({ candidateId: 'a', replacement: '蓝莓', syllableStart: 0, syllableEnd: 2 });
    const b = makeCandidate({
      candidateId: 'b',
      replacement: '蓝莓',
      syllableStart: 0,
      syllableEnd: 2,
      score: 0.5,
    });
    expect(classifyOverlapRelation(a, b)).toBe('COMPATIBLE');
  });

  it('classifies substring containment as COVERAGE with longer parent', () => {
    const child = makeCandidate({
      candidateId: 'child',
      replacement: '蓝莓',
      syllableStart: 0,
      syllableEnd: 2,
      rawStart: 0,
      rawEnd: 2,
    });
    const parent = makeCandidate({
      candidateId: 'parent',
      replacement: '蓝莓马芬',
      syllableStart: 0,
      syllableEnd: 4,
      rawStart: 0,
      rawEnd: 4,
      windowPinyinKey: 'lan|mei|ma|fen',
    });
    expect(classifyOverlapRelation(child, parent)).toBe('COVERAGE');
    expect(pickCoverageParent(child, parent).candidateId).toBe('parent');
    expect(resolveCoverageParentChild(child, parent)).toEqual({ parent, child });
  });

  it('classifies mismatching overlap as CONFLICT', () => {
    const a = makeCandidate({
      candidateId: 'a',
      replacement: '中杯',
      syllableStart: 0,
      syllableEnd: 2,
      rawStart: 0,
      rawEnd: 2,
    });
    const b = makeCandidate({
      candidateId: 'b',
      replacement: '悲烧',
      syllableStart: 0,
      syllableEnd: 2,
      rawStart: 0,
      rawEnd: 2,
      score: 0.5,
    });
    expect(classifyOverlapRelation(a, b)).toBe('CONFLICT');
  });

  it('does not classify replacement-only containment without syllable containment as COVERAGE', () => {
    const short = makeCandidate({
      candidateId: 'short',
      replacement: '杯',
      syllableStart: 3,
      syllableEnd: 4,
      rawStart: 3,
      rawEnd: 4,
    });
    const long = makeCandidate({
      candidateId: 'long',
      replacement: '中杯',
      syllableStart: 0,
      syllableEnd: 2,
      rawStart: 0,
      rawEnd: 2,
    });
    expect(classifyOverlapRelation(short, long)).toBe('COMPATIBLE');
  });
});
