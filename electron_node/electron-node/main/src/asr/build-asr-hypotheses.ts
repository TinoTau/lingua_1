import type { AsrNBestItem } from '../task-router/asr-evidence-types';
import type { ASRHypothesis, ASRDecodeResult } from './types';

function mapNbestItem(item: AsrNBestItem): ASRHypothesis {
  return {
    text: item.text,
    rank: item.rank,
    acousticScore: item.acousticScore ?? item.score ?? item.totalScore,
  };
}

/**
 * Build hypothesis list for recover main chain. No n-best → explicit synthetic top1.
 */
export function buildAsrHypotheses(
  top1: string,
  nbest?: AsrNBestItem[]
): ASRDecodeResult {
  const trimmed = top1.trim();
  if (nbest && nbest.length > 0) {
    const hypotheses = nbest
      .filter((h) => typeof h.text === 'string' && h.text.trim().length > 0)
      .map(mapNbestItem);
    if (hypotheses.length > 0) {
      return { top1: trimmed, hypotheses, nbestSynthetic: false };
    }
  }

  return {
    top1: trimmed,
    hypotheses: [{ text: trimmed, rank: 0, acousticScore: 0 }],
    nbestSynthetic: true,
  };
}
