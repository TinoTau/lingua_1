import type { KenLMScorer, KenlmTimingStats } from '../asr-repair/kenlm-batch-types';
import type { SentenceCombination } from './build-sentence-candidates';

export type SentenceRerankPick = {
  pickedIsRaw: boolean;
  picked: SentenceCombination | null;
  maxDelta: number;
  kenlmQueryCount: number;
  kenlmTiming?: KenlmTimingStats;
  topCandidates: Array<{ text: string; kenlmDelta: number; replacementCount: number }>;
  allCombinationDeltas?: number[];
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
  const baselineNorm = batch.scores[0]?.normalizedScore ?? 0;

  let bestIndex = -1;
  let bestDelta = Number.NEGATIVE_INFINITY;
  const deltas: number[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const norm = batch.scores[i + 1]?.normalizedScore ?? baselineNorm;
    const delta = norm - baselineNorm;
    deltas.push(delta);
    if (delta > bestDelta) {
      bestDelta = delta;
      bestIndex = i;
    }
  }

  for (let i = 0; i < topCandidates.length; i++) {
    if (i < deltas.length) {
      topCandidates[i].kenlmDelta = deltas[i];
    }
  }

  topCandidates.sort((a, b) => b.kenlmDelta - a.kenlmDelta);

  if (bestIndex < 0 || bestDelta < minDeltaToReplace) {
    return {
      pickedIsRaw: true,
      picked: null,
      maxDelta: bestDelta > Number.NEGATIVE_INFINITY ? bestDelta : 0,
      kenlmQueryCount: batch.timing?.queryCount ?? sentences.length,
      kenlmTiming: batch.timing,
      topCandidates,
      allCombinationDeltas: deltas,
    };
  }

  return {
    pickedIsRaw: false,
    picked: candidates[bestIndex],
    maxDelta: bestDelta,
    kenlmQueryCount: batch.timing?.queryCount ?? sentences.length,
    kenlmTiming: batch.timing,
    topCandidates,
    allCombinationDeltas: deltas,
  };
}
