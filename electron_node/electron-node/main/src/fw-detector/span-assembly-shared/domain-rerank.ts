/**
 * Domain ReRank SSOT — Implementation Contract V1.2 §4 / §6.
 * Context Prior — CP-M06 Scheme A (Frozen Third Pass Addendum v1.3).
 */

import {
  getParentDomainId,
  getRuntimeDomainRegistry,
  isCoarseDomainEligibleForLlm,
  type RuntimeDomainRegistry,
} from '../../lexicon-v2/runtime-domain-registry';
import type { UtteranceDomainVoteResult } from './utterance-domain-vote';

export const CONTEXT_PRIOR_MULTIPLIER_MATCH = 1.02;
export const CONTEXT_PRIOR_MULTIPLIER_MISMATCH = 0.96;
export const CONTEXT_PRIOR_MULTIPLIER_NEUTRAL = 1.0;
export const CONTEXT_PRIOR_CLAMP_MIN = 0.95;
export const CONTEXT_PRIOR_CLAMP_MAX = 1.05;

export type ContextPriorSkippedReason =
  | 'general_or_null_prior'
  | 'invalid_coarse'
  | 'coarse_unavailable'
  | 'insufficient_evidence'
  | 'registry_unavailable'
  | 'missing_fine_domain'
  | 'unknown_fine_domain';

export type ContextPriorEligibility = {
  eligible: boolean;
  coarsePriorDomain: string | null;
  skippedReason?: ContextPriorSkippedReason;
  registry: RuntimeDomainRegistry | null;
};

export type ContextPriorStats = {
  applied: boolean;
  skippedReason?: ContextPriorSkippedReason;
  multiplierMin?: number;
  multiplierMax?: number;
};

export const DOMAIN_RERANK_PENALTY = {
  winning: 1.0,
  sibling: 0.8,
  parent: 0.7,
  other: 0.5,
} as const;

export type DomainRerankRelation = 'winning' | 'sibling' | 'parent' | 'other' | 'none';

export function classifyDomainRerankRelation(
  winningDomain: string,
  matchedDomain: string | undefined,
  insufficientEvidence: boolean
): DomainRerankRelation {
  if (insufficientEvidence || winningDomain === 'general' || !matchedDomain) {
    return 'none';
  }
  if (matchedDomain === winningDomain) {
    return 'winning';
  }

  const registry = getRuntimeDomainRegistry();
  const matchedCoarse = registry.fineToCoarseMap[matchedDomain];
  const winningCoarse = registry.fineToCoarseMap[winningDomain];

  if (matchedDomain === winningCoarse || winningDomain === matchedCoarse) {
    return 'parent';
  }

  if (
    matchedCoarse &&
    winningCoarse &&
    matchedCoarse === winningCoarse &&
    matchedDomain !== winningDomain
  ) {
    return 'sibling';
  }

  const matchedParent = getParentDomainId(matchedDomain);
  const winningParent = getParentDomainId(winningDomain);
  if (matchedParent && winningParent && matchedParent === winningParent) {
    return 'sibling';
  }

  return 'other';
}

export function domainRerankPenaltyForRelation(relation: DomainRerankRelation): number {
  switch (relation) {
    case 'winning':
      return DOMAIN_RERANK_PENALTY.winning;
    case 'sibling':
      return DOMAIN_RERANK_PENALTY.sibling;
    case 'parent':
      return DOMAIN_RERANK_PENALTY.parent;
    case 'other':
      return DOMAIN_RERANK_PENALTY.other;
    case 'none':
    default:
      return 1.0;
  }
}

export function computeDomainRerankPenalty(
  vote: UtteranceDomainVoteResult,
  matchedDomain: string | undefined
): number {
  const relation = classifyDomainRerankRelation(
    vote.utteranceDomain,
    matchedDomain,
    vote.insufficientEvidence
  );
  return domainRerankPenaltyForRelation(relation);
}

export function clampContextPriorMultiplier(multiplier: number): number {
  return Math.min(CONTEXT_PRIOR_CLAMP_MAX, Math.max(CONTEXT_PRIOR_CLAMP_MIN, multiplier));
}

export function resolveContextPriorEligibility(
  coarsePriorDomainInput: string | null | undefined,
  vote: UtteranceDomainVoteResult
): ContextPriorEligibility {
  if (vote.insufficientEvidence) {
    return {
      eligible: false,
      coarsePriorDomain: null,
      skippedReason: 'insufficient_evidence',
      registry: null,
    };
  }

  const coarse = coarsePriorDomainInput?.trim() ?? '';
  if (!coarse || coarse === 'general') {
    return {
      eligible: false,
      coarsePriorDomain: null,
      skippedReason: 'general_or_null_prior',
      registry: null,
    };
  }

  let registry: RuntimeDomainRegistry;
  try {
    registry = getRuntimeDomainRegistry();
  } catch {
    return {
      eligible: false,
      coarsePriorDomain: null,
      skippedReason: 'registry_unavailable',
      registry: null,
    };
  }

  if (!isCoarseDomainEligibleForLlm(coarse)) {
    return {
      eligible: false,
      coarsePriorDomain: null,
      skippedReason: 'invalid_coarse',
      registry,
    };
  }

  if (!registry.availableCoarseDomains.includes(coarse)) {
    return {
      eligible: false,
      coarsePriorDomain: null,
      skippedReason: 'coarse_unavailable',
      registry,
    };
  }

  return {
    eligible: true,
    coarsePriorDomain: coarse,
    registry,
  };
}

export function computeContextPriorMultiplier(
  coarsePriorDomain: string,
  matchedFine: string | undefined,
  registry: RuntimeDomainRegistry
): number {
  const fine = matchedFine?.trim() ?? '';
  if (!fine) {
    return CONTEXT_PRIOR_MULTIPLIER_NEUTRAL;
  }
  if (fine === 'general') {
    return CONTEXT_PRIOR_MULTIPLIER_NEUTRAL;
  }

  const matchedCoarse = registry.fineToCoarseMap[fine];
  if (!matchedCoarse) {
    return clampContextPriorMultiplier(CONTEXT_PRIOR_MULTIPLIER_MISMATCH);
  }

  const raw =
    matchedCoarse === coarsePriorDomain
      ? CONTEXT_PRIOR_MULTIPLIER_MATCH
      : CONTEXT_PRIOR_MULTIPLIER_MISMATCH;
  return clampContextPriorMultiplier(raw);
}

export function trackContextPriorMultiplier(
  track: { min?: number; max?: number },
  multiplier: number
): void {
  if (track.min === undefined || multiplier < track.min) {
    track.min = multiplier;
  }
  if (track.max === undefined || multiplier > track.max) {
    track.max = multiplier;
  }
}
