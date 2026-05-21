import type { SentenceCandidate } from '../sentence-expansion/types';
import type { RerankWeights } from './types';

export type ScoreBreakdown = {
  acoustic: number;
  phonetic: number;
  prior: number;
  lm: number;
  combined: number;
};

function normalizeAcoustic(score: number | undefined): number {
  if (score === undefined || Number.isNaN(score)) {
    return 0;
  }
  return 1 / (1 + Math.exp(score));
}

function normalizeLmScore(score: number | undefined): number {
  if (score === undefined || Number.isNaN(score)) {
    return 0;
  }
  return 1 / (1 + Math.exp(-score / 10));
}

export function computeScoreBreakdown(
  candidate: SentenceCandidate,
  weights: RerankWeights
): ScoreBreakdown {
  const acoustic = normalizeAcoustic(candidate.acousticScore) * weights.acoustic;
  const phonetic = candidate.phoneticScore * weights.phonetic;
  const prior = Math.min(1, candidate.hotwordPrior / 5) * weights.prior;
  const lm = normalizeLmScore(candidate.kenlmScore) * weights.lm;
  return {
    acoustic,
    phonetic,
    prior,
    lm,
    combined: acoustic + phonetic + prior + lm,
  };
}
