/**
 * Context Prior diagnostics-only helpers.
 * Does not participate in Domain Vote, Assembly membership, or KenLM scoring.
 * Domain soft-rerank penalties were removed (legacy Domain Rerank deleted).
 */

export type ContextPriorSkippedReason =
  | 'general_or_null_prior'
  | 'invalid_coarse'
  | 'coarse_unavailable'
  | 'insufficient_evidence'
  | 'registry_unavailable'
  | 'missing_fine_domain'
  | 'unknown_fine_domain'
  | 'not_applied';

export type ContextPriorStats = {
  applied: boolean;
  skippedReason?: ContextPriorSkippedReason;
  multiplierMin?: number;
  multiplierMax?: number;
};
