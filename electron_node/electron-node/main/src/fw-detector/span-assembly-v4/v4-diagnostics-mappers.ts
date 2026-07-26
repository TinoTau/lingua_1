import type { CoarseSpan } from '../span-assembly-shared/types';
import type { GlobalWindowDescriptor, WindowCandidate } from './v4-types';
import type {
  BoundaryWindowTrace,
  CandidatePoolTrace,
  CoarseSpanTrace,
  CombinationTrace,
  EmittedEdgeTrace,
} from './v4-diagnostics-types';
import type { SentenceCombination } from '../build-sentence-candidates';
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
    isCovered: candidate.isCovered,
    coveredBy: candidate.coveredBy,
    toneLookupStage: candidate.toneLookupStage,
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

export function resolveCompatReason(
  a: WindowCandidate,
  b: WindowCandidate,
  relation: 'COMPATIBLE' | 'COVERAGE' | 'CONFLICT'
): string {
  if (a.candidateId === b.candidateId) {
    return 'same_candidate';
  }
  if (relation === 'COVERAGE') {
    return 'coverage_parent_child';
  }
  if (relation === 'COMPATIBLE') {
    if (a.parentTermId && b.parentTermId && a.parentTermId === b.parentTermId) {
      return 'same_parent_term_overlap_match';
    }
    if (a.rawStart < b.rawEnd && b.rawStart < a.rawEnd) {
      return 'different_parent_replacement_overlap_match';
    }
    return 'adjacent_no_conflict';
  }
  if (a.parentTermId && b.parentTermId && a.parentTermId === b.parentTermId) {
    return 'same_parent_term_overlap_mismatch';
  }
  if (a.rawStart < b.rawEnd && b.rawStart < a.rawEnd) {
    return 'different_parent_replacement_overlap_mismatch';
  }
  return 'syllable_overlap_mismatch';
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
