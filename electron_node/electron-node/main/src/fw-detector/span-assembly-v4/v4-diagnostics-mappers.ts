import type { CoarseSpan, GraphEdge, ParentTermEvidence } from '../span-assembly-shared/types';
import type { CoarseSpanPath } from '../span-assembly-shared/types';
import type { GlobalWindowDescriptor, WindowCandidate } from './v4-types';
import type {
  BeamSpanSetTrace,
  BoundaryWindowTrace,
  CandidatePoolTrace,
  CoarsePathTrace,
  CoarseSpanTrace,
  CombinationTrace,
  EmittedEdgeTrace,
  GraphEdgeTrace,
  ParentSpanCandidateTrace,
} from './v4-diagnostics-types';
import type { SpanReplacementPick, SentenceCombination } from '../build-sentence-candidates';
import { mapSentenceToApprovedReplacements } from '../map-sentence-to-approved';

export function toCoarseSpanTrace(span: CoarseSpan): CoarseSpanTrace {
  return {
    id: span.id,
    rawStart: span.rawStart,
    rawEnd: span.rawEnd,
    syllableStart: span.syllableStart,
    syllableEnd: span.syllableEnd,
    text: span.text,
    source: span.source,
  };
}

export function toBoundaryWindowTrace(window: GlobalWindowDescriptor): BoundaryWindowTrace {
  return {
    windowId: window.windowId,
    windowText: window.windowText,
    windowPinyinKey: window.windowPinyinKey,
    windowSource: window.windowSource,
    rawStart: window.rawStart,
    rawEnd: window.rawEnd,
    syllableStart: window.syllableStart,
    syllableEnd: window.syllableEnd,
    spanIds: [...window.spanIds],
    anchorCoarseSpanId: window.anchorCoarseSpanId,
    boundaryCrossCount: window.boundaryCrossCount,
    blocked: window.blocked,
    blockedBoundaryReason: window.blockedBoundaryReason,
  };
}

export function toCandidatePoolTrace(candidate: WindowCandidate): CandidatePoolTrace {
  return {
    candidateId: candidate.candidateId,
    windowId: candidate.windowId,
    windowPinyinKey: candidate.windowPinyinKey,
    windowSource: candidate.windowSource,
    replacement: candidate.replacement,
    hitKind: candidate.hitKind,
    candidateRank: candidate.candidateRank,
    candidateScore: candidate.candidateScore,
    score: candidate.score,
    repairTarget: candidate.repairTarget,
    anchorCoarseSpanId: candidate.anchorCoarseSpanId,
    rawStart: candidate.rawStart,
    rawEnd: candidate.rawEnd,
    syllableStart: candidate.syllableStart,
    syllableEnd: candidate.syllableEnd,
  };
}

export function toEmittedEdgeFromCandidate(
  candidate: WindowCandidate,
  hitKind: 'exact_term' | 'parent_fragment'
): EmittedEdgeTrace {
  return {
    replacement: candidate.replacement,
    hitKind,
    coarseSpanId: candidate.anchorCoarseSpanId,
    windowId: candidate.windowId,
    windowSource: candidate.windowSource,
    rawStart: candidate.rawStart,
    rawEnd: candidate.rawEnd,
    syllableStart: candidate.syllableStart,
    syllableEnd: candidate.syllableEnd,
    score: candidate.score,
    repairTarget: candidate.repairTarget,
  };
}

export function toEmittedEdgeFromParentEvidence(evidence: ParentTermEvidence): EmittedEdgeTrace {
  return {
    replacement: evidence.parentTerm,
    hitKind: 'parent_fragment',
    coarseSpanId: evidence.coarseSpanId,
    windowId: evidence.windowId,
    windowSource: evidence.windowSource,
    rawStart: evidence.rawStart,
    rawEnd: evidence.rawEnd,
    syllableStart: evidence.windowSyllableStart,
    syllableEnd: evidence.windowSyllableEnd,
    score: evidence.score,
    repairTarget: evidence.repairTarget,
  };
}

export function toParentSpanCandidateTraceFromGraphEdge(edge: {
  replacement: string;
  score: number;
  coarseSpanId?: string;
  parentTermId?: string;
}): ParentSpanCandidateTrace {
  return {
    candidateText: edge.replacement,
    score: edge.score,
    coarseSpanId: edge.coarseSpanId ?? '',
    parentTermId: edge.parentTermId,
  };
}

export function toGraphEdgeTrace(edge: GraphEdge, edgeId: string): GraphEdgeTrace {
  const isResidual =
    edge.source === 'noise' ||
    edge.source === 'unknown' ||
    edge.recallSource === undefined;
  return {
    edgeId,
    replacement: edge.replacement,
    coarseSpanId: edge.coarseSpanId,
    rawStart: edge.rawStart,
    rawEnd: edge.rawEnd,
    syllableStart: edge.syllableStart,
    syllableEnd: edge.syllableEnd,
    score: edge.score,
    repairTarget: edge.repairTarget,
    hitKind: edge.hitKind ?? 'unknown',
    isResidual,
  };
}

export function toCoarsePathTrace(path: CoarseSpanPath, pathRank: number, rawText: string): CoarsePathTrace {
  const edges = path.edges.map((edge, idx) => toGraphEdgeTrace(edge, `${path.coarseSpanId}:${pathRank}:${idx}`));
  const replacementText = path.edges.length
    ? path.edges.map((e) => e.replacement).join('|')
    : '';
  return {
    coarseSpanId: path.coarseSpanId,
    pathRank,
    pathScore: path.score,
    edges,
    replacementText,
  };
}

export function toBeamSpanSetTrace(
  spanIndex: number,
  coarseSpanId: string,
  picks: Array<SpanReplacementPick & { anchorSpanId?: string }>
): BeamSpanSetTrace {
  return {
    spanIndex,
    coarseSpanId,
    picks: picks.map((pick) => ({
      replacement: pick.word,
      rawStart: pick.span.start,
      rawEnd: pick.span.end,
      anchorSpanId: pick.anchorSpanId,
      repairTarget: pick.repairTarget,
      score: pick.candidateScore,
    })),
  };
}

export function resolveCompatReason(a: WindowCandidate, b: WindowCandidate, compatible: boolean): string {
  if (a.candidateId === b.candidateId) {
    return 'same_candidate';
  }
  if (a.parentTermId && b.parentTermId && a.parentTermId === b.parentTermId) {
    return compatible ? 'same_parent_term_overlap_match' : 'same_parent_term_overlap_mismatch';
  }
  if (a.rawStart < b.rawEnd && b.rawStart < a.rawEnd) {
    return compatible ? 'different_parent_replacement_overlap_match' : 'different_parent_replacement_overlap_mismatch';
  }
  return compatible ? 'adjacent_no_conflict' : 'syllable_overlap_mismatch';
}

export function buildCombinationTraces(input: {
  combinations: SentenceCombination[];
  deltas?: number[];
  minDeltaToReplace: number;
  pickedIsRaw: boolean;
  candidateRequireRepairTarget: boolean;
  picked: SentenceCombination | null;
}): CombinationTrace[] {
  const limit = Math.min(input.combinations.length, 32);
  const traces: CombinationTrace[] = [];

  for (let i = 0; i < limit; i += 1) {
    const combo = input.combinations[i];
    const delta = input.deltas?.[i] ?? 0;
    let approved = false;
    let rejectedReason: CombinationTrace['rejectedReason'];

    if (input.pickedIsRaw) {
      rejectedReason = 'picked_raw';
    } else if (delta < input.minDeltaToReplace) {
      rejectedReason = 'below_min_delta';
    } else if (input.picked === combo) {
      const mapped = mapSentenceToApprovedReplacements(combo, input.candidateRequireRepairTarget);
      approved = mapped.length > 0;
      if (!approved) {
        rejectedReason = 'missing_repair_target';
      }
    }

    traces.push({
      sentence: combo.text,
      delta,
      approved,
      rejectedReason,
    });
  }

  return traces;
}

export function resolveDropReason(winner: WindowCandidate, loser: WindowCandidate): string {
  if (loser.score !== winner.score) {
    return 'lower_score';
  }
  if (loser.windowSource !== winner.windowSource) {
    return loser.windowSource === 'boundary_window' ? 'in_span_tiebreak' : 'boundary_tiebreak';
  }
  if (loser.candidateRank !== winner.candidateRank) {
    return 'higher_candidate_rank';
  }
  return 'lexicographic_candidate_id';
}
