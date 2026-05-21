/**
 * CTC ASR evidence types — n-best / KenLM meta observability only (no rewrite).
 */

export type AsrNBestItem = {
  rank: number;
  text: string;
  score?: number;
  acousticScore?: number;
  lmScore?: number;
  totalScore?: number;
  kenlmDecision?: string;
  raw?: unknown;
};

export type AsrKenlmMeta = {
  kenlm_available?: boolean;
  kenlm_called_count?: number;
  kenlm_veto_count?: number;
  kenlm_vote_boost_count?: number;
  kenlm_decision?: string;
  lm_score_raw?: number;
  lm_score_candidate?: number;
  raw?: unknown;
};
