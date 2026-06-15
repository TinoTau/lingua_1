/**
 * Tone-aware recall ranking (inside Recall only).
 * Applies tone penalty to candidateScore; never removes candidates.
 */

import {
  computeToneScoreResult,
  extractToneNumbersFromKey,
  type ToneReason,
} from '../fw-detector/tone-match-score';

export type ToneRecallSortableHit = {
  hotword: {
    word: string;
    priorScore: number;
    tonePinyinKey?: string;
  };
  candidateScore: number;
  /** Per-hit tone pattern override (variant-sliced acoustic pattern). */
  acousticTonePattern?: number[];
  toneCompatible?: boolean;
  tonePenalty?: number;
  toneReason?: ToneReason;
};

export type ToneRecallSortResult<T extends ToneRecallSortableHit> = {
  hits: T[];
  recallToneCompatibleCount: number;
  /** Count of hits with tonePenalty < 1.0 (excludes no_pattern). */
  recallToneFallbackCount: number;
};

function applyToneScoreToHit<T extends ToneRecallSortableHit>(
  hit: T,
  defaultAcousticTonePattern?: number[]
): ToneScoreResultCounts {
  const pattern = hit.acousticTonePattern ?? defaultAcousticTonePattern;
  const toneResult = computeToneScoreResult(
    pattern,
    hit.hotword.tonePinyinKey ?? '',
    hit.hotword.word
  );
  hit.toneCompatible = toneResult.toneCompatible;
  hit.tonePenalty = toneResult.tonePenalty;
  hit.toneReason = toneResult.toneReason;
  hit.candidateScore *= toneResult.tonePenalty;
  return {
    matchCount: toneResult.toneReason === 'match' ? 1 : 0,
    penalizedCount: toneResult.tonePenalty < 1 ? 1 : 0,
  };
}

type ToneScoreResultCounts = {
  matchCount: number;
  penalizedCount: number;
};

export function sortRecallHitsByToneCompatibility<T extends ToneRecallSortableHit>(
  hits: T[],
  defaultAcousticTonePattern?: number[]
): ToneRecallSortResult<T> {
  const hasTonePattern =
    (defaultAcousticTonePattern?.length ?? 0) > 0 ||
    hits.some((h) => (h.acousticTonePattern?.length ?? 0) > 0);

  if (!hasTonePattern) {
    for (const hit of hits) {
      const toneResult = computeToneScoreResult(undefined, hit.hotword.tonePinyinKey ?? '', hit.hotword.word);
      hit.toneCompatible = toneResult.toneCompatible;
      hit.tonePenalty = toneResult.tonePenalty;
      hit.toneReason = toneResult.toneReason;
    }
    return {
      hits,
      recallToneCompatibleCount: 0,
      recallToneFallbackCount: 0,
    };
  }

  let recallToneCompatibleCount = 0;
  let recallToneFallbackCount = 0;

  for (const hit of hits) {
    const counts = applyToneScoreToHit(hit, defaultAcousticTonePattern);
    recallToneCompatibleCount += counts.matchCount;
    recallToneFallbackCount += counts.penalizedCount;
  }

  hits.sort((a, b) => b.candidateScore - a.candidateScore);

  return {
    hits,
    recallToneCompatibleCount,
    recallToneFallbackCount,
  };
}

export function candidateTonePatternFromKey(toneKey: string): number[] {
  return extractToneNumbersFromKey(toneKey);
}
