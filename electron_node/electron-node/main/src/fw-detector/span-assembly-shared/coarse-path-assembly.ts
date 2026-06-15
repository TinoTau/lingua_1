import type { CoarseSpan, CoarseSpanPath, GraphEdge } from './types';
import { CoarseAssemblyLimits } from './limits';

export function edgeBelongsToSpan(edge: GraphEdge, span: CoarseSpan): boolean {
  if (edge.coarseSpanId) {
    return edge.coarseSpanId === span.id;
  }
  return edge.syllableStart >= span.syllableStart && edge.syllableEnd <= span.syllableEnd;
}

function edgesInCoarseSpan(span: CoarseSpan, edges: GraphEdge[]): GraphEdge[] {
  return edges.filter((e) => edgeBelongsToSpan(e, span));
}

function isParentSpanCandidate(edge: GraphEdge): boolean {
  return edge.hitKind === 'parent_span_candidate';
}

function pathScore(edges: GraphEdge[]): number {
  const coverage = edges.reduce((s, e) => s + (e.syllableEnd - e.syllableStart), 0);
  const scoreSum = edges.reduce((s, e) => s + e.score, 0);
  const hasParentSpan = edges.some(isParentSpanCandidate);
  const fragmentPenalty = hasParentSpan ? 0 : edges.length > 1 ? 0 : 0.1;
  const parentSpanBonus = hasParentSpan ? 0.25 : 0;
  const lengthBonus = edges.reduce((s, e) => s + (e.syllableEnd - e.syllableStart) * 0.05, 0);
  return scoreSum + lengthBonus + coverage * 0.02 + parentSpanBonus - fragmentPenalty;
}

function greedyNonOverlappingPaths(span: CoarseSpan, candidates: GraphEdge[]): GraphEdge[] {
  const parentSpans = candidates.filter(isParentSpanCandidate);
  const others = candidates.filter((e) => !isParentSpanCandidate(e));
  const sorted = [...parentSpans, ...others].sort(
    (a, b) =>
      (isParentSpanCandidate(b) ? 1 : 0) - (isParentSpanCandidate(a) ? 1 : 0) ||
      b.score - a.score ||
      b.syllableEnd - b.syllableStart - (a.syllableEnd - a.syllableStart)
  );
  const picked: GraphEdge[] = [];
  const covered = new Set<number>();

  for (const edge of sorted) {
    let overlaps = false;
    for (let i = edge.syllableStart; i < edge.syllableEnd; i++) {
      if (covered.has(i)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) {
      continue;
    }
    for (let i = edge.syllableStart; i < edge.syllableEnd; i++) {
      covered.add(i);
    }
    picked.push(edge);
  }

  return picked;
}

export function assembleCoarsePaths(
  coarseSpans: CoarseSpan[],
  edges: GraphEdge[]
): CoarseSpanPath[] {
  const paths: CoarseSpanPath[] = [];

  for (const span of coarseSpans) {
    const spanEdges = edgesInCoarseSpan(span, edges);
    const variants: GraphEdge[][] = [];

    const greedy = greedyNonOverlappingPaths(span, spanEdges);
    if (greedy.length) {
      variants.push(greedy);
    }

    const topSingle = [...spanEdges]
      .sort(
        (a, b) =>
          (isParentSpanCandidate(b) ? 1 : 0) - (isParentSpanCandidate(a) ? 1 : 0) ||
          b.score - a.score
      )
      .slice(0, CoarseAssemblyLimits.maxCoarsePathsPerSpan);
    for (const edge of topSingle) {
      if (!variants.some((v) => v.length === 1 && v[0].ngramKey === edge.ngramKey)) {
        variants.push([edge]);
      }
    }

    const rawPath: GraphEdge[] = [];
    variants.push(rawPath);

    const unique = variants.slice(0, CoarseAssemblyLimits.maxCoarsePathsPerSpan);
    for (let i = 0; i < unique.length; i++) {
      paths.push({
        coarseSpanId: span.id,
        edges: unique[i],
        score: pathScore(unique[i]),
      });
    }
  }

  return paths;
}
