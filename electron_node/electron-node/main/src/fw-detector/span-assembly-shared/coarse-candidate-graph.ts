import { buildCharSyllableRanges } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import { syllableRangeToRawCharRange } from '../pinyin-ime-v2/pinyin-ime-v2-boundary-compatible-topk-diff';
import {
  matchOralFunction,
  matchOralParticle,
  ORAL_SOURCE_WEIGHT,
} from './oral-lexicon-frozen';
import type { ConflictRelation } from '../span-assembly-v4/v4-types';
import type { CoarseSpan, GraphEdge } from './types';
import { CoarseAssemblyLimits } from './limits';

export type GraphBuildResult = {
  edges: GraphEdge[];
  overlapMergeCount: number;
  residualSpanCount: number;
  conflictRelations?: ConflictRelation[];
};

function edgesOverlap(a: GraphEdge, b: GraphEdge): boolean {
  return a.syllableStart < b.syllableEnd && b.syllableStart < a.syllableEnd;
}

function canMergeEdges(a: GraphEdge, b: GraphEdge): boolean {
  if (a.coarseSpanId && b.coarseSpanId && a.coarseSpanId !== b.coarseSpanId) {
    return false;
  }
  return a.replacement === b.replacement && (edgesOverlap(a, b) || a.syllableEnd === b.syllableStart || b.syllableEnd === a.syllableStart);
}

function mergeTwoEdges(a: GraphEdge, b: GraphEdge): GraphEdge {
  return {
    coarseSpanId: a.coarseSpanId ?? b.coarseSpanId,
    syllableStart: Math.min(a.syllableStart, b.syllableStart),
    syllableEnd: Math.max(a.syllableEnd, b.syllableEnd),
    rawStart: Math.min(a.rawStart, b.rawStart),
    rawEnd: Math.max(a.rawEnd, b.rawEnd),
    replacement: a.replacement,
    source: a.score >= b.score ? a.source : b.source,
    domainId: a.score >= b.score ? a.domainId : b.domainId,
    score: Math.max(a.score, b.score),
    ngramKey: `${a.ngramKey}+${b.ngramKey}`,
    variantKind: a.variantKind ?? b.variantKind,
    recallSource: a.score >= b.score ? a.recallSource : b.recallSource,
    repairTarget: a.repairTarget || b.repairTarget,
    hitKind: a.hitKind ?? b.hitKind,
  };
}

export function mergeOverlappingEdges(edges: GraphEdge[]): { edges: GraphEdge[]; mergeCount: number } {
  let merged = [...edges];
  let mergeCount = 0;
  let changed = true;

  while (changed) {
    changed = false;
    const next: GraphEdge[] = [];
    const used = new Set<number>();

    for (let i = 0; i < merged.length; i++) {
      if (used.has(i)) {
        continue;
      }
      let current = merged[i];
      for (let j = i + 1; j < merged.length; j++) {
        if (used.has(j)) {
          continue;
        }
        if (canMergeEdges(current, merged[j])) {
          current = mergeTwoEdges(current, merged[j]);
          used.add(j);
          mergeCount += 1;
          changed = true;
        }
      }
      next.push(current);
    }
    merged = next;
  }

  merged.sort((a, b) => b.score - a.score || b.syllableEnd - b.syllableStart - (a.syllableEnd - a.syllableStart));
  return { edges: merged, mergeCount };
}

function buildResidualEdges(
  rawText: string,
  globalSyllables: string[],
  totalSyllables: number,
  covered: Set<number>
): { edges: GraphEdge[]; residualSpanCount: number } {
  const ranges = buildCharSyllableRanges(rawText);
  const edges: GraphEdge[] = [];
  const intervals: Array<{ start: number; end: number }> = [];
  let intervalStart: number | null = null;

  for (let i = 0; i < totalSyllables; i++) {
    if (!covered.has(i)) {
      if (intervalStart === null) {
        intervalStart = i;
      }
    } else if (intervalStart !== null) {
      intervals.push({ start: intervalStart, end: i });
      intervalStart = null;
    }
  }
  if (intervalStart !== null) {
    intervals.push({ start: intervalStart, end: totalSyllables });
  }

  for (const interval of intervals) {
    const len = interval.end - interval.start;
    const sylls = globalSyllables.slice(interval.start, interval.end);
    const charRange = syllableRangeToRawCharRange(ranges, interval.start, interval.end);
    if (!charRange) {
      continue;
    }
    const rawSlice = rawText.slice(charRange.start, charRange.end);

    if (len === 1) {
      const particle = matchOralParticle(sylls[0]);
      if (particle) {
        edges.push({
          syllableStart: interval.start,
          syllableEnd: interval.end,
          rawStart: charRange.start,
          rawEnd: charRange.end,
          replacement: particle.word,
          source: 'oral_particle',
          score: ORAL_SOURCE_WEIGHT.oral_particle,
          ngramKey: sylls[0],
          recallSource: 'canonical_exact',
          repairTarget: false,
        });
        continue;
      }
    }

    const oralFn = matchOralFunction(sylls);
    if (oralFn) {
      edges.push({
        syllableStart: interval.start,
        syllableEnd: interval.end,
        rawStart: charRange.start,
        rawEnd: charRange.end,
        replacement: oralFn.word,
        source: 'oral_function',
        score: ORAL_SOURCE_WEIGHT.oral_function,
        ngramKey: sylls.join('|'),
        recallSource: 'canonical_exact',
        repairTarget: false,
      });
      continue;
    }

    edges.push({
      syllableStart: interval.start,
      syllableEnd: interval.end,
      rawStart: charRange.start,
      rawEnd: charRange.end,
      replacement: rawSlice,
      source: len === 1 ? 'noise' : 'unknown',
      score: 0.05,
      ngramKey: sylls.join('|'),
      recallSource: 'canonical_exact',
      repairTarget: false,
    });
  }

  return { edges, residualSpanCount: intervals.length };
}

export function buildCandidateGraph(
  rawText: string,
  globalSyllables: string[],
  coarseSpans: CoarseSpan[],
  recallEdges: GraphEdge[],
  conflictRelations?: ConflictRelation[]
): GraphBuildResult {
  const { edges: merged, mergeCount } = mergeOverlappingEdges(recallEdges);

  const parentSpanEdges = merged.filter((e) => e.hitKind === 'parent_span_candidate');
  const otherEdges = merged.filter((e) => e.hitKind !== 'parent_span_candidate');
  const sortedMerged = [
    ...parentSpanEdges.sort((a, b) => b.score - a.score),
    ...otherEdges.sort((a, b) => b.score - a.score),
  ];

  const covered = new Set<number>();
  const greedy: GraphEdge[] = [];
  for (const edge of sortedMerged) {
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
    greedy.push(edge);
    if (greedy.length >= coarseSpans.length * CoarseAssemblyLimits.maxCoarsePathsPerSpan) {
      break;
    }
  }

  const residual = buildResidualEdges(rawText, globalSyllables, globalSyllables.length, covered);
  const allEdges = [...merged, ...residual.edges];

  return {
    edges: allEdges,
    overlapMergeCount: mergeCount,
    residualSpanCount: residual.residualSpanCount,
    conflictRelations,
  };
}
