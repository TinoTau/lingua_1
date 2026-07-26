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
  topCandidates: Array<{
    rank: number;
    candidateId: string;
    text: string;
    kenlmScore: number;
    deltaVsRaw: number;
    isRaw: boolean;
    replacementCount: number;
  }>;
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
      topCandidates: [],
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

  const topCandidates: SentenceRerankPick['topCandidates'] = [
    {
      rank: 0,
      candidateId: 'raw',
      text: rawText,
      kenlmScore: baselineRawScore,
      deltaVsRaw: 0,
      isRaw: true,
      replacementCount: 0,
    },
    ...candidates.map((c, i) => ({
      rank: 0,
      candidateId: `candidate:${i}`,
      text: c.text,
      kenlmScore: batch.scores[i + 1]?.score ?? baselineRawScore,
      deltaVsRaw: rawDeltas[i] ?? 0,
      isRaw: false,
      replacementCount: c.replacements.length,
    })),
  ]
    .sort((a, b) => b.kenlmScore - a.kenlmScore || b.deltaVsRaw - a.deltaVsRaw)
    .slice(0, 3)
    .map((row, idx) => ({ ...row, rank: idx + 1 }));

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
