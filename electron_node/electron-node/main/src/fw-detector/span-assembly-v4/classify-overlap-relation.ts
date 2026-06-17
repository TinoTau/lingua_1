import type { CoverageRelation, OverlapRelationType, WindowCandidate } from './v4-types';

export function syllableOverlap(a: WindowCandidate, b: WindowCandidate): boolean {
  return a.syllableStart < b.syllableEnd && b.syllableStart < a.syllableEnd;
}

export function syllableAdjacent(a: WindowCandidate, b: WindowCandidate): boolean {
  return a.syllableEnd === b.syllableStart || b.syllableEnd === a.syllableStart;
}

function rawOverlap(a: WindowCandidate, b: WindowCandidate): boolean {
  return a.rawStart < b.rawEnd && b.rawStart < a.rawEnd;
}

function overlapReplacementSlices(
  a: WindowCandidate,
  b: WindowCandidate
): { sliceA: string; sliceB: string } | null {
  if (!rawOverlap(a, b)) {
    return null;
  }
  const overlapStart = Math.max(a.rawStart, b.rawStart);
  const overlapEnd = Math.min(a.rawEnd, b.rawEnd);
  if (overlapStart >= overlapEnd) {
    return null;
  }
  const lenA = a.rawEnd - a.rawStart;
  const lenB = b.rawEnd - b.rawStart;
  const relStartA = overlapStart - a.rawStart;
  const relEndA = overlapEnd - a.rawStart;
  const relStartB = overlapStart - b.rawStart;
  const relEndB = overlapEnd - b.rawStart;
  const sliceA = a.replacement.slice(
    Math.round((relStartA / lenA) * a.replacement.length),
    Math.round((relEndA / lenA) * a.replacement.length)
  );
  const sliceB = b.replacement.slice(
    Math.round((relStartB / lenB) * b.replacement.length),
    Math.round((relEndB / lenB) * b.replacement.length)
  );
  return { sliceA, sliceB };
}

function sameParentTermOverlapCompatible(a: WindowCandidate, b: WindowCandidate): boolean {
  if (!a.parentTermId || !b.parentTermId || a.parentTermId !== b.parentTermId) {
    return false;
  }
  if (a.matchedTermStart == null || a.matchedTermEnd == null) {
    return false;
  }
  if (b.matchedTermStart == null || b.matchedTermEnd == null) {
    return false;
  }
  const matchedOverlap =
    a.matchedTermStart < b.matchedTermEnd && b.matchedTermStart < a.matchedTermEnd;
  if (!matchedOverlap) {
    return true;
  }
  const start = Math.max(a.matchedTermStart, b.matchedTermStart);
  const end = Math.min(a.matchedTermEnd, b.matchedTermEnd);
  const fragA = a.parentTerm?.slice(start, end) ?? '';
  const fragB = b.parentTerm?.slice(start, end) ?? '';
  return fragA === fragB;
}

function replacementContains(parentReplacement: string, childReplacement: string): boolean {
  if (childReplacement.length >= parentReplacement.length) {
    return false;
  }
  return parentReplacement.includes(childReplacement);
}

function syllableContains(parent: WindowCandidate, child: WindowCandidate): boolean {
  return parent.syllableStart <= child.syllableStart && parent.syllableEnd >= child.syllableEnd;
}

function parentTermCompletenessScore(candidate: WindowCandidate): number {
  if (candidate.hitKind === 'exact_term') {
    return 2;
  }
  if (candidate.parentTerm && candidate.replacement === candidate.parentTerm) {
    return 2;
  }
  return 1;
}

export function pickCoverageParent(a: WindowCandidate, b: WindowCandidate): WindowCandidate {
  const spanA = a.syllableEnd - a.syllableStart;
  const spanB = b.syllableEnd - b.syllableStart;
  if (spanA !== spanB) {
    return spanA > spanB ? a : b;
  }
  if (a.replacement.length !== b.replacement.length) {
    return a.replacement.length > b.replacement.length ? a : b;
  }
  const completenessA = parentTermCompletenessScore(a);
  const completenessB = parentTermCompletenessScore(b);
  if (completenessA !== completenessB) {
    return completenessA > completenessB ? a : b;
  }
  return a.candidateId <= b.candidateId ? a : b;
}

export function isMoreCompleteParent(
  candidate: WindowCandidate,
  other: WindowCandidate
): boolean {
  return pickCoverageParent(candidate, other).candidateId === candidate.candidateId;
}

export function resolveCoverageParentChild(
  a: WindowCandidate,
  b: WindowCandidate
): { parent: WindowCandidate; child: WindowCandidate } | null {
  const parent = pickCoverageParent(a, b);
  const child = parent.candidateId === a.candidateId ? b : a;
  if (!replacementContains(parent.replacement, child.replacement)) {
    return null;
  }
  if (!syllableContains(parent, child)) {
    return null;
  }
  return { parent, child };
}

export function classifyOverlapRelation(
  a: WindowCandidate,
  b: WindowCandidate
): OverlapRelationType {
  if (a.candidateId === b.candidateId) {
    return 'COMPATIBLE';
  }

  const hasSyllableOverlap = syllableOverlap(a, b);
  const hasRawOverlap = rawOverlap(a, b);

  if (!hasSyllableOverlap && !hasRawOverlap) {
    return 'COMPATIBLE';
  }

  const slices = overlapReplacementSlices(a, b);
  if (slices && slices.sliceA === slices.sliceB && a.replacement.length === b.replacement.length) {
    return 'COMPATIBLE';
  }

  if (resolveCoverageParentChild(a, b)) {
    return 'COVERAGE';
  }

  if (a.parentTermId && b.parentTermId && a.parentTermId === b.parentTermId) {
    if (sameParentTermOverlapCompatible(a, b)) {
      return 'COMPATIBLE';
    }
  }

  if (hasSyllableOverlap || hasRawOverlap) {
    return 'CONFLICT';
  }

  return 'COMPATIBLE';
}

export function toCoverageRelation(
  parent: WindowCandidate,
  child: WindowCandidate
): CoverageRelation {
  return {
    parentCandidateId: parent.candidateId,
    childCandidateId: child.candidateId,
  };
}
