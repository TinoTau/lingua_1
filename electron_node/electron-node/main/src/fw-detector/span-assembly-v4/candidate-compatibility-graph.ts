import type { WindowCandidate } from './v4-types';
import type { V4TraceCollector } from './v4-diagnostics-trace';
import { resolveCompatReason, resolveDropReason, toCandidatePoolTrace } from './v4-diagnostics-mappers';

function syllableOverlap(a: WindowCandidate, b: WindowCandidate): boolean {
  return a.syllableStart < b.syllableEnd && b.syllableStart < a.syllableEnd;
}

function syllableAdjacent(a: WindowCandidate, b: WindowCandidate): boolean {
  return a.syllableEnd === b.syllableStart || b.syllableEnd === a.syllableStart;
}

function rawOverlap(a: WindowCandidate, b: WindowCandidate): boolean {
  return a.rawStart < b.rawEnd && b.rawStart < a.rawEnd;
}

function overlapReplacement(a: WindowCandidate, b: WindowCandidate): string {
  const start = Math.max(a.rawStart, b.rawStart);
  const end = Math.min(a.rawEnd, b.rawEnd);
  const lenA = a.rawEnd - a.rawStart;
  const lenB = b.rawEnd - b.rawStart;
  const relStartA = start - a.rawStart;
  const relEndA = end - a.rawStart;
  const relStartB = start - b.rawStart;
  const relEndB = end - b.rawStart;
  const sliceA = a.replacement.slice(
    Math.round((relStartA / lenA) * a.replacement.length),
    Math.round((relEndA / lenA) * a.replacement.length)
  );
  const sliceB = b.replacement.slice(
    Math.round((relStartB / lenB) * b.replacement.length),
    Math.round((relEndB / lenB) * b.replacement.length)
  );
  return sliceA === sliceB ? sliceA : `${sliceA}|${sliceB}`;
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
  const overlap =
    a.matchedTermStart < b.matchedTermEnd && b.matchedTermStart < a.matchedTermEnd;
  if (!overlap) {
    return true;
  }
  const start = Math.max(a.matchedTermStart, b.matchedTermStart);
  const end = Math.min(a.matchedTermEnd, b.matchedTermEnd);
  const fragA = a.parentTerm?.slice(start, end) ?? '';
  const fragB = b.parentTerm?.slice(start, end) ?? '';
  return fragA === fragB;
}

export function areCandidatesCompatible(a: WindowCandidate, b: WindowCandidate): boolean {
  if (a.candidateId === b.candidateId) {
    return true;
  }

  if (a.parentTermId && b.parentTermId && a.parentTermId === b.parentTermId) {
    return sameParentTermOverlapCompatible(a, b);
  }

  if (!rawOverlap(a, b) && !syllableOverlap(a, b)) {
    return true;
  }

  if (rawOverlap(a, b)) {
    const overlapStart = Math.max(a.rawStart, b.rawStart);
    const overlapEnd = Math.min(a.rawEnd, b.rawEnd);
    if (overlapStart >= overlapEnd) {
      return true;
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
    return sliceA === sliceB;
  }

  return overlapReplacement(a, b) !== '';
}

export function buildCandidateCompatibilityGraph(candidates: WindowCandidate[]): {
  edges: Array<{ fromId: string; toId: string; compatible: boolean }>;
  edgeCount: number;
} {
  const edges: Array<{ fromId: string; toId: string; compatible: boolean }> = [];

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      if (!syllableOverlap(a, b) && !syllableAdjacent(a, b)) {
        continue;
      }
      const compatible = areCandidatesCompatible(a, b);
      edges.push({ fromId: a.candidateId, toId: b.candidateId, compatible });
    }
  }

  return { edges, edgeCount: edges.length };
}

export function findIncompatiblePairs(
  candidates: WindowCandidate[],
  edges: Array<{ fromId: string; toId: string; compatible: boolean }>
): Array<[WindowCandidate, WindowCandidate]> {
  const byId = new Map(candidates.map((c) => [c.candidateId, c]));
  const pairs: Array<[WindowCandidate, WindowCandidate]> = [];

  for (const edge of edges) {
    if (edge.compatible) {
      continue;
    }
    const a = byId.get(edge.fromId);
    const b = byId.get(edge.toId);
    if (!a || !b) {
      continue;
    }
    if (syllableOverlap(a, b)) {
      pairs.push([a, b]);
    }
  }

  return pairs;
}

function windowSourceRank(source: WindowCandidate['windowSource']): number {
  return source === 'in_span_window' ? 1 : 0;
}

export function pickDropCandidate(a: WindowCandidate, b: WindowCandidate): WindowCandidate {
  if (a.score !== b.score) {
    return a.score < b.score ? a : b;
  }
  const rankA = windowSourceRank(a.windowSource);
  const rankB = windowSourceRank(b.windowSource);
  if (rankA !== rankB) {
    return rankA < rankB ? a : b;
  }
  if (a.candidateRank !== b.candidateRank) {
    return a.candidateRank > b.candidateRank ? a : b;
  }
  return a.candidateId > b.candidateId ? a : b;
}

export function dropIncompatibleCandidates(
  candidates: WindowCandidate[],
  trace?: V4TraceCollector | null
): {
  survivors: WindowCandidate[];
  droppedCount: number;
} {
  let pool = [...candidates];
  let droppedCount = 0;
  let changed = true;

  if (trace) {
    for (const candidate of pool) {
      trace.pushPoolBeforeDrop(toCandidatePoolTrace(candidate));
    }
  }

  while (changed) {
    changed = false;
    const { edges } = buildCandidateCompatibilityGraph(pool);
    const pairs = findIncompatiblePairs(pool, edges);
    const toDrop = new Set<string>();

    if (trace) {
      const byId = new Map(pool.map((c) => [c.candidateId, c]));
      for (const edge of edges) {
        const a = byId.get(edge.fromId);
        const b = byId.get(edge.toId);
        if (!a || !b) {
          continue;
        }
        trace.pushCompatibilityEdge({
          sourceCandidateId: edge.fromId,
          targetCandidateId: edge.toId,
          sourceReplacement: a.replacement,
          targetReplacement: b.replacement,
          compatible: edge.compatible,
          reason: resolveCompatReason(a, b, edge.compatible),
        });
      }
    }

    for (const [a, b] of pairs) {
      if (toDrop.has(a.candidateId) || toDrop.has(b.candidateId)) {
        continue;
      }
      const loser = pickDropCandidate(a, b);
      const winner = loser.candidateId === a.candidateId ? b : a;
      const dropReason = resolveDropReason(winner, loser);
      toDrop.add(loser.candidateId);
      droppedCount += 1;
      changed = true;

      if (trace) {
        trace.pushCompatibilityEdge({
          sourceCandidateId: a.candidateId,
          targetCandidateId: b.candidateId,
          sourceReplacement: a.replacement,
          targetReplacement: b.replacement,
          compatible: false,
          reason: resolveCompatReason(a, b, false),
          droppedCandidateId: loser.candidateId,
          dropReason,
        });
      }
    }

    if (toDrop.size) {
      pool = pool.filter((c) => !toDrop.has(c.candidateId));
    }
  }

  if (trace) {
    for (const candidate of pool) {
      trace.pushPoolAfterDrop(toCandidatePoolTrace(candidate));
    }
  }

  return { survivors: pool, droppedCount };
}
