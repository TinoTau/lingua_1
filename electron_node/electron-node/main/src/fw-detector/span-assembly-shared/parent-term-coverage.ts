import type { ParentTermEvidence } from './types';

export type MatchedInterval = { start: number; end: number };

export function mergeMatchedIntervals(evidence: ParentTermEvidence[]): MatchedInterval[] {
  const sorted = evidence
    .map((e) => ({ start: e.matchedTermStart, end: e.matchedTermEnd }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: MatchedInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end) {
      merged.push({ ...interval });
      continue;
    }
    last.end = Math.max(last.end, interval.end);
  }
  return merged;
}

export function matchedUnionLength(intervals: MatchedInterval[]): number {
  return intervals.reduce((sum, i) => sum + (i.end - i.start), 0);
}

/** True if merged intervals have a gap between fragments (parent-term syllable coords). */
export function hasMatchedIntervalGap(intervals: MatchedInterval[]): boolean {
  if (!intervals.length) {
    return true;
  }
  if (intervals[0].start !== 0) {
    return true;
  }
  let cursor = intervals[0].end;
  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i].start > cursor) {
      return true;
    }
    cursor = Math.max(cursor, intervals[i].end);
  }
  return false;
}

/** True if intervals cannot fully cover [0, fullEnd) without gap (Rule A). */
export function hasCoverageHole(intervals: MatchedInterval[], fullEnd: number): boolean {
  if (hasMatchedIntervalGap(intervals)) {
    return true;
  }
  const last = intervals[intervals.length - 1];
  return last.end < fullEnd;
}

export function passesRuleA(intervals: MatchedInterval[], parentTermSyllableCount: number): boolean {
  if (hasMatchedIntervalGap(intervals)) {
    return false;
  }
  return (
    intervals.length === 1 &&
    intervals[0].start === 0 &&
    intervals[0].end === parentTermSyllableCount
  );
}

export function coverageRatio(intervals: MatchedInterval[], parentTermSyllableCount: number): number {
  if (parentTermSyllableCount <= 0) {
    return 0;
  }
  return matchedUnionLength(intervals) / parentTermSyllableCount;
}

export function passesRuleB(
  intervals: MatchedInterval[],
  parentTermSyllableCount: number,
  evidenceCount: number
): boolean {
  if (passesRuleA(intervals, parentTermSyllableCount)) {
    return false;
  }
  if (hasMatchedIntervalGap(intervals)) {
    return false;
  }
  const ratio = coverageRatio(intervals, parentTermSyllableCount);
  return ratio >= 0.6 || evidenceCount >= 2;
}

/** True when legacy Rule B thresholds pass but hole guard rejects (V2.1 Phase2 metric). */
export function isRuleBRejectedByHole(
  intervals: MatchedInterval[],
  parentTermSyllableCount: number,
  evidenceCount: number
): boolean {
  if (passesRuleA(intervals, parentTermSyllableCount)) {
    return false;
  }
  if (!hasMatchedIntervalGap(intervals)) {
    return false;
  }
  const ratio = coverageRatio(intervals, parentTermSyllableCount);
  return ratio >= 0.6 || evidenceCount >= 2;
}
