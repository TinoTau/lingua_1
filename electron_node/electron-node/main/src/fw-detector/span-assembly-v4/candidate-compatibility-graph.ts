import {
  classifyOverlapRelation,
  isMoreCompleteParent,
  resolveCoverageParentChild,
  syllableAdjacent,
  syllableOverlap,
  toCoverageRelation,
} from './classify-overlap-relation';
import type {
  CompatibilityMetrics,
  CompatibilityResult,
  ConflictRelation,
  CoverageRelation,
  OverlapRelationType,
  WindowCandidate,
} from './v4-types';
import type { V4TraceCollector } from './v4-diagnostics-trace';
import { resolveCompatReason, toCandidatePoolTrace } from './v4-diagnostics-mappers';

export type CompatibilityGraphEdge = {
  fromId: string;
  toId: string;
  compatible: boolean;
  overlapRelationType: OverlapRelationType;
};

export function areCandidatesCompatible(a: WindowCandidate, b: WindowCandidate): boolean {
  return classifyOverlapRelation(a, b) !== 'CONFLICT';
}

export function buildCandidateCompatibilityGraph(candidates: WindowCandidate[]): {
  edges: CompatibilityGraphEdge[];
  edgeCount: number;
} {
  const edges: CompatibilityGraphEdge[] = [];

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      if (!syllableOverlap(a, b) && !syllableAdjacent(a, b)) {
        continue;
      }
      const overlapRelationType = classifyOverlapRelation(a, b);
      edges.push({
        fromId: a.candidateId,
        toId: b.candidateId,
        compatible: overlapRelationType !== 'CONFLICT',
        overlapRelationType,
      });
    }
  }

  return { edges, edgeCount: edges.length };
}

function pairKey(aId: string, bId: string): string {
  return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
}

function removeChildFromParent(parent: WindowCandidate, childId: string): void {
  if (!parent.coveredChildren?.length) {
    return;
  }
  parent.coveredChildren = parent.coveredChildren.filter((id) => id !== childId);
  if (parent.coveredChildren.length === 0) {
    parent.coveredChildren = undefined;
  }
}

function applyCoverageRelation(
  pool: WindowCandidate[],
  parent: WindowCandidate,
  child: WindowCandidate,
  coverageRelations: CoverageRelation[]
): boolean {
  if (child.coveredBy === parent.candidateId) {
    return false;
  }

  if (child.coveredBy) {
    const existingParent = pool.find((c) => c.candidateId === child.coveredBy);
    if (existingParent && !isMoreCompleteParent(parent, existingParent)) {
      return false;
    }
    if (existingParent) {
      removeChildFromParent(existingParent, child.candidateId);
    }
  }

  child.isCovered = true;
  child.coveredBy = parent.candidateId;
  parent.coveredChildren = parent.coveredChildren ?? [];
  if (!parent.coveredChildren.includes(child.candidateId)) {
    parent.coveredChildren.push(child.candidateId);
  }
  coverageRelations.push(toCoverageRelation(parent, child));
  return true;
}

function findConflictPairs(
  pool: WindowCandidate[],
  edges: CompatibilityGraphEdge[]
): Array<[WindowCandidate, WindowCandidate]> {
  const byId = new Map(pool.map((c) => [c.candidateId, c]));
  const pairs: Array<[WindowCandidate, WindowCandidate]> = [];

  for (const edge of edges) {
    if (edge.overlapRelationType !== 'CONFLICT') {
      continue;
    }
    const a = byId.get(edge.fromId);
    const b = byId.get(edge.toId);
    if (!a || !b) {
      continue;
    }
    if (a.isCovered || b.isCovered) {
      continue;
    }
    if (syllableOverlap(a, b)) {
      pairs.push([a, b]);
    }
  }

  return pairs;
}

function applyPhase1Coverage(
  pool: WindowCandidate[],
  edges: CompatibilityGraphEdge[],
  coverageRelations: CoverageRelation[],
  countedCoveragePairs: Set<string>
): boolean {
  const byId = new Map(pool.map((c) => [c.candidateId, c]));
  let changed = false;

  for (const edge of edges) {
    if (edge.overlapRelationType !== 'COVERAGE') {
      continue;
    }
    const a = byId.get(edge.fromId);
    const b = byId.get(edge.toId);
    if (!a || !b) {
      continue;
    }
    const relation = resolveCoverageParentChild(a, b);
    if (!relation) {
      continue;
    }
    const { parent, child } = relation;
    const beforeChildCoveredBy = child.coveredBy;
    if (applyCoverageRelation(pool, parent, child, coverageRelations)) {
      changed = true;
      countedCoveragePairs.add(pairKey(parent.candidateId, child.candidateId));
    } else if (child.coveredBy !== beforeChildCoveredBy) {
      changed = true;
    }
  }

  return changed;
}

function windowSourceRank(source: WindowCandidate['windowSource']): number {
  return source === 'in_span_window' ? 1 : 0;
}

/** Reserved for future narrow hardDrop stub; not used on Compatibility main path. */
function pickDropCandidate(a: WindowCandidate, b: WindowCandidate): WindowCandidate {
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

function traceCompatibilityEdges(
  edges: CompatibilityGraphEdge[],
  pool: WindowCandidate[],
  trace: V4TraceCollector
): void {
  const byId = new Map(pool.map((c) => [c.candidateId, c]));
  for (const edge of edges) {
    if (edge.overlapRelationType === 'CONFLICT') {
      continue;
    }
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
      overlapRelationType: edge.overlapRelationType,
      reason: resolveCompatReason(a, b, edge.overlapRelationType),
    });
    if (edge.overlapRelationType === 'COVERAGE') {
      const relation = resolveCoverageParentChild(a, b);
      if (relation) {
        trace.lifecycle.markCovered(
          relation.child.candidateId,
          relation.child.replacement,
          relation.parent.candidateId
        );
      }
    }
  }
}

function recordConflictRelations(
  pairs: Array<[WindowCandidate, WindowCandidate]>,
  conflictRelations: ConflictRelation[],
  countedConflictPairs: Set<string>,
  trace?: V4TraceCollector | null
): void {
  for (const [a, b] of pairs) {
    const key = pairKey(a.candidateId, b.candidateId);
    if (countedConflictPairs.has(key)) {
      continue;
    }
    countedConflictPairs.add(key);
    const reason = resolveCompatReason(a, b, 'CONFLICT');
    conflictRelations.push({
      candidateIdA: a.candidateId,
      candidateIdB: b.candidateId,
      relationType: 'CONFLICT',
      source: 'syllable_overlap',
      reason,
    });
    if (trace) {
      trace.pushCompatibilityEdge({
        sourceCandidateId: a.candidateId,
        targetCandidateId: b.candidateId,
        sourceReplacement: a.replacement,
        targetReplacement: b.replacement,
        compatible: false,
        overlapRelationType: 'CONFLICT',
        reason,
      });
      trace.lifecycle.markConflictRelationCreated(a.candidateId, a.replacement);
      trace.lifecycle.markConflictRelationCreated(b.candidateId, b.replacement);
    }
  }
}

export function resolveCompatibilityRelations(
  candidates: WindowCandidate[],
  trace?: V4TraceCollector | null
): CompatibilityResult {
  const pool = candidates.map((candidate) => ({ ...candidate }));
  const coverageRelations: CoverageRelation[] = [];
  const conflictRelations: ConflictRelation[] = [];
  const countedCoveragePairs = new Set<string>();
  const countedCompatiblePairs = new Set<string>();
  const countedConflictPairs = new Set<string>();
  let compatibleCount = 0;
  let changed = true;

  if (trace) {
    for (const candidate of pool) {
      trace.pushPoolBeforeDrop(toCandidatePoolTrace(candidate));
    }
  }

  while (changed) {
    changed = false;
    const { edges } = buildCandidateCompatibilityGraph(pool);

    if (trace) {
      traceCompatibilityEdges(edges, pool, trace);
    }

    for (const edge of edges) {
      if (edge.overlapRelationType !== 'COMPATIBLE') {
        continue;
      }
      const key = pairKey(edge.fromId, edge.toId);
      if (!countedCompatiblePairs.has(key)) {
        countedCompatiblePairs.add(key);
        compatibleCount += 1;
      }
    }

    if (applyPhase1Coverage(pool, edges, coverageRelations, countedCoveragePairs)) {
      changed = true;
    }
  }

  const { edges: finalEdges } = buildCandidateCompatibilityGraph(pool);
  recordConflictRelations(
    findConflictPairs(pool, finalEdges),
    conflictRelations,
    countedConflictPairs,
    trace
  );

  if (trace) {
    for (const candidate of pool) {
      trace.pushPoolAfterDrop(toCandidatePoolTrace(candidate));
    }
  }

  const metrics: CompatibilityMetrics = {
    activeCandidateCount: pool.length,
    coverageCount: countedCoveragePairs.size,
    conflictRelationCount: countedConflictPairs.size,
    hardDropCount: 0,
    compatibleCount,
  };

  return {
    activeCandidates: pool,
    coverageRelations,
    conflictRelations,
    hardDropCandidates: [],
    metrics,
  };
}

/** @deprecated use resolveCompatibilityRelations */
export function dropIncompatibleCandidates(
  candidates: WindowCandidate[],
  trace?: V4TraceCollector | null
): {
  survivors: WindowCandidate[];
  droppedCount: number;
  coverageCount: number;
  conflictCount: number;
  compatibleCount: number;
  coverageRelations: CoverageRelation[];
} {
  const result = resolveCompatibilityRelations(candidates, trace);
  return {
    survivors: result.activeCandidates,
    droppedCount: result.metrics.hardDropCount,
    coverageCount: result.metrics.coverageCount,
    conflictCount: result.metrics.conflictRelationCount,
    compatibleCount: result.metrics.compatibleCount,
    coverageRelations: result.coverageRelations,
  };
}

/** @deprecated use findConflictPairs via resolveCompatibilityRelations */
export function findIncompatiblePairs(
  candidates: WindowCandidate[],
  edges: Array<{ fromId: string; toId: string; compatible: boolean; overlapRelationType?: OverlapRelationType }>
): Array<[WindowCandidate, WindowCandidate]> {
  const normalized: CompatibilityGraphEdge[] = edges.map((edge) => ({
    ...edge,
    overlapRelationType: edge.overlapRelationType ?? (edge.compatible ? 'COMPATIBLE' : 'CONFLICT'),
  }));
  return findConflictPairs(candidates, normalized);
}

/** @internal test-only export for narrow hardDrop stub */
export const __testOnly = { pickDropCandidate };
