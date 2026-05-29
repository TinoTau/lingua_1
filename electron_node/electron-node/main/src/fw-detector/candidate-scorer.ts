import type { FinalScoreWeights } from './fw-config';

export type CandidateScoreInput = {
  phoneticScore: number;
  priorScore: number;
  domainMatched: boolean;
  kenlmDelta: number;
  kenlmEnabled: boolean;
};

export type CandidateScoreBreakdown = {
  pinyinScore: number;
  priorScore: number;
  domainScore: number;
  kenlmContribution: number;
  finalScore: number;
};

/** Map KenLM delta to [0,1] for weighted sum; weak veto already applied separately. */
export function normalizeKenlmDeltaForScore(delta: number): number {
  const clamped = Math.max(-1, Math.min(1, delta));
  return (clamped + 1) / 2;
}

/** Domain only boosts — no hard block (V1.1 §13.3). */
export function computeDomainScore(domainMatched: boolean): number {
  return domainMatched ? 1 : 0.5;
}

export function computeCandidateFinalScore(
  input: CandidateScoreInput,
  weights: FinalScoreWeights
): CandidateScoreBreakdown {
  const pinyinScore = Math.max(0, Math.min(1, input.phoneticScore));
  const priorScore = Math.max(0, Math.min(1, input.priorScore));
  const domainScore = computeDomainScore(input.domainMatched);
  const kenlmContribution = input.kenlmEnabled
    ? normalizeKenlmDeltaForScore(input.kenlmDelta)
    : normalizeKenlmDeltaForScore(0);

  const finalScore =
    weights.pinyin * pinyinScore +
    weights.prior * priorScore +
    weights.domain * domainScore +
    weights.kenlm * kenlmContribution;

  return {
    pinyinScore,
    priorScore,
    domainScore,
    kenlmContribution,
    finalScore,
  };
}
