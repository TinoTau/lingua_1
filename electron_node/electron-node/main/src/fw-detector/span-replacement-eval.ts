/**
 * Candidate-layer replacement evaluation (Recall 之后).
 * Not used by Detector — diagnostics / unit tests only.
 */

import type { LocalSpanRecallHit, LocalSpanRecallResult } from '../lexicon/local-span-recall';

export type SpanReplacementEval = {
  maxPhoneticScore: number;
  hasReplacementCandidate: boolean;
  repairTargetOnBestHit: boolean;
  topReplacementWord?: string;
};

function isReplacementHit(
  hit: LocalSpanRecallHit,
  spanText: string,
  requireRepairTarget: boolean
): boolean {
  if (hit.word === spanText) {
    return false;
  }
  if (!requireRepairTarget) {
    return true;
  }
  return hit.repairTarget === true;
}

function pickBestReplacementHit(
  hits: LocalSpanRecallHit[],
  spanText: string,
  requireRepairTarget: boolean
): LocalSpanRecallHit | undefined {
  return hits
    .filter((h) => isReplacementHit(h, spanText, requireRepairTarget))
    .sort((a, b) => b.candidateScore - a.candidateScore || b.phoneticScore - a.phoneticScore)[0];
}

export function evaluateSpanReplacementFromRecall(
  recall: LocalSpanRecallResult,
  spanText: string,
  requireRepairTarget: boolean
): SpanReplacementEval {
  const bestReplacement = pickBestReplacementHit(recall.hits, spanText, requireRepairTarget);

  return {
    maxPhoneticScore: recall.maxPhoneticScore,
    hasReplacementCandidate: bestReplacement != null,
    repairTargetOnBestHit: bestReplacement?.repairTarget === true,
    topReplacementWord: bestReplacement?.word,
  };
}
