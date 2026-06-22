/**
 * Domain ReRank SSOT — Implementation Contract V1.2 §4 / §6.
 */

import {
  getParentDomainId,
} from '../../lexicon-v2/resolve-recall-enabled-fine-domains';
import { getRegistryEntry } from '../../lexicon-v2/profile-registry';
import type { UtteranceDomainVoteResult } from './utterance-domain-vote';

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

  const matchedParent = getParentDomainId(matchedDomain);
  const winningParent = getParentDomainId(winningDomain);

  if (matchedDomain === winningParent || winningDomain === matchedParent) {
    return 'parent';
  }

  if (matchedParent && winningParent && matchedParent === winningParent) {
    return 'sibling';
  }

  const matchedEntry = getRegistryEntry(matchedDomain);
  const winningEntry = getRegistryEntry(winningDomain);
  if (
    matchedEntry?.parent &&
    winningEntry?.parent &&
    matchedEntry.parent === winningEntry.parent
  ) {
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
