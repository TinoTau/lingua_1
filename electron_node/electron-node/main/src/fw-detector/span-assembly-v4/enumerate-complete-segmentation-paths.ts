import type { LexicalEdge } from './build-lexical-edges';
import type { PathCapEvent, PrunedSegmentationPathTrace, SegmentationPath } from './lattice-path-types';
import { derivePathId } from './build-boundary-key';

/** Fields used by lattice path pruning / best-first ranking (SSOT). */
export type SegmentationPathRankingFields = {
  boundaryKey: string;
  fallbackEdgeCount: number;
  fuzzyEdgeCount: number;
  toneRelaxedEdgeCount: number;
  exactEdgeCount: number;
  lexicalEdgeCount: number;
};

export interface EnumeratePathInput {
  syllableCount: number;
  lexicalEdges: readonly LexicalEdge[];
  limits: {
    maxActivePathsPerPosition: number;
    maxCompleteSegmentationPaths: number;
  };
}

type PartialPath = {
  edges: LexicalEdge[];
  boundaryKey: string; // prefix boundary sequence
  fallbackEdgeCount: number;
  exactEdgeCount: number;
  toneRelaxedEdgeCount: number;
  fuzzyEdgeCount: number;
};

export interface EnumeratePathResult {
  paths: readonly SegmentationPath[];
  completePathCountBeforePrune: number;
  retainedCompletePathCount: number;
  prunedPaths: readonly PrunedSegmentationPathTrace[];
  capEvents: readonly PathCapEvent[];
}

function edgeKindRank(edge: LexicalEdge): number {
  // lexical first
  return edge.edgeKind === 'lexical' ? 0 : 1;
}

function structuralCountsForEdge(edge: LexicalEdge): Omit<PartialPath, 'edges' | 'boundaryKey'> {
  const fallbackEdgeCount = edge.edgeKind === 'fallback' ? 1 : 0;
  const exactEdgeCount = edge.edgeKind === 'lexical' && edge.recallEvidence.hasExact ? 1 : 0;
  const toneRelaxedEdgeCount =
    edge.edgeKind === 'lexical' && edge.recallEvidence.hasToneRelaxed ? 1 : 0;
  const fuzzyEdgeCount = edge.edgeKind === 'lexical' && edge.recallEvidence.hasFuzzy ? 1 : 0;
  return { fallbackEdgeCount, exactEdgeCount, toneRelaxedEdgeCount, fuzzyEdgeCount };
}

function validateLexicalEdgeGraph(input: {
  syllableCount: number;
  lexicalEdges: readonly LexicalEdge[];
}): LexicalEdge[][] {
  const { syllableCount, lexicalEdges } = input;

  if (syllableCount <= 0) {
    throw new Error('[enumerateCompleteSegmentationPaths] syllableCount must be > 0');
  }

  const outgoing: LexicalEdge[][] = Array.from({ length: syllableCount + 1 }, () => []);
  const seen = new Set<string>();

  for (const e of lexicalEdges) {
    if (e.syllableStart < 0 || e.syllableEnd <= e.syllableStart) {
      throw new Error(`[enumerateCompleteSegmentationPaths] illegal edge range ${e.syllableStart}:${e.syllableEnd}`);
    }
    const len = e.syllableEnd - e.syllableStart;
    if (len < 1 || len > 5) {
      throw new Error(`[enumerateCompleteSegmentationPaths] illegal edge length=${len} for ${e.syllableStart}:${e.syllableEnd}`);
    }
    if (e.syllableEnd > syllableCount) {
      throw new Error(
        `[enumerateCompleteSegmentationPaths] edge end ${e.syllableEnd} > syllableCount=${syllableCount}`
      );
    }
    if (e.syllableStart >= syllableCount) {
      throw new Error(
        `[enumerateCompleteSegmentationPaths] edge start ${e.syllableStart} >= syllableCount=${syllableCount}`
      );
    }

    const key = `${e.syllableStart}:${e.syllableEnd}`;
    if (seen.has(key)) {
      throw new Error(`[enumerateCompleteSegmentationPaths] duplicate edge boundary ${key}`);
    }
    seen.add(key);
    outgoing[e.syllableStart]!.push(e);
  }

  // Stable outgoing ordering (deterministic independent from input array order).
  for (let i = 0; i < syllableCount; i += 1) {
    outgoing[i]!.sort((a, b) => {
      if (a.syllableEnd !== b.syllableEnd) return a.syllableEnd - b.syllableEnd;
      const kindA = edgeKindRank(a);
      const kindB = edgeKindRank(b);
      if (kindA !== kindB) return kindA - kindB;
      return a.edgeId.localeCompare(b.edgeId);
    });
  }

  return outgoing;
}

function lexicalEdgeCount(path: Pick<PartialPath, 'edges' | 'fallbackEdgeCount'>): number {
  return path.edges.length - path.fallbackEdgeCount;
}

/**
 * Lattice path ranking SSOT — returns negative if a is BETTER than b (best-first).
 * Used for per-position / complete-path pruning; consumers needing one path must reuse this.
 */
export function compareSegmentationPathRankingBestFirst(
  a: SegmentationPathRankingFields,
  b: SegmentationPathRankingFields
): number {
  // 1 fallbackEdgeCount ASC
  if (a.fallbackEdgeCount !== b.fallbackEdgeCount) return a.fallbackEdgeCount - b.fallbackEdgeCount;
  // 2 invalidGapCount ASC — we model as fallbackEdgeCount for V1.0.0 gap-finalized paths
  const invalidA = a.fallbackEdgeCount;
  const invalidB = b.fallbackEdgeCount;
  if (invalidA !== invalidB) return invalidA - invalidB;
  // 3 fuzzyEdgeCount ASC
  if (a.fuzzyEdgeCount !== b.fuzzyEdgeCount) return a.fuzzyEdgeCount - b.fuzzyEdgeCount;
  // 4 toneRelaxedEdgeCount ASC
  if (a.toneRelaxedEdgeCount !== b.toneRelaxedEdgeCount)
    return a.toneRelaxedEdgeCount - b.toneRelaxedEdgeCount;
  // 5 exactEdgeCount DESC
  if (a.exactEdgeCount !== b.exactEdgeCount) return b.exactEdgeCount - a.exactEdgeCount;
  // 6 lexicalEdgeCount DESC
  if (a.lexicalEdgeCount !== b.lexicalEdgeCount) return b.lexicalEdgeCount - a.lexicalEdgeCount;
  // 7 boundaryKey ASC
  return a.boundaryKey.localeCompare(b.boundaryKey);
}

/** Best-first compare for materialized SegmentationPath (same SSOT as pruning). */
export function compareSegmentationPathBestFirst(a: SegmentationPath, b: SegmentationPath): number {
  return compareSegmentationPathRankingBestFirst(
    {
      boundaryKey: a.boundaryKey,
      fallbackEdgeCount: a.fallbackEdgeCount,
      fuzzyEdgeCount: a.structuralEvidence.fuzzyEdgeCount,
      toneRelaxedEdgeCount: a.structuralEvidence.toneRelaxedEdgeCount,
      exactEdgeCount: a.structuralEvidence.exactEdgeCount,
      lexicalEdgeCount: a.lexicalEdgeCount,
    },
    {
      boundaryKey: b.boundaryKey,
      fallbackEdgeCount: b.fallbackEdgeCount,
      fuzzyEdgeCount: b.structuralEvidence.fuzzyEdgeCount,
      toneRelaxedEdgeCount: b.structuralEvidence.toneRelaxedEdgeCount,
      exactEdgeCount: b.structuralEvidence.exactEdgeCount,
      lexicalEdgeCount: b.lexicalEdgeCount,
    }
  );
}

function compareBestFirst(a: PartialPath, b: PartialPath): number {
  return compareSegmentationPathRankingBestFirst(
    {
      boundaryKey: a.boundaryKey,
      fallbackEdgeCount: a.fallbackEdgeCount,
      fuzzyEdgeCount: a.fuzzyEdgeCount,
      toneRelaxedEdgeCount: a.toneRelaxedEdgeCount,
      exactEdgeCount: a.exactEdgeCount,
      lexicalEdgeCount: lexicalEdgeCount(a),
    },
    {
      boundaryKey: b.boundaryKey,
      fallbackEdgeCount: b.fallbackEdgeCount,
      fuzzyEdgeCount: b.fuzzyEdgeCount,
      toneRelaxedEdgeCount: b.toneRelaxedEdgeCount,
      exactEdgeCount: b.exactEdgeCount,
      lexicalEdgeCount: lexicalEdgeCount(b),
    }
  );
}

function partialToSegmentationPath(p: PartialPath): SegmentationPath {
  // boundaryKey is already derived from the exact edge sequence.
  return {
    pathId: derivePathId(p.boundaryKey),
    boundaryKey: p.boundaryKey,
    edgeRefs: p.edges,
    lexicalEdgeCount: p.edges.length - p.fallbackEdgeCount,
    fallbackEdgeCount: p.fallbackEdgeCount,
    structuralEvidence: {
      exactEdgeCount: p.exactEdgeCount,
      toneRelaxedEdgeCount: p.toneRelaxedEdgeCount,
      fuzzyEdgeCount: p.fuzzyEdgeCount,
    },
  };
}

export function enumerateCompleteSegmentationPaths(input: EnumeratePathInput): EnumeratePathResult {
  const { syllableCount, lexicalEdges, limits } = input;
  const { maxActivePathsPerPosition, maxCompleteSegmentationPaths } = limits;

  if (maxActivePathsPerPosition <= 0 || maxCompleteSegmentationPaths <= 0) {
    throw new Error('[enumerateCompleteSegmentationPaths] caps must be > 0');
  }

  const outgoingByStart = validateLexicalEdgeGraph({ syllableCount, lexicalEdges });

  const active: PartialPath[][] = Array.from({ length: syllableCount + 1 }, () => []);
  active[0] = [
    {
      edges: [],
      boundaryKey: '',
      fallbackEdgeCount: 0,
      exactEdgeCount: 0,
      toneRelaxedEdgeCount: 0,
      fuzzyEdgeCount: 0,
    },
  ];

  const capEvents: PathCapEvent[] = [];
  const prunedPaths: PrunedSegmentationPathTrace[] = [];

  for (let pos = 0; pos <= syllableCount; pos += 1) {
    if (pos > 0 && pos < syllableCount && active[pos]!.length > maxActivePathsPerPosition) {
      const list = active[pos]!;
      const sorted = [...list].sort(compareBestFirst);
      const beforeCount = list.length;
      const kept = sorted.slice(0, maxActivePathsPerPosition);
      const pruned = sorted.slice(maxActivePathsPerPosition);

      const pruneReason = `per_position_cap@${pos} maxActivePathsPerPosition=${maxActivePathsPerPosition}`;
      capEvents.push({
        pruneStage: 'per_position_cap',
        position: pos,
        beforeCount,
        afterCount: kept.length,
        prunedBoundaryPrefixes: pruned.map((p) => p.boundaryKey).sort((a, b) => a.localeCompare(b)),
        reason: pruneReason,
      });
      for (const p of pruned) {
        prunedPaths.push({
          boundaryKey: p.boundaryKey,
          pruneStage: 'per_position_cap',
          pruneReason,
          structuralEvidence: {
            fallbackEdgeCount: p.fallbackEdgeCount,
            fuzzyEdgeCount: p.fuzzyEdgeCount,
            toneRelaxedEdgeCount: p.toneRelaxedEdgeCount,
            exactEdgeCount: p.exactEdgeCount,
          },
        });
      }
      active[pos] = kept;
    }

    if (pos === syllableCount) {
      break;
    }
    const prefixes = active[pos]!;
    if (!prefixes.length) continue;
    const outgoing = outgoingByStart[pos]!;

    for (const prefix of prefixes) {
      for (const edge of outgoing) {
        const nextPos = edge.syllableEnd;
        if (nextPos <= pos) {
          throw new Error(
            `[enumerateCompleteSegmentationPaths] edge must advance: ${edge.syllableStart}:${edge.syllableEnd} from pos=${pos}`
          );
        }
        const nextCounts = structuralCountsForEdge(edge);
        const nextBoundaryKey =
          prefix.boundaryKey.length > 0
            ? `${prefix.boundaryKey}|${edge.syllableStart}-${edge.syllableEnd}`
            : `${edge.syllableStart}-${edge.syllableEnd}`;

        const nextPartial: PartialPath = {
          edges: [...prefix.edges, edge],
          boundaryKey: nextBoundaryKey,
          fallbackEdgeCount: prefix.fallbackEdgeCount + nextCounts.fallbackEdgeCount,
          exactEdgeCount: prefix.exactEdgeCount + nextCounts.exactEdgeCount,
          toneRelaxedEdgeCount: prefix.toneRelaxedEdgeCount + nextCounts.toneRelaxedEdgeCount,
          fuzzyEdgeCount: prefix.fuzzyEdgeCount + nextCounts.fuzzyEdgeCount,
        };
        // Partial legality is guaranteed by construction: contiguous edges and boundary advance.
        active[nextPos]!.push(nextPartial);
      }
    }
  }

  const completeBefore = active[syllableCount]!;
  const completePathCountBeforePrune = completeBefore.length;

  let kept: PartialPath[] = completeBefore;

  if (completeBefore.length > maxCompleteSegmentationPaths) {
    const sorted = [...completeBefore].sort(compareBestFirst);
    kept = sorted.slice(0, maxCompleteSegmentationPaths);
    const pruned = sorted.slice(maxCompleteSegmentationPaths);

    const pruneReason = `complete_path_cap maxCompleteSegmentationPaths=${maxCompleteSegmentationPaths}`;
    capEvents.push({
      pruneStage: 'complete_path_cap',
      beforeCount: completeBefore.length,
      afterCount: kept.length,
      prunedBoundaryPrefixes: pruned.map((p) => p.boundaryKey).sort((a, b) => a.localeCompare(b)),
      reason: pruneReason,
    });

    for (const p of pruned) {
      prunedPaths.push({
        boundaryKey: p.boundaryKey,
        pruneStage: 'complete_path_cap',
        pruneReason,
        structuralEvidence: {
          fallbackEdgeCount: p.fallbackEdgeCount,
          fuzzyEdgeCount: p.fuzzyEdgeCount,
          toneRelaxedEdgeCount: p.toneRelaxedEdgeCount,
          exactEdgeCount: p.exactEdgeCount,
        },
      });
    }
  }

  prunedPaths.sort((a, b) => a.boundaryKey.localeCompare(b.boundaryKey) || a.pruneStage.localeCompare(b.pruneStage));

  // Deterministic output ordering.
  const keptSorted = kept.sort((a, b) => a.boundaryKey.localeCompare(b.boundaryKey));
  return {
    paths: keptSorted.map(partialToSegmentationPath),
    completePathCountBeforePrune,
    retainedCompletePathCount: keptSorted.length,
    prunedPaths,
    capEvents,
  };
}

