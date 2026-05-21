import type { LexiconBoundCandidate } from './types';

export function candidatePriority(candidate: LexiconBoundCandidate): number {
  return candidate.sourceEvidence.phonetic?.lexiconCandidate?.priority ?? 0;
}

/** phoneticScore desc → priority desc → start asc */
export function compareBoundCandidates(
  a: LexiconBoundCandidate,
  b: LexiconBoundCandidate
): number {
  const scoreA = a.replacement.phoneticScore ?? 0;
  const scoreB = b.replacement.phoneticScore ?? 0;
  if (scoreB !== scoreA) {
    return scoreB - scoreA;
  }
  const priA = candidatePriority(a);
  const priB = candidatePriority(b);
  if (priB !== priA) {
    return priB - priA;
  }
  return a.replacement.start - b.replacement.start;
}
