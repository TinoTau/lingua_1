import { createKenlmBatchScorer } from '../../../../asr-repair/sentence-rerank/kenlm-scorer';
import { computeCombinedScore } from './combined-score';
import {
  DEFAULT_RERANK_WEIGHTS,
  type KenLMScore,
  type KenLMScorer,
  type RerankWeights,
  type SentenceRerankResult,
} from './types';
import { isRerankEligible } from '../candidate-source';
import { getRecoverQualityConfig } from '../../../../recover-quality/quality-config';
import type { SentenceCandidate } from '../sentence-expansion/types';
import { pickWithNearTieCoverageGuardrail } from './near-tie-coverage-guardrail';

export async function rerankSentenceCandidates(
  candidates: SentenceCandidate[],
  weights: RerankWeights = DEFAULT_RERANK_WEIGHTS,
  scorer?: KenLMScorer | null
): Promise<SentenceRerankResult> {
  if (!candidates.length) {
    throw new Error('rerankSentenceCandidates: empty candidates');
  }
  if (!candidates.every(isRerankEligible)) {
    throw new Error('rerankSentenceCandidates: raw_ctc_baseline cannot be reranked');
  }

  const rerankStart = Date.now();
  const kenlm = scorer === undefined ? createKenlmBatchScorer() : scorer;
  const kenlmAvailable = kenlm !== null;
  const sentences = candidates.map((c) => c.text);

  let lmScores: KenLMScore[] = [];
  let kenlmTiming: SentenceRerankResult['kenlmTiming'];
  if (kenlm) {
    const batch = await kenlm.scoreBatch(sentences);
    lmScores = batch.scores;
    kenlmTiming = batch.timing;
  }

  const scored = candidates.map((candidate, i) => {
    const combinedScore = computeCombinedScore(candidate, weights, lmScores[i]);
    return {
      ...candidate,
      kenlmScore: lmScores[i]?.score,
      kenlmNormalizedScore: lmScores[i]?.normalizedScore,
      combinedScore,
    };
  });

  scored.sort((a, b) => (b.combinedScore ?? 0) - (a.combinedScore ?? 0));

  const epsilon = getRecoverQualityConfig().multiWindowScoreEpsilon;
  const { picked, diagnostics: nearTieDiagnostics } = pickWithNearTieCoverageGuardrail(
    scored,
    epsilon
  );

  return {
    candidates: scored,
    picked,
    nearTieDiagnostics,
    kenlmAvailable,
    kenlmTiming,
    rerankMs: Date.now() - rerankStart,
  };
}
