import { describe, expect, it } from '@jest/globals';
import {
  assertFormalFineSpansNonOverlapping,
  generateLocalOptionsAtCursor,
  runLtrFineSpanGeneration,
} from './ltr-fine-span-generator';
import type { CoarseSpan } from '../span-assembly-shared/types';

function coarse(
  id: string,
  sylStart: number,
  sylEnd: number,
  rawStart: number,
  rawEnd: number
): CoarseSpan {
  return {
    id,
    text: '',
    rawStart,
    rawEnd,
    syllableStart: sylStart,
    syllableEnd: sylEnd,
    boundarySource: 'ime_token_boundary',
  } as CoarseSpan;
}

describe('ltr-fine-span-generator', () => {
  it('marks options that cross more than one coarse boundary as blocked', () => {
    const coarseSpans = [
      coarse('a', 0, 1, 0, 1),
      coarse('b', 1, 2, 1, 2),
      coarse('c', 2, 4, 2, 4),
    ];
    const options = generateLocalOptionsAtCursor({
      cursor: 0,
      rawText: '酒店前',
      globalSyllables: ['jiu', 'dian', 'qian'],
      coarseSpans,
    });
    const blocked = options.filter((o) => o.boundaryCrossCount > 1);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every((o) => o.blocked && o.windowSource === 'blocked')).toBe(true);
  });

  it('commits non-overlapping formal spans covering the full utterance when recall empty', () => {
    const coarseSpans = [coarse('a', 0, 3, 0, 3)];
    const result = runLtrFineSpanGeneration({
      rawText: '一二三',
      globalSyllables: ['yi', 'er', 'san'],
      coarseSpans,
      domainPriors: [],
      recallForWindows: () => [],
    });
    assertFormalFineSpansNonOverlapping(result.formalSpans);
    expect(result.trace.formalOverlapCount).toBe(0);
    expect(result.formalSpans[0]?.syllableStart).toBe(0);
    expect(result.formalSpans[result.formalSpans.length - 1]?.syllableEnd).toBe(3);
    expect(
      result.formalSpans.reduce((n, s) => n + (s.syllableEnd - s.syllableStart), 0)
    ).toBe(3);
  });

  it('selects complete cross-boundary term over empty in-span options when recall provides exact hit', () => {
    const coarseSpans = [coarse('a', 0, 1, 0, 1), coarse('b', 1, 3, 1, 3)];
    const result = runLtrFineSpanGeneration({
      rawText: '酒店台',
      globalSyllables: ['jiu', 'dian', 'tai'],
      coarseSpans,
      domainPriors: [],
      recallForWindows: (windows) => {
        const hit = windows.find((w) => w.syllableStart === 0 && w.syllableEnd === 2);
        if (!hit) return [];
        return [
          {
            candidateId: 'hotel',
            windowId: hit.windowId,
            windowSource: 'boundary_window',
            anchorCoarseSpanId: hit.anchorCoarseSpanId,
            syllableStart: 0,
            syllableEnd: 2,
            rawStart: hit.rawStart,
            rawEnd: hit.rawEnd,
            windowPinyinKey: hit.windowPinyinKey,
            candidateScore: 1,
            score: 1,
            boundaryPenalty: 0.85,
            candidateRank: 1,
            hitKind: 'exact_term',
            replacement: '酒店',
            domains: ['hotel'],
            source: 'domain_term',
            recallSource: 'exact',
            repairTarget: true,
          },
        ];
      },
    });
    expect(result.formalSpans[0]?.syllableEnd).toBe(2);
    expect(result.formalSpans[0]?.boundaryCrossCount).toBe(1);
    expect(result.formalSpans[0]?.selectionReason).toMatch(/complete_cross_boundary|complete_in_span|prior_tiebreak|shorter_exact_tiebreak|stable_tiebreak/);
  });
});
