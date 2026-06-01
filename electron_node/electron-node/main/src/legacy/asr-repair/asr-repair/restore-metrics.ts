import type { CandidateSource } from './candidate-source';
import { isRerankEligible } from './candidate-source';
import type { SentenceCandidate } from './sentence-expansion/types';

export type CandidateSourceDistribution = Record<CandidateSource, number>;

export type RestoreMetrics = {
  phonetic_expanded_sentence_candidates_count: number;
  picked_from_phonetic_expansion_count: number;
  picked_from_raw_ctc_nbest_count: number;
  candidate_source_distribution: CandidateSourceDistribution;
};

function emptyDistribution(): CandidateSourceDistribution {
  return {
    raw_ctc_baseline: 0,
    window_single: 0,
    window_pair: 0,
    window_multi: 0,
  };
}

export function computeRestoreMetrics(
  candidates: SentenceCandidate[],
  picked?: SentenceCandidate
): RestoreMetrics {
  const candidate_source_distribution = emptyDistribution();
  for (const c of candidates) {
    candidate_source_distribution[c.candidateSource] += 1;
  }

  const phonetic_expanded_sentence_candidates_count = candidates.filter(isRerankEligible).length;
  const picked_from_phonetic_expansion_count =
    picked && isRerankEligible(picked) ? 1 : 0;
  const picked_from_raw_ctc_nbest_count =
    picked?.candidateSource === 'raw_ctc_baseline' ? 1 : 0;

  return {
    phonetic_expanded_sentence_candidates_count,
    picked_from_phonetic_expansion_count,
    picked_from_raw_ctc_nbest_count,
    candidate_source_distribution,
  };
}
