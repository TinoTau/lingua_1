import type { SentenceCandidate } from './sentence-expansion/types';

/** Recover historical-restore-v1 — 候选来源（见 electron_node/docs/RECOVER.md）。 */
export type CandidateSource =
  | 'raw_ctc_baseline'
  | 'window_single'
  | 'window_pair'
  | 'window_multi';

export const RERANK_ELIGIBLE_SOURCES: ReadonlySet<CandidateSource> = new Set([
  'window_single',
  'window_pair',
  'window_multi',
]);

export function resolveCandidateSource(replacements: { length: number }): CandidateSource {
  if (replacements.length === 0) {
    return 'raw_ctc_baseline';
  }
  if (replacements.length === 1) {
    return 'window_single';
  }
  if (replacements.length === 2) {
    return 'window_pair';
  }
  return 'window_multi';
}

export function isRerankEligible(candidate: SentenceCandidate): boolean {
  return RERANK_ELIGIBLE_SOURCES.has(candidate.candidateSource);
}

export function filterRerankEligibleCandidates(candidates: SentenceCandidate[]): SentenceCandidate[] {
  return candidates.filter(isRerankEligible);
}
