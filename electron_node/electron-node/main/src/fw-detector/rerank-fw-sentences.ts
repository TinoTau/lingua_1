import type { KenLMScorer, KenlmSubprocessRuntimeDiag, KenlmTimingStats } from '../asr-repair/kenlm-batch-types';
import type { SentenceCombination } from './build-sentence-candidates';

export const FW_RERANK_SCORE_MODE = 'raw_log_delta' as const;

export type SentenceRerankPick = {
  pickedIsRaw: boolean;
  picked: SentenceCombination | null;
  maxDelta: number;
  kenlmQueryCount: number;
  kenlmTiming?: KenlmTimingStats;
  kenlmRuntime?: KenlmSubprocessRuntimeDiag;
  topCandidates: Array<{ text: string; kenlmDelta: number; replacementCount: number }>;
  allCombinationDeltas?: number[];
  scoreMode?: typeof FW_RERANK_SCORE_MODE;
  baselineRawScore?: number;
  pickedRawScore?: number;
  maxNormalizedDelta?: number;
};

export async function rerankFwSentences(
  rawText: string,
  candidates: SentenceCombination[],
  scorer: KenLMScorer | null,
  minDeltaToReplace: number
): Promise<SentenceRerankPick> {
  const topCandidates: SentenceRerankPick['topCandidates'] = candidates
    .slice(0, 5)
    .map((c) => ({ text: c.text, kenlmDelta: 0, replacementCount: c.replacements.length }));

  if (!candidates.length) {
    return {
      pickedIsRaw: true,
      picked: null,
      maxDelta: 0,
      kenlmQueryCount: 0,
      topCandidates: [],
    };
  }

  if (!scorer) {
    return {
      pickedIsRaw: true,
      picked: null,
      maxDelta: 0,
      kenlmQueryCount: 0,
      topCandidates,
    };
  }

  const sentences = [rawText, ...candidates.map((c) => c.text)];
  const batch = await scorer.scoreBatch(sentences);
  const kenlmRuntime = batch.runtime;
  const baselineRawScore = batch.scores[0]?.score ?? 0;
  const baselineNorm = batch.scores[0]?.normalizedScore ?? 0;

  let bestIndex = -1;
  let bestRawDelta = Number.NEGATIVE_INFINITY;
  let maxNormalizedDelta = Number.NEGATIVE_INFINITY;
  const rawDeltas: number[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidateRaw = batch.scores[i + 1]?.score ?? baselineRawScore;
    const candidateNorm = batch.scores[i + 1]?.normalizedScore ?? baselineNorm;
    const rawDelta = candidateRaw - baselineRawScore;
    const normDelta = candidateNorm - baselineNorm;
    rawDeltas.push(rawDelta);
    if (rawDelta > bestRawDelta) {
      bestRawDelta = rawDelta;
      bestIndex = i;
    }
    if (normDelta > maxNormalizedDelta) {
      maxNormalizedDelta = normDelta;
    }
  }

  for (let i = 0; i < topCandidates.length; i++) {
    if (i < rawDeltas.length) {
      topCandidates[i].kenlmDelta = rawDeltas[i];
    }
  }

  topCandidates.sort((a, b) => b.kenlmDelta - a.kenlmDelta);

  const maxDelta = bestRawDelta > Number.NEGATIVE_INFINITY ? bestRawDelta : 0;
  const scoreDiagnostics = {
    scoreMode: FW_RERANK_SCORE_MODE,
    baselineRawScore,
    maxNormalizedDelta: maxNormalizedDelta > Number.NEGATIVE_INFINITY ? maxNormalizedDelta : 0,
  };

  const batchMeta = {
    kenlmQueryCount: batch.timing?.queryCount ?? sentences.length,
    kenlmTiming: batch.timing,
    kenlmRuntime,
    topCandidates,
    allCombinationDeltas: rawDeltas,
  };

  if (bestIndex < 0 || bestRawDelta < minDeltaToReplace) {
    return {
      pickedIsRaw: true,
      picked: null,
      maxDelta,
      ...scoreDiagnostics,
      ...batchMeta,
    };
  }

  return {
    pickedIsRaw: false,
    picked: candidates[bestIndex],
    maxDelta,
    pickedRawScore: batch.scores[bestIndex + 1]?.score ?? baselineRawScore,
    ...scoreDiagnostics,
    ...batchMeta,
  };
}
