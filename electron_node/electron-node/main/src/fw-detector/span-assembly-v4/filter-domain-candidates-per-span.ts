import {
  classifyDomainRerankRelation,
  type DomainRerankRelation,
} from '../span-assembly-shared/domain-rerank';
import type { UtteranceDomainVoteResult } from '../span-assembly-shared/utterance-domain-vote';
import type {
  DomainAwareSpanReplacementPick,
  DomainFilteredSpanSet,
  RankedSpanCandidateSet,
} from './domain-assembly-types';

export type CandidateBucketName = 'sameDomain' | 'base' | 'fallback';

function bucketForDomainRelation(relation: DomainRerankRelation): CandidateBucketName {
  if (relation === 'winning' || relation === 'sibling') {
    return 'sameDomain';
  }
  return 'fallback';
}

export function classifyPickBucket(
  pick: DomainAwareSpanReplacementPick,
  vote: UtteranceDomainVoteResult
): CandidateBucketName {
  if (pick.graphSource === 'base_term') {
    return 'base';
  }

  const matchedDomain = pick.matchedDomain ?? pick.domainId;
  const relation = classifyDomainRerankRelation(
    vote.utteranceDomain,
    matchedDomain,
    vote.insufficientEvidence
  );
  return bucketForDomainRelation(relation);
}

export function filterDomainCandidatesPerSpan(
  ranked: RankedSpanCandidateSet[],
  vote: UtteranceDomainVoteResult
): DomainFilteredSpanSet[] {
  return ranked.map((spanSet) => {
    const sameDomainCandidates: DomainAwareSpanReplacementPick[] = [];
    const baseCandidates: DomainAwareSpanReplacementPick[] = [];
    const fallbackCandidates: DomainAwareSpanReplacementPick[] = [];

    for (const pick of spanSet.rankedCandidates) {
      const bucket = classifyPickBucket(pick, vote);
      if (bucket === 'sameDomain') {
        sameDomainCandidates.push(pick);
      } else if (bucket === 'base') {
        baseCandidates.push(pick);
      } else {
        fallbackCandidates.push(pick);
      }
    }

    return {
      coarseSpanId: spanSet.coarseSpanId,
      rawRange: spanSet.rawRange,
      syllableRange: spanSet.syllableRange,
      sameDomainCandidates,
      baseCandidates,
      fallbackCandidates,
      selectedCandidates: [],
    };
  });
}
