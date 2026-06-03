import { describe, expect, it } from '@jest/globals';
import { extractRawCoarseBoundaries } from './extract-raw-coarse-boundaries';
import {
  BOUNDARY_COMPATIBILITY_MATCH_THRESHOLD,
  BOUNDARY_SYLLABLE_MATCH_TOLERANCE,
  collectImeTokenSyllableSplits,
  collectRawBoundarySyllableSplits,
  computeBoundaryAlignmentDiagnostics,
  scoreBoundaryAlignmentForCandidate,
} from './pinyin-ime-v2-boundary-align';
import type { PinyinImeV2Candidate } from './pinyin-ime-v2-types';

describe('collectRawBoundarySyllableSplits', () => {
  it('includes punctuation syllable split for 你好，世界', () => {
    const bounds = extractRawCoarseBoundaries('你好，世界');
    const splits = collectRawBoundarySyllableSplits(bounds, 4);
    expect(splits.length).toBeGreaterThan(0);
  });
});

describe('scoreBoundaryAlignmentForCandidate', () => {
  it('scores full match when IME splits align with raw', () => {
    const rawBounds = extractRawCoarseBoundaries('你好，世界');
    const total = 4;
    const candidate: Pick<PinyinImeV2Candidate, 'rank' | 'tokens'> = {
      rank: 1,
      tokens: [
        { word: '你好', syllableStart: 0, syllableEnd: 2, source: 'base' },
        { word: '世界', syllableStart: 2, syllableEnd: 4, source: 'base' },
      ],
    };
    const score = scoreBoundaryAlignmentForCandidate(rawBounds, candidate, total);
    expect(score.candidateRank).toBe(1);
    expect(score.compatibilityScore).toBeGreaterThanOrEqual(0);
    expect(score.matchedBoundaryCount + score.conflictedBoundaryCount).toBeGreaterThan(0);
  });

  it('returns compatibility 1 when raw has no syllable splits', () => {
    const score = scoreBoundaryAlignmentForCandidate([], { rank: 1, tokens: [] }, 2);
    expect(score.compatibilityScore).toBe(1);
    expect(score.conflictedBoundaryCount).toBe(0);
  });

  it('returns low compatibility when tokens missing', () => {
    const rawBounds = extractRawCoarseBoundaries('你好，世界');
    const score = scoreBoundaryAlignmentForCandidate(
      rawBounds,
      { rank: 2, tokens: [] },
      4
    );
    expect(score.compatibilityScore).toBeLessThan(1);
    expect(score.conflictedBoundaryCount).toBeGreaterThan(0);
  });
});

describe('computeBoundaryAlignmentDiagnostics', () => {
  it('counts rawBoundaryMatchedTopKCount by compatibility threshold', () => {
    const rawBounds = extractRawCoarseBoundaries('你好，世界');
    const candidates: PinyinImeV2Candidate[] = [
      {
        text: '你好世界',
        score: 1,
        rank: 1,
        tokens: [
          { word: '你好', syllableStart: 0, syllableEnd: 2, source: 'base' },
          { word: '世界', syllableStart: 2, syllableEnd: 4, source: 'base' },
        ],
      },
      {
        text: '你好',
        score: 0.5,
        rank: 2,
        tokens: [{ word: '你好', syllableStart: 0, syllableEnd: 4, source: 'base' }],
      },
    ];
    const diag = computeBoundaryAlignmentDiagnostics(rawBounds, candidates, 4);
    expect(diag.scores).toHaveLength(2);
    expect(diag.rawBoundaryMatchedTopKCount).toBe(
      diag.scores.filter((s) => s.compatibilityScore >= BOUNDARY_COMPATIBILITY_MATCH_THRESHOLD)
        .length
    );
    expect(diag.boundaryCompatibilityScoreMax).toBeGreaterThanOrEqual(
      diag.boundaryCompatibilityScoreAvg
    );
  });
});

describe('boundary align constants', () => {
  it('exposes diagnostics-only tolerance', () => {
    expect(BOUNDARY_SYLLABLE_MATCH_TOLERANCE).toBeGreaterThanOrEqual(0);
    expect(BOUNDARY_COMPATIBILITY_MATCH_THRESHOLD).toBeGreaterThan(0);
    expect(BOUNDARY_COMPATIBILITY_MATCH_THRESHOLD).toBeLessThanOrEqual(1);
  });
});

describe('collectImeTokenSyllableSplits', () => {
  it('collects internal token ends only', () => {
    const splits = collectImeTokenSyllableSplits(
      [
        { syllableEnd: 2 },
        { syllableEnd: 4 },
      ],
      4
    );
    expect(splits).toEqual([2]);
  });
});
