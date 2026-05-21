import type { SentenceCandidate } from '../sentence-expansion/types';
import { isRerankEligible } from '../candidate-source';

/** V3 historical-restore：仅描述窗扩展写回原因，不含 hypothesis_switch / KenLM 句级切换语义。 */
export type HistoricalPickedReason = 'hotword_recall' | 'window_phonetic_expansion' | 'none';

export function resolveTop1HypothesisIndex(hypotheses: Array<{ rank: number }> | undefined): number {
  if (!hypotheses?.length) {
    return 0;
  }
  const idx = hypotheses.findIndex((h) => h.rank === 0);
  return idx >= 0 ? idx : 0;
}

export function computeHistoricalPickedReason(picked: SentenceCandidate): HistoricalPickedReason {
  if (picked.replacements.length > 0) {
    return 'hotword_recall';
  }
  if (isRerankEligible(picked)) {
    return 'window_phonetic_expansion';
  }
  return 'none';
}
