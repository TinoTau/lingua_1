import { getLmScorer } from './lm-scorer';
import { rescoreWithLm, type RescoreOpts } from './rescore';

export { correct, getConfusionSet, getReplaceablePositions, generateCandidates } from './confusion-set';
export { tokenizeForLm } from './char-tokenize';
export { getLmScorer, createLmScorer, type CharLmScorer, type LmScoreResult } from './lm-scorer';
export { rescoreWithLm, type RescoreOpts, type RescoreResult } from './rescore';

/** 唯一入口：有 LM 则 rescore 选优，无 LM 或无可替换位点则返回原文。 */
export async function phoneticCorrect(
  segment: string,
  opts?: Partial<RescoreOpts>
): Promise<{ text: string; debug?: { changed: boolean; deltaScore?: number; candidatesCount?: number } }> {
  const t = segment.trim();
  if (!t) return { text: segment };
  const scorer = getLmScorer();
  if (!scorer) return { text: segment };
  const result = await rescoreWithLm(segment, opts);
  return {
    text: result.text,
    debug: result.changed ? { changed: true, deltaScore: result.deltaScore, candidatesCount: result.candidatesCount } : undefined,
  };
}
