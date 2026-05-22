/**
 * Recover V5 — unified skip reasons (Phase D).
 */

import { createKenlmBatchScorer } from './sentence-rerank/kenlm-scorer';
import type { KenLMScorer } from './sentence-rerank/types';
import { getRecoverQualityConfig } from '../recover-quality/quality-config';
import type { WindowCandidate } from '../lexicon/hotword-types';

export const V5_SKIP_REASONS = [
  'no_diff_span',
  'no_topk_candidate',
  'low_candidate_score',
  'kenlm_worse_than_baseline',
  'replacement_count_exceeded',
  'candidate_budget_exceeded',
  'no_window_expansion_candidate',
] as const;

export type V5SkipReason = (typeof V5_SKIP_REASONS)[number];

export function isV5SkipReason(reason: string): reason is V5SkipReason {
  return (V5_SKIP_REASONS as readonly string[]).includes(reason);
}

export function evaluateNoTopkCandidate(candidates: WindowCandidate[]): V5SkipReason | null {
  if (candidates.length === 0) {
    return 'no_topk_candidate';
  }
  const topk = candidates.filter((c) => c.source === 'lexicon_pinyin_topk');
  if (topk.length === 0) {
    return 'no_topk_candidate';
  }
  return null;
}

export function evaluateLowCandidateScore(candidates: WindowCandidate[]): V5SkipReason | null {
  if (!candidates.length) {
    return null;
  }
  const minScore = getRecoverQualityConfig().minCandidateScore;
  const best = Math.max(...candidates.map((c) => c.candidateScore ?? 0));
  if (best < minScore) {
    return 'low_candidate_score';
  }
  return null;
}

export function evaluateCandidateBudgetExceeded(truncated: boolean): V5SkipReason | null {
  return truncated ? 'candidate_budget_exceeded' : null;
}

export function evaluateReplacementCountExceeded(
  replacementCount: number
): V5SkipReason | null {
  const max = getRecoverQualityConfig().maxReplacements;
  if (replacementCount > max) {
    return 'replacement_count_exceeded';
  }
  return null;
}

/**
 * KenLM normalized score of picked must not be worse than baseline by tolerance.
 */
export async function evaluateKenlmBaselineGate(
  baselineText: string,
  pickedNormalizedLm: number | undefined,
  kenlmAvailable: boolean,
  scorer?: KenLMScorer | null
): Promise<{ skip: boolean; reason?: V5SkipReason }> {
  if (!kenlmAvailable || pickedNormalizedLm === undefined || !baselineText.trim()) {
    return { skip: false };
  }
  const kenlm = scorer === undefined ? createKenlmBatchScorer() : scorer;
  if (!kenlm) {
    return { skip: false };
  }
  const batch = await kenlm.scoreBatch([baselineText.trim()]);
  const baseNorm = batch.scores[0]?.normalizedScore ?? -Infinity;
  const tolerance = getRecoverQualityConfig().kenlmBaselineTolerance;
  if (pickedNormalizedLm < baseNorm - tolerance) {
    return { skip: true, reason: 'kenlm_worse_than_baseline' };
  }
  return { skip: false };
}

export function buildSkipReasonV5Distribution(
  reason: string | null | undefined
): Partial<Record<V5SkipReason, number>> {
  if (!reason || !isV5SkipReason(reason)) {
    return {};
  }
  return { [reason]: 1 };
}
