/**
 * 同音候选 + LM 打分 + delta 选优。单一路径：候选生成 → 打分 → 阈值选优 → 返回文本。
 */

import { getLmScorer } from './lm-scorer';
import { getReplaceablePositions, generateCandidates } from './confusion-set';

export interface RescoreOpts {
  maxPositions: number;
  maxCandidates: number;
  delta: number;
}

const DEFAULT_OPTS: RescoreOpts = {
  maxPositions: 2,
  maxCandidates: 24,
  delta: 1.0,
};

export interface RescoreResult {
  text: string;
  changed: boolean;
  deltaScore?: number;
  candidatesCount?: number;
}

const MIN_LEN = 2;
const MAX_LEN = 120;

/**
 * 候选生成 → LM 打分 → 仅当 score(best) - score(original) >= delta 时替换。
 * LM 不可用或无可替换位点时返回原文（fail-open）。
 */
export async function rescoreWithLm(
  text: string,
  opts: Partial<RescoreOpts> = {}
): Promise<RescoreResult> {
  const t = text.trim();
  if (!t || t.length < MIN_LEN || t.length > MAX_LEN) {
    return { text, changed: false };
  }

  const scorer = getLmScorer();
  if (!scorer) return { text, changed: false };

  const { maxPositions, maxCandidates, delta } = { ...DEFAULT_OPTS, ...opts };
  const positions = getReplaceablePositions(t, maxPositions);
  if (positions.length === 0) return { text, changed: false };

  const candidates = generateCandidates(t, positions, maxCandidates);
  const origScore = (await scorer.score(t)).score;
  let bestText = t;
  let bestScore = origScore;

  for (let i = 1; i < candidates.length; i++) {
    const s = (await scorer.score(candidates[i])).score;
    if (s > bestScore) {
      bestScore = s;
      bestText = candidates[i];
    }
  }

  const deltaScore = bestScore - origScore;
  if (deltaScore < delta) return { text, changed: false, deltaScore, candidatesCount: candidates.length };
  return { text: bestText, changed: true, deltaScore, candidatesCount: candidates.length };
}
