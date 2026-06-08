/**
 * P0.5 — tone-aware recall sort (inside Recall only; no candidateScore delta).
 */

import { extractToneNumbersFromKey, isCandidateToneCompatible } from '../fw-detector/tone-match-score';

export type ToneRecallSortableHit = {
  hotword: {
    word: string;
    priorScore: number;
    tonePinyinKey?: string;
  };
  candidateScore: number;
  /** Per-hit tone pattern override (variant-sliced acoustic pattern). */
  acousticTonePattern?: number[];
};

export type ToneRecallSortResult<T extends ToneRecallSortableHit> = {
  hits: T[];
  recallToneCompatibleCount: number;
  recallToneFallbackCount: number;
};

export function sortRecallHitsByToneCompatibility<T extends ToneRecallSortableHit>(
  hits: T[],
  defaultAcousticTonePattern?: number[]
): ToneRecallSortResult<T> {
  if (!defaultAcousticTonePattern?.length && !hits.some((h) => h.acousticTonePattern?.length)) {
    return {
      hits,
      recallToneCompatibleCount: 0,
      recallToneFallbackCount: hits.length,
    };
  }

  const decorated = hits.map((hit) => {
    const pattern = hit.acousticTonePattern ?? defaultAcousticTonePattern;
    const compatible =
      pattern?.length &&
      isCandidateToneCompatible(pattern, hit.hotword.tonePinyinKey ?? '', hit.hotword.word);
    return { hit, compatible: compatible ? 1 : 0 };
  });

  decorated.sort((a, b) => {
    if (b.compatible !== a.compatible) {
      return b.compatible - a.compatible;
    }
    if (b.hit.hotword.priorScore !== a.hit.hotword.priorScore) {
      return b.hit.hotword.priorScore - a.hit.hotword.priorScore;
    }
    return b.hit.candidateScore - a.hit.candidateScore;
  });

  const sorted = decorated.map((d) => d.hit);
  const recallToneCompatibleCount = decorated.filter((d) => d.compatible === 1).length;
  return {
    hits: sorted,
    recallToneCompatibleCount,
    recallToneFallbackCount: sorted.length - recallToneCompatibleCount,
  };
}

export function candidateTonePatternFromKey(toneKey: string): number[] {
  return extractToneNumbersFromKey(toneKey);
}
