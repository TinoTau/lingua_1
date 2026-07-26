/**
 * Fine-span domain presence Vote (SSOT).
 * domainScores[domain] = distinct fine-span count (presence), not weighted score mass.
 * One span contributes at most one vote per domain via FineSpanDomainSet union.
 */
export const DOMAIN_BUCKET_RETENTION_RATIO = 0.75;

export type UtteranceDomainVoteResult = {
  /** Diagnostic primary = retainedDomains[0] or 'general'. Does not drive Assembly alone. */
  utteranceDomain: string;
  domainVoteMs: number;
  insufficientEvidence: boolean;
  /** Distinct fine-span presence counts. */
  domainScores: Record<string, number>;
  parentTermVoteCount: number;
  /** Alias of maxCount for metrics compatibility */
  winnerScore: number;
  runnerUpDomain: string;
  /** Alias of runnerUpCount */
  runnerUpScore: number;
  voteMargin: number;
  retainedDomains: readonly string[];
  maxCount: number;
  runnerUpCount: number;
  isTie: boolean;
};

/** Minimal pool shape for main-chain domain vote (no span-assembly-v4 import). */
export type PoolVoteCandidate = {
  candidateId?: string;
  hitKind: 'exact_term' | 'parent_fragment';
  source: string;
  score: number;
  domains?: readonly string[];
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

function isVoteDomainLabel(domain: string | undefined): domain is string {
  return Boolean(domain) && domain !== 'general' && domain !== 'base_term';
}

function isDomainVoteSource(source: string): boolean {
  return source === 'domain_term' || source === 'passive_domain_weak';
}

function addDomainsToSet(target: Set<string>, domains: readonly string[] | undefined): void {
  for (const domain of domains ?? []) {
    if (isVoteDomainLabel(domain)) {
      target.add(domain);
    }
  }
}

function rankDomainCounts(domainScores: Record<string, number>): Array<[string, number]> {
  return Object.entries(domainScores)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function selectRetainedDomains(domainScores: Record<string, number>): {
  retainedDomains: string[];
  maxCount: number;
  runnerUpCount: number;
  isTie: boolean;
  insufficientEvidence: boolean;
  utteranceDomain: string;
  runnerUpDomain: string;
} {
  const ranked = rankDomainCounts(domainScores);
  if (!ranked.length) {
    return {
      retainedDomains: [],
      maxCount: 0,
      runnerUpCount: 0,
      isTie: false,
      insufficientEvidence: true,
      utteranceDomain: 'general',
      runnerUpDomain: 'general',
    };
  }

  const maxCount = ranked[0][1];
  const atMax = ranked.filter(([, count]) => count === maxCount).map(([domain]) => domain);
  const runnerUpEntry = ranked.find(([, count]) => count < maxCount);
  const runnerUpCount = runnerUpEntry?.[1] ?? 0;
  const runnerUpDomain = runnerUpEntry?.[0] ?? 'general';
  const isTie = atMax.length > 1;

  let retained: string[];
  if (isTie) {
    retained = [...atMax];
  } else {
    const threshold = maxCount * DOMAIN_BUCKET_RETENTION_RATIO;
    retained = ranked
      .filter(([, count]) => count > 0 && count >= threshold)
      .map(([domain]) => domain);
  }

  retained.sort((a, b) => (domainScores[b] ?? 0) - (domainScores[a] ?? 0) || a.localeCompare(b));

  return {
    retainedDomains: retained,
    maxCount,
    runnerUpCount,
    isTie,
    insufficientEvidence: false,
    utteranceDomain: retained[0] ?? 'general',
    runnerUpDomain,
  };
}

function finalizePresenceVote(
  start: number,
  domainScores: Record<string, number>,
  parentTermVoteCount: number
): UtteranceDomainVoteResult {
  const selected = selectRetainedDomains(domainScores);
  return {
    utteranceDomain: selected.utteranceDomain,
    domainVoteMs: Date.now() - start,
    insufficientEvidence: selected.insufficientEvidence,
    domainScores,
    parentTermVoteCount,
    winnerScore: selected.maxCount,
    runnerUpDomain: selected.runnerUpDomain,
    runnerUpScore: selected.runnerUpCount,
    voteMargin: selected.maxCount - selected.runnerUpCount,
    retainedDomains: selected.retainedDomains,
    maxCount: selected.maxCount,
    runnerUpCount: selected.runnerUpCount,
    isTie: selected.isTie,
  };
}

function accumulateSpanDomainSets(
  spanDomainSets: Iterable<ReadonlySet<string>>
): Record<string, number> {
  const domainScores: Record<string, number> = {};
  for (const domainSet of spanDomainSets) {
    for (const domain of domainSet) {
      domainScores[domain] = (domainScores[domain] ?? 0) + 1;
    }
  }
  return domainScores;
}

/**
 * Build FineSpanDomainSet for one fine span: union of domains from vote-eligible candidates.
 * Same domain from multiple candidates in one span → one presence in the set (one vote).
 */
export function buildFineSpanDomainSet(candidates: PoolVoteCandidate[]): Set<string> {
  const domainSet = new Set<string>();
  const seenKeys = new Set<string>();

  for (const candidate of candidates) {
    if (candidate.isCovered) {
      continue;
    }
    if (!isDomainVoteSource(candidate.source)) {
      continue;
    }

    const structuralKey =
      candidate.hitKind === 'parent_fragment' && candidate.parentTermId
        ? `parent:${candidate.parentTermId}`
        : candidate.candidateId
          ? `id:${candidate.candidateId}`
          : `exact:${candidate.syllableStart}:${candidate.syllableEnd}:${candidate.score}`;

    if (seenKeys.has(structuralKey)) {
      continue;
    }
    seenKeys.add(structuralKey);
    addDomainsToSet(domainSet, candidate.domains);
  }

  return domainSet;
}

export function voteUtteranceDomainFromPool(pool: FineSpanPoolForVote[]): UtteranceDomainVoteResult {
  const start = Date.now();
  const spanDomainSets: Set<string>[] = [];
  const votedParentTermIds = new Set<string>();
  let parentTermVoteCount = 0;

  for (const spanPool of pool) {
    for (const candidate of spanPool.candidates) {
      if (
        candidate.hitKind === 'parent_fragment' &&
        candidate.parentTermId &&
        !candidate.isCovered &&
        isDomainVoteSource(candidate.source) &&
        !votedParentTermIds.has(candidate.parentTermId)
      ) {
        votedParentTermIds.add(candidate.parentTermId);
        parentTermVoteCount += 1;
      }
    }
    spanDomainSets.push(buildFineSpanDomainSet(spanPool.candidates));
  }

  return finalizePresenceVote(
    start,
    accumulateSpanDomainSets(spanDomainSets),
    parentTermVoteCount
  );
}

/** Allocate per-bucket sentence budget. Throws if retained buckets cannot each get ≥1 slot. */
export function allocateDomainBucketSentenceBudget(
  retainedDomainCount: number,
  maxSentenceCandidates: number
): number {
  const bucketCount = Math.max(1, retainedDomainCount);
  const perBucket = Math.floor(maxSentenceCandidates / bucketCount);
  if (perBucket < 1) {
    throw new Error(
      'FINE-SPAN DOMAIN PRESENCE VOTE REPAIR BLOCKED — retained domain buckets exceed sentence candidate budget'
    );
  }
  return perBucket;
}
