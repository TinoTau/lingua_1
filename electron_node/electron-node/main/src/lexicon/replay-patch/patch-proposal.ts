/**
 * Replay-driven lexicon patch proposal (Final Freeze Spec §8).
 */

export type LexiconPatchReason =
  | 'no_topk_candidate'
  | 'low_candidate_score'
  | 'domain_missing';

export type LexiconPatchProposal = {
  caseId: string;
  rawAsr: string;
  finalText: string;
  missingCandidate: string;
  suggestedDomain: string;
  reason: LexiconPatchReason;
  evidence: string[];
};

export function buildPatchProposal(input: {
  caseId: string;
  rawAsr: string;
  finalText: string;
  windowText: string;
  suggestedDomain: string;
  reason: LexiconPatchReason;
  evidence?: string[];
}): LexiconPatchProposal {
  return {
    caseId: input.caseId,
    rawAsr: input.rawAsr,
    finalText: input.finalText,
    missingCandidate: input.windowText,
    suggestedDomain: input.suggestedDomain,
    reason: input.reason,
    evidence: input.evidence ?? [],
  };
}
