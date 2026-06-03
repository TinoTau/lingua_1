import type { RawBoundary } from './extract-raw-coarse-boundaries';
import type { BoundaryAlignmentScore, PinyinImeV2Candidate } from './pinyin-ime-v2-types';

/** Max syllable index distance for raw↔IME boundary match (diagnostics only). */
export const BOUNDARY_SYLLABLE_MATCH_TOLERANCE = 1;

/** Rank counts as "matched topK" when compatibility ≥ this (diagnostics only). */
export const BOUNDARY_COMPATIBILITY_MATCH_THRESHOLD = 0.5;

export function collectRawBoundarySyllableSplits(
  boundaries: RawBoundary[],
  totalSyllables: number
): number[] {
  if (totalSyllables <= 0) {
    return [];
  }
  const splits = new Set<number>();
  for (const b of boundaries) {
    if (b.syllableStart > 0 && b.syllableStart < totalSyllables) {
      splits.add(b.syllableStart);
    }
    if (b.syllableEnd > 0 && b.syllableEnd < totalSyllables) {
      splits.add(b.syllableEnd);
    }
  }
  return [...splits].sort((a, b) => a - b);
}

export function collectImeTokenSyllableSplits(
  tokens: { syllableEnd: number }[],
  totalSyllables: number
): number[] {
  if (totalSyllables <= 0) {
    return [];
  }
  const splits = new Set<number>();
  for (const token of tokens) {
    if (token.syllableEnd > 0 && token.syllableEnd < totalSyllables) {
      splits.add(token.syllableEnd);
    }
  }
  return [...splits].sort((a, b) => a - b);
}

function minDistanceToSplits(point: number, splits: number[]): number {
  if (!splits.length) {
    return Number.POSITIVE_INFINITY;
  }
  let min = Number.POSITIVE_INFINITY;
  for (const split of splits) {
    const d = Math.abs(split - point);
    if (d < min) {
      min = d;
    }
  }
  return min;
}

export function scoreBoundaryAlignmentForCandidate(
  rawBoundaries: RawBoundary[],
  candidate: Pick<PinyinImeV2Candidate, 'rank' | 'tokens'>,
  totalSyllables: number,
  tolerance = BOUNDARY_SYLLABLE_MATCH_TOLERANCE
): BoundaryAlignmentScore {
  const rawSplits = collectRawBoundarySyllableSplits(rawBoundaries, totalSyllables);
  const imeSplits = collectImeTokenSyllableSplits(candidate.tokens ?? [], totalSyllables);

  if (!rawSplits.length) {
    return {
      candidateRank: candidate.rank,
      matchedBoundaryCount: 0,
      conflictedBoundaryCount: 0,
      compatibilityScore: 1,
    };
  }

  let matchedBoundaryCount = 0;
  for (const rawPoint of rawSplits) {
    if (minDistanceToSplits(rawPoint, imeSplits) <= tolerance) {
      matchedBoundaryCount++;
    }
  }
  const conflictedBoundaryCount = rawSplits.length - matchedBoundaryCount;
  const compatibilityScore = matchedBoundaryCount / rawSplits.length;

  return {
    candidateRank: candidate.rank,
    matchedBoundaryCount,
    conflictedBoundaryCount,
    compatibilityScore,
  };
}

export type BoundaryAlignmentDiagnostics = {
  scores: BoundaryAlignmentScore[];
  rawBoundaryMatchedTopKCount: number;
  boundaryCompatibilityScoreMax: number;
  boundaryCompatibilityScoreAvg: number;
};

export function computeBoundaryAlignmentDiagnostics(
  rawBoundaries: RawBoundary[],
  candidates: PinyinImeV2Candidate[],
  totalSyllables: number
): BoundaryAlignmentDiagnostics {
  const scores = candidates.map((candidate) =>
    scoreBoundaryAlignmentForCandidate(rawBoundaries, candidate, totalSyllables)
  );

  const rawBoundaryMatchedTopKCount = scores.filter(
    (s) => s.compatibilityScore >= BOUNDARY_COMPATIBILITY_MATCH_THRESHOLD
  ).length;

  const boundaryCompatibilityScoreMax = scores.length
    ? Math.max(...scores.map((s) => s.compatibilityScore))
    : 0;
  const boundaryCompatibilityScoreAvg = scores.length
    ? scores.reduce((sum, s) => sum + s.compatibilityScore, 0) / scores.length
    : 0;

  return {
    scores,
    rawBoundaryMatchedTopKCount,
    boundaryCompatibilityScoreMax,
    boundaryCompatibilityScoreAvg,
  };
}
