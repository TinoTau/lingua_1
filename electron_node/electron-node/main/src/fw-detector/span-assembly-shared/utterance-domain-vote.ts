import type { GraphEdge, GraphEdgeSource, ParentTermEvidence } from './types';

const SOURCE_WEIGHT: Record<GraphEdgeSource, number> = {
  domain_term: 1.0,
  passive_domain_weak: 0.2,
  base_term: 0.5,
  oral_function: 0.15,
  oral_particle: 0.1,
  unknown: 0.05,
  noise: 0.05,
};

const MIN_EVIDENCE_SCORE = 0.3;

export type UtteranceDomainVoteResult = {
  utteranceDomain: string;
  domainVoteMs: number;
  insufficientEvidence: boolean;
  domainScores: Record<string, number>;
  parentTermVoteCount: number;
};

export type UtteranceDomainVoteInput = {
  parentEvidence: ParentTermEvidence[];
  exactEdges: GraphEdge[];
};

/** Minimal pool shape for main-chain domain vote (no span-assembly-v4 import). */
export type PoolVoteCandidate = {
  hitKind: 'exact_term' | 'parent_fragment';
  source: GraphEdgeSource;
  score: number;
  domainId?: string;
  syllableStart: number;
  syllableEnd: number;
  parentTermId?: string;
  matchedTermStart?: number;
  matchedTermEnd?: number;
  isCovered?: boolean;
};

export type FineSpanPoolForVote = {
  candidates: PoolVoteCandidate[];
};

function finalizeDomainVote(
  start: number,
  domainScores: Record<string, number>,
  parentTermVoteCount: number
): UtteranceDomainVoteResult {
  const totalEvidence = Object.values(domainScores).reduce((s, v) => s + v, 0);
  if (totalEvidence < MIN_EVIDENCE_SCORE) {
    return {
      utteranceDomain: 'general',
      domainVoteMs: Date.now() - start,
      insufficientEvidence: true,
      domainScores,
      parentTermVoteCount,
    };
  }

  let bestDomain = 'general';
  let bestScore = 0;
  for (const [domain, score] of Object.entries(domainScores)) {
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }

  return {
    utteranceDomain: bestDomain,
    domainVoteMs: Date.now() - start,
    insufficientEvidence: false,
    domainScores,
    parentTermVoteCount,
  };
}

function addDomainScore(
  domainScores: Record<string, number>,
  domainId: string | undefined,
  source: GraphEdgeSource,
  score: number,
  coverageSyllables: number
): void {
  if (!domainId || domainId === 'general') {
    return;
  }
  const weight = SOURCE_WEIGHT[source] ?? 0.05;
  const coverageWeight = Math.min(1, coverageSyllables / 4);
  domainScores[domainId] = (domainScores[domainId] ?? 0) + score * weight * coverageWeight;
}

export function voteUtteranceDomainFromEvidence(
  parentEvidence: ParentTermEvidence[]
): Pick<UtteranceDomainVoteResult, 'domainScores' | 'parentTermVoteCount'> {
  const domainScores: Record<string, number> = {};
  const votedParentTermIds = new Set<string>();
  let parentTermVoteCount = 0;

  for (const evidence of parentEvidence) {
    if (votedParentTermIds.has(evidence.parentTermId)) {
      continue;
    }
    votedParentTermIds.add(evidence.parentTermId);
    parentTermVoteCount += 1;
    const coverage = evidence.matchedTermEnd - evidence.matchedTermStart;
    addDomainScore(domainScores, evidence.domainId, evidence.source, evidence.score, coverage);
  }

  return { domainScores, parentTermVoteCount };
}

export function voteUtteranceDomainFromPool(pool: FineSpanPoolForVote[]): UtteranceDomainVoteResult {
  const start = Date.now();
  const domainScores: Record<string, number> = {};
  const votedParentTermIds = new Set<string>();
  let parentTermVoteCount = 0;

  for (const spanPool of pool) {
    for (const candidate of spanPool.candidates) {
      if (candidate.isCovered) {
        continue;
      }
      if (candidate.hitKind === 'parent_fragment' && candidate.parentTermId) {
        const coverage =
          (candidate.matchedTermEnd ?? candidate.syllableEnd) -
          (candidate.matchedTermStart ?? candidate.syllableStart);
        addDomainScore(domainScores, candidate.domainId, candidate.source, candidate.score, coverage);
        if (!votedParentTermIds.has(candidate.parentTermId)) {
          votedParentTermIds.add(candidate.parentTermId);
          parentTermVoteCount += 1;
        }
        continue;
      }
      if (candidate.hitKind === 'exact_term') {
        const coverage = candidate.syllableEnd - candidate.syllableStart;
        addDomainScore(domainScores, candidate.domainId, candidate.source, candidate.score, coverage);
      }
    }
  }

  return finalizeDomainVote(start, domainScores, parentTermVoteCount);
}

export function voteUtteranceDomain(input: UtteranceDomainVoteInput): UtteranceDomainVoteResult {
  const start = Date.now();
  const evidenceVote = voteUtteranceDomainFromEvidence(input.parentEvidence);
  const domainScores = { ...evidenceVote.domainScores };

  for (const edge of input.exactEdges) {
    const coverage = edge.syllableEnd - edge.syllableStart;
    addDomainScore(domainScores, edge.domainId, edge.source, edge.score, coverage);
  }

  return finalizeDomainVote(start, domainScores, evidenceVote.parentTermVoteCount);
}

export function applyDomainVoteToEdges(
  edges: GraphEdge[],
  vote: UtteranceDomainVoteResult
): GraphEdge[] {
  if (vote.insufficientEvidence || vote.utteranceDomain === 'general') {
    return edges;
  }
  return edges.map((edge) => {
    if (edge.source !== 'domain_term' && edge.source !== 'passive_domain_weak') {
      return edge;
    }
    if (edge.domainId === vote.utteranceDomain) {
      return edge;
    }
    return { ...edge, score: edge.score * 0.3 };
  });
}
