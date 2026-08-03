import type { WindowCandidateSource } from '../lexicon/window-candidate-source';
import { rawOverlap } from './span-assembly-v4/classify-overlap-relation';
import { V4_LIMITS } from './span-assembly-v4/v4-limits';
import type { FwTextSpan } from './types';

export type SpanReplacementPick = {
  span: FwTextSpan;
  word: string;
  source: WindowCandidateSource;
  priorScore: number;
  repairTarget: boolean;
  candidateScore: number;
  candidateId?: string;
  windowSource?: 'in_span_window' | 'boundary_window';
  coveredCoarseSpanIds?: string[];
};

export type SentenceCombination = {
  text: string;
  replacements: SpanReplacementPick[];
  candidateScore: number;
};

export type CoarseSpanRange = {
  start: number;
  end: number;
};

export type BuildSentenceCandidatesResult = {
  combinations: SentenceCombination[];
  intervalAssemblyCandidateCount: number;
  intervalRejectedOverlapCount: number;
};

function applyReplacementsRightToLeft(
  rawText: string,
  picks: Array<{ start: number; end: number; word: string }>
): string {
  let text = rawText;
  const sorted = [...picks].sort((a, b) => b.start - a.start);
  for (const pick of sorted) {
    text = text.slice(0, pick.start) + pick.word + text.slice(pick.end);
  }
  return text;
}

function combinationScore(picks: SpanReplacementPick[]): number {
  return picks.reduce((sum, pick) => sum + pick.candidateScore, 0);
}

function pickOverlapsAny(candidate: SpanReplacementPick, chosen: SpanReplacementPick[]): boolean {
  for (const other of chosen) {
    if (
      rawOverlap(
        candidate.span.start,
        candidate.span.end,
        other.span.start,
        other.span.end
      )
    ) {
      return true;
    }
  }
  return false;
}

function resolveCoarseSpanRanges(
  spanSets: SpanReplacementPick[][],
  coarseSpanRanges?: CoarseSpanRange[]
): CoarseSpanRange[] {
  if (coarseSpanRanges?.length) {
    return coarseSpanRanges;
  }
  return spanSets.map((slot) => {
    const canonical = slot.find((p) => p.source === 'canonical_exact' && !p.repairTarget);
    if (canonical) {
      return { start: canonical.span.start, end: canonical.span.end };
    }
    if (!slot.length) {
      return { start: 0, end: 0 };
    }
    return {
      start: Math.min(...slot.map((p) => p.span.start)),
      end: Math.max(...slot.map((p) => p.span.end)),
    };
  });
}

function mergeIntervals(intervals: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (!intervals.length) {
    return [];
  }
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [sorted[0]!];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push(current);
    }
  }
  return merged;
}

function gapRangesInCoarseSpan(
  spanStart: number,
  spanEnd: number,
  repairPicks: SpanReplacementPick[]
): Array<{ start: number; end: number }> {
  const clipped = repairPicks
    .map((pick) => ({
      start: Math.max(pick.span.start, spanStart),
      end: Math.min(pick.span.end, spanEnd),
    }))
    .filter((interval) => interval.start < interval.end);

  const merged = mergeIntervals(clipped);
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = spanStart;
  for (const covered of merged) {
    if (cursor < covered.start) {
      gaps.push({ start: cursor, end: covered.start });
    }
    cursor = Math.max(cursor, covered.end);
  }
  if (cursor < spanEnd) {
    gaps.push({ start: cursor, end: spanEnd });
  }
  return gaps;
}

function makeGapCanonicalPick(rawText: string, start: number, end: number): SpanReplacementPick {
  const text = rawText.slice(start, end);
  return {
    span: { text, start, end },
    word: text,
    source: 'canonical_exact',
    priorScore: 0,
    repairTarget: false,
    candidateScore: 0,
  };
}

function buildGapCanonicalPicks(
  rawText: string,
  coarseRanges: CoarseSpanRange[],
  repairPicks: SpanReplacementPick[]
): SpanReplacementPick[] {
  const gaps: SpanReplacementPick[] = [];
  for (const coarse of coarseRanges) {
    if (coarse.start >= coarse.end) {
      continue;
    }
    for (const gap of gapRangesInCoarseSpan(coarse.start, coarse.end, repairPicks)) {
      gaps.push(makeGapCanonicalPick(rawText, gap.start, gap.end));
    }
  }
  return gaps;
}

function buildPathFromRepairs(
  rawText: string,
  repairPicks: SpanReplacementPick[],
  coarseRanges: CoarseSpanRange[]
): SpanReplacementPick[] {
  const gapPicks = buildGapCanonicalPicks(rawText, coarseRanges, repairPicks);
  return [...repairPicks, ...gapPicks];
}

function allNonOverlapSubsets(
  picks: SpanReplacementPick[],
  rejectedOverlap: { count: number }
): SpanReplacementPick[][] {
  const subsets: SpanReplacementPick[][] = [[]];

  function extend(start: number, current: SpanReplacementPick[]): void {
    for (let i = start; i < picks.length; i += 1) {
      const pick = picks[i]!;
      if (pickOverlapsAny(pick, current)) {
        rejectedOverlap.count += 1;
        continue;
      }
      const next = [...current, pick];
      subsets.push(next);
      extend(i + 1, next);
    }
  }

  extend(0, []);
  return subsets;
}

type EnumerateState = {
  paths: SpanReplacementPick[][];
  enumNodes: number;
  rejectedOverlap: number;
  capped: boolean;
};

function enumerateIntervalPaths(
  spanSets: SpanReplacementPick[][],
  coarseRanges: CoarseSpanRange[],
  rawText: string
): EnumerateState {
  const paths: SpanReplacementPick[][] = [];
  let enumNodes = 0;
  let rejectedOverlap = 0;
  let capped = false;

  const visitSlot = (slotIndex: number, chosen: SpanReplacementPick[]): void => {
    enumNodes += 1;
    if (enumNodes > V4_LIMITS.maxIntervalEnumNodes) {
      capped = true;
      return;
    }

    if (slotIndex >= spanSets.length) {
      if (chosen.length <= V4_LIMITS.maxIntervalRepairPicksPerPath) {
        paths.push(buildPathFromRepairs(rawText, chosen, coarseRanges));
      }
      return;
    }

    const slotRepairs = spanSets[slotIndex]!.filter((pick) => pick.repairTarget);
    const rejectCounter = { count: 0 };
    const subsets = allNonOverlapSubsets(slotRepairs, rejectCounter);
    rejectedOverlap += rejectCounter.count;

    for (const subset of subsets) {
      if (chosen.length + subset.length > V4_LIMITS.maxIntervalRepairPicksPerPath) {
        continue;
      }
      let overlapsPrior = false;
      for (const pick of subset) {
        if (pickOverlapsAny(pick, chosen)) {
          overlapsPrior = true;
          rejectedOverlap += 1;
          break;
        }
      }
      if (overlapsPrior) {
        continue;
      }
      visitSlot(slotIndex + 1, [...chosen, ...subset]);
      if (capped) {
        return;
      }
    }
  };

  visitSlot(0, []);
  return { paths, enumNodes, rejectedOverlap, capped };
}

/**
 * Non-overlap interval path assembly (Contract Supplement V1.1).
 */
export function buildSentenceCandidates(
  rawText: string,
  spanSets: SpanReplacementPick[][],
  maxSentenceCandidates: number,
  coarseSpanRanges?: CoarseSpanRange[]
): BuildSentenceCandidatesResult {
  if (!spanSets.length || maxSentenceCandidates <= 0) {
    return {
      combinations: [],
      intervalAssemblyCandidateCount: 0,
      intervalRejectedOverlapCount: 0,
    };
  }

  const coarseRanges = resolveCoarseSpanRanges(spanSets, coarseSpanRanges);

  const { paths, rejectedOverlap } = enumerateIntervalPaths(spanSets, coarseRanges, rawText);

  const scored = paths.map((picks) => {
    const text = applyReplacementsRightToLeft(
      rawText,
      picks.map((p) => ({ start: p.span.start, end: p.span.end, word: p.word }))
    );
    return { text, replacements: picks, candidateScore: combinationScore(picks) };
  });

  scored.sort((a, b) => b.candidateScore - a.candidateScore);

  const uniqueByText = new Map<string, SentenceCombination>();
  for (const combo of scored) {
    if (!uniqueByText.has(combo.text)) {
      uniqueByText.set(combo.text, combo);
    }
  }

  const combinations = [...uniqueByText.values()].slice(0, maxSentenceCandidates);

  return {
    combinations,
    intervalAssemblyCandidateCount: paths.length,
    intervalRejectedOverlapCount: rejectedOverlap,
  };
}
