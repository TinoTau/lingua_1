import { describe, expect, it } from '@jest/globals';
import {
  buildBoundaryCompatibleTopKDiff,
  countTokenSourceConflictDiagnostic,
  selectTrustedTopKCandidates,
  syllableRangeToRawCharRange,
} from './pinyin-ime-v2-boundary-compatible-topk-diff';
import { buildCharSyllableRanges } from './pinyin-ime-v2-pinyin-stream';
import type { BoundaryAlignmentScore, PinyinImeV2Candidate } from './pinyin-ime-v2-types';

function score(rank: number, compat: number): BoundaryAlignmentScore {
  return {
    candidateRank: rank,
    matchedBoundaryCount: 1,
    conflictedBoundaryCount: 0,
    compatibilityScore: compat,
  };
}

describe('selectTrustedTopKCandidates', () => {
  it('keeps candidates with tokens and compatibility >= threshold, ordered by compat then rank', () => {
    const candidates: PinyinImeV2Candidate[] = [
      { text: 'a', score: 1, rank: 1, tokens: [{ word: 'x', syllableStart: 0, syllableEnd: 1, source: 'base' }] },
      { text: 'b', score: 0.9, rank: 2, tokens: [{ word: 'y', syllableStart: 0, syllableEnd: 1, source: 'base' }] },
      {
        text: 'c',
        score: 0.8,
        rank: 3,
        tokens: [{ word: 'z', syllableStart: 0, syllableEnd: 1, source: 'base' }],
      },
    ];
    const { trusted, trustedCount } = selectTrustedTopKCandidates(candidates, [
      score(1, 0.4),
      score(2, 0.9),
      score(3, 0.95),
    ]);
    expect(trustedCount).toBe(2);
    expect(trusted[0].rank).toBe(3);
    expect(trusted[1].rank).toBe(2);
  });
});

describe('buildBoundaryCompatibleTopKDiff', () => {
  it('emits span when trusted TopK disagree on token words in same syllable interval', () => {
    const rawAsrText = '候选生成';
    const candidates: PinyinImeV2Candidate[] = [
      {
        text: rawAsrText,
        score: 1,
        rank: 1,
        tokens: [
          { word: '候', syllableStart: 0, syllableEnd: 1, source: 'base' },
          { word: '选', syllableStart: 1, syllableEnd: 2, source: 'base' },
        ],
      },
      {
        text: rawAsrText,
        score: 0.9,
        rank: 2,
        tokens: [
          { word: '后', syllableStart: 0, syllableEnd: 1, source: 'base' },
          { word: '选', syllableStart: 1, syllableEnd: 2, source: 'base' },
        ],
      },
    ];
    const result = buildBoundaryCompatibleTopKDiff({
      rawAsrText,
      candidates,
      alignmentScores: [score(1, 0.8), score(2, 0.85)],
      totalSyllables: 4,
    });
    expect(result.trustedTopKCount).toBe(2);
    expect(result.spans.length).toBeGreaterThan(0);
    expect(result.spans[0].variants.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty spans when fewer than two trusted TopK', () => {
    const result = buildBoundaryCompatibleTopKDiff({
      rawAsrText: '你好',
      candidates: [
        {
          text: '你好',
          score: 1,
          rank: 1,
          tokens: [{ word: '你', syllableStart: 0, syllableEnd: 1, source: 'base' }],
        },
      ],
      alignmentScores: [score(1, 0.9)],
      totalSyllables: 2,
    });
    expect(result.spans).toEqual([]);
  });
});

describe('countTokenSourceConflictDiagnostic', () => {
  it('counts candidates with multiple token sources', () => {
    const count = countTokenSourceConflictDiagnostic([
      {
        text: 'a',
        score: 1,
        rank: 1,
        tokens: [
          { word: 'a', syllableStart: 0, syllableEnd: 1, source: 'base' },
          { word: 'b', syllableStart: 1, syllableEnd: 2, source: 'fallback' },
        ],
      },
    ]);
    expect(count).toBe(1);
  });
});

describe('syllableRangeToRawCharRange', () => {
  it('maps syllable interval to raw char offsets', () => {
    const raw = '钟贝咖啡';
    const ranges = buildCharSyllableRanges(raw);
    const pos = syllableRangeToRawCharRange(ranges, 0, 2);
    expect(pos).not.toBeNull();
    expect(pos!.start).toBeGreaterThanOrEqual(0);
    expect(pos!.end).toBeGreaterThan(pos!.start);
  });
});
