import { describe, expect, it } from '@jest/globals';
import {
  coverageRatio,
  hasCoverageHole,
  isRuleBRejectedByHole,
  mergeMatchedIntervals,
  passesRuleA,
  passesRuleB,
} from './parent-term-coverage';
import type { ParentTermEvidence } from './types';

function makeEvidence(start: number, end: number): ParentTermEvidence {
  return {
    coarseSpanId: 's0',
    parentTermId: 'p1',
    parentTerm: '蓝莓马芬',
    parentPinyinKey: 'lan|mei|ma|fen',
    parentTermSyllableCount: 4,
    score: 0.8,
    repairTarget: true,
    matchedTermStart: start,
    matchedTermEnd: end,
    rawStart: 0,
    rawEnd: 2,
    windowSyllableStart: start,
    windowSyllableEnd: end,
    source: 'domain_term',
  };
}

describe('parent-term-coverage', () => {
  it('merges overlapping intervals without hole', () => {
    const intervals = mergeMatchedIntervals([
      makeEvidence(0, 2),
      makeEvidence(1, 3),
      makeEvidence(2, 4),
    ]);
    expect(intervals).toEqual([{ start: 0, end: 4 }]);
    expect(hasCoverageHole(intervals, 4)).toBe(false);
    expect(passesRuleA(intervals, 4)).toBe(true);
  });

  it('detects hole between intervals', () => {
    const intervals = mergeMatchedIntervals([makeEvidence(0, 2), makeEvidence(3, 4)]);
    expect(hasCoverageHole(intervals, 4)).toBe(true);
    expect(passesRuleA(intervals, 4)).toBe(false);
  });

  it('Rule B passes when Rule A fails but coverage or evidence count suffices', () => {
    const partial = mergeMatchedIntervals([makeEvidence(0, 2), makeEvidence(3, 4)]);
    expect(passesRuleA(partial, 4)).toBe(false);
    expect(passesRuleB(partial, 4, 2)).toBe(false);
    expect(isRuleBRejectedByHole(partial, 4, 2)).toBe(true);
    expect(coverageRatio(partial, 4)).toBe(0.75);
  });

  it('Rule B passes without hole', () => {
    const partial = mergeMatchedIntervals([makeEvidence(0, 2), makeEvidence(2, 3)]);
    expect(passesRuleA(partial, 4)).toBe(false);
    expect(passesRuleB(partial, 4, 2)).toBe(true);
  });
});
