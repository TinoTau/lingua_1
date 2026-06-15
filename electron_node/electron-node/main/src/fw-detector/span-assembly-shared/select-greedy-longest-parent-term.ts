import type { ParentSpanCandidate } from './types';

/** Positive when a ranks higher than b (V2.0 §7 + V2.1 D-10). */
export function compareParentSpanCandidateRank(
  a: ParentSpanCandidate,
  b: ParentSpanCandidate,
  utteranceDomain: string
): number {
  if (a.isFullCoverage !== b.isFullCoverage) {
    return a.isFullCoverage ? 1 : -1;
  }
  if (a.parentTermLength !== b.parentTermLength) {
    return a.parentTermLength - b.parentTermLength;
  }
  if (a.rawCoverageRatio !== b.rawCoverageRatio) {
    return a.rawCoverageRatio - b.rawCoverageRatio;
  }
  if (a.evidenceCount !== b.evidenceCount) {
    return a.evidenceCount - b.evidenceCount;
  }
  if (a.repairTarget !== b.repairTarget) {
    return a.repairTarget ? 1 : -1;
  }
  if (a.score !== b.score) {
    return a.score - b.score;
  }
  const aDomain = a.domainId === utteranceDomain ? 1 : 0;
  const bDomain = b.domainId === utteranceDomain ? 1 : 0;
  if (aDomain !== bDomain) {
    return aDomain - bDomain;
  }
  return a.parentTermId.localeCompare(b.parentTermId);
}

function syllableIntervalContains(
  outer: ParentSpanCandidate,
  inner: ParentSpanCandidate
): boolean {
  return outer.syllableStart <= inner.syllableStart && outer.syllableEnd >= inner.syllableEnd;
}

function isDominatedBy(
  candidate: ParentSpanCandidate,
  other: ParentSpanCandidate,
  utteranceDomain: string
): boolean {
  if (candidate.parentTermId === other.parentTermId) {
    return false;
  }
  if (!syllableIntervalContains(other, candidate)) {
    return false;
  }
  return compareParentSpanCandidateRank(other, candidate, utteranceDomain) > 0;
}

export function pruneDominatedParentSpanCandidates(
  candidates: ParentSpanCandidate[],
  utteranceDomain: string
): ParentSpanCandidate[] {
  return candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) => other !== candidate && isDominatedBy(candidate, other, utteranceDomain)
      )
  );
}

export function selectGreedyLongestParentSpanCandidate(
  candidates: ParentSpanCandidate[],
  utteranceDomain: string
): ParentSpanCandidate | null {
  if (!candidates.length) {
    return null;
  }
  const pruned = pruneDominatedParentSpanCandidates(candidates, utteranceDomain);
  let best = pruned[0];
  for (let i = 1; i < pruned.length; i++) {
    if (compareParentSpanCandidateRank(pruned[i], best, utteranceDomain) > 0) {
      best = pruned[i];
    }
  }
  return best;
}
