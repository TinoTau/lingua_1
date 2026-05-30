import type { SentenceCandidate } from '../sentence-expansion/types';
import type { KenLMScore, RerankWeights } from './types';

function normalizeAcoustic(score: number | undefined): number {
  if (score === undefined || Number.isNaN(score)) {
    return 0;
  }
  return 1 / (1 + Math.exp(score));
}

export function computeCombinedScore(
  candidate: SentenceCandidate,
  weights: RerankWeights,
  lm?: KenLMScore
): number {
  const acoustic = normalizeAcoustic(candidate.acousticScore);
  const phonetic = candidate.phoneticScore;
  const prior = Math.min(1, candidate.hotwordPrior / 5);
  const lmNorm = lm?.normalizedScore ?? 0;

  return (
    weights.acoustic * acoustic +
    weights.phonetic * phonetic +
    weights.prior * prior +
    weights.lm * lmNorm
  );
}
