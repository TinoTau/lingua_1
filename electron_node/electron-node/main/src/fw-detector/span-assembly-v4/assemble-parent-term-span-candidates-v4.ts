import { buildCharSyllableRanges } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import { syllableRangeToRawCharRange } from '../pinyin-ime-v2/pinyin-ime-v2-boundary-compatible-topk-diff';
import {
  coverageRatio,
  isRuleBRejectedByHole,
  mergeMatchedIntervals,
  passesRuleA,
  passesRuleB,
} from '../span-assembly-shared/parent-term-coverage';
import { parentTermSyllableCount, sliceParentTermText } from '../span-assembly-shared/parent-term-slice';
import { selectGreedyLongestParentSpanCandidate } from '../span-assembly-shared/select-greedy-longest-parent-term';
import type {
  CoarseSpan,
  GraphEdge,
  ParentSpanCandidate,
  ParentTermEvidence,
} from '../span-assembly-shared/types';
import type { ParentSpanAssemblyResult } from '../span-assembly-shared/parent-span-types';
import { evidenceInSpanV4 } from './evidence-in-span-v4';

function groupByParentTermId(evidence: ParentTermEvidence[]): Map<string, ParentTermEvidence[]> {
  const groups = new Map<string, ParentTermEvidence[]>();
  for (const item of evidence) {
    const list = groups.get(item.parentTermId) ?? [];
    list.push(item);
    groups.set(item.parentTermId, list);
  }
  return groups;
}

function resolveReplacement(
  group: ParentTermEvidence[],
  parentTerm: string,
  syllableCount: number,
  intervals: ReturnType<typeof mergeMatchedIntervals>
): string | null {
  if (passesRuleA(intervals, syllableCount)) {
    return parentTerm;
  }
  if (!passesRuleB(intervals, syllableCount, group.length)) {
    return null;
  }
  const unionStart = intervals[0]?.start ?? 0;
  const unionEnd = intervals[intervals.length - 1]?.end ?? 0;
  return sliceParentTermText(parentTerm, syllableCount, unionStart, unionEnd);
}

function buildParentSpanCandidate(
  span: CoarseSpan,
  group: ParentTermEvidence[],
  replacement: string,
  ratio: number,
  ruleA: boolean,
  rawText: string
): ParentSpanCandidate | null {
  const syllableStart = Math.min(...group.map((e) => e.windowSyllableStart));
  const syllableEnd = Math.max(...group.map((e) => e.windowSyllableEnd));
  const spanSyllableLen = span.syllableEnd - span.syllableStart;
  const rawCoverageRatio = spanSyllableLen > 0 ? (syllableEnd - syllableStart) / spanSyllableLen : 0;

  const ranges = buildCharSyllableRanges(rawText);
  const charRange = syllableRangeToRawCharRange(ranges, syllableStart, syllableEnd);
  if (!charRange) {
    return null;
  }

  const best = group.reduce((a, b) => (b.score > a.score ? b : a));
  const syllableCount =
    best.parentTermSyllableCount || parentTermSyllableCount(best.parentPinyinKey);
  const ruleBonus = ruleA ? 0.15 : 0;
  const coverageBonus = ratio * 0.1;

  return {
    coarseSpanId: span.id,
    parentTermId: best.parentTermId,
    parentTerm: best.parentTerm,
    replacement,
    syllableStart,
    syllableEnd,
    rawStart: charRange.start,
    rawEnd: charRange.end,
    coverageRatio: ratio,
    rawCoverageRatio,
    evidenceCount: group.length,
    parentTermLength: syllableCount,
    isFullCoverage: ruleA,
    repairTarget: group.some((e) => e.repairTarget),
    score: best.score + coverageBonus + ruleBonus,
    domainId: best.domainId,
    source: best.source,
    parentPinyinKey: best.parentPinyinKey,
  };
}

function parentSpanCandidateToGraphEdge(candidate: ParentSpanCandidate): GraphEdge {
  return {
    coarseSpanId: candidate.coarseSpanId,
    syllableStart: candidate.syllableStart,
    syllableEnd: candidate.syllableEnd,
    rawStart: candidate.rawStart,
    rawEnd: candidate.rawEnd,
    replacement: candidate.replacement,
    source: candidate.source,
    domainId: candidate.domainId,
    score: candidate.score,
    ngramKey: candidate.parentPinyinKey,
    recallSource: 'canonical_exact',
    repairTarget: candidate.repairTarget,
    hitKind: 'parent_span_candidate',
    parentTerm: candidate.parentTerm,
    parentTermId: candidate.parentTermId,
    domainEvidenceTerm: candidate.parentTerm,
  };
}

export function assembleParentTermSpanCandidatesV4(
  coarseSpans: CoarseSpan[],
  parentEvidence: ParentTermEvidence[],
  rawText: string,
  utteranceDomain: string
): ParentSpanAssemblyResult {
  const emitted: ParentSpanCandidate[] = [];
  let ruleBRejectedByHoleCount = 0;

  for (const span of coarseSpans) {
    const spanEvidence = evidenceInSpanV4(span, parentEvidence);
    const groups = groupByParentTermId(spanEvidence);

    for (const group of groups.values()) {
      if (!group.length) {
        continue;
      }
      const sample = group[0];
      const syllableCount =
        sample.parentTermSyllableCount || parentTermSyllableCount(sample.parentPinyinKey);
      const intervals = mergeMatchedIntervals(group);

      if (isRuleBRejectedByHole(intervals, syllableCount, group.length)) {
        ruleBRejectedByHoleCount += 1;
      }

      const replacement = resolveReplacement(group, sample.parentTerm, syllableCount, intervals);
      if (!replacement) {
        continue;
      }

      const ratio = coverageRatio(intervals, syllableCount);
      const ruleA = passesRuleA(intervals, syllableCount);
      const candidate = buildParentSpanCandidate(span, group, replacement, ratio, ruleA, rawText);
      if (candidate) {
        emitted.push(candidate);
      }
    }
  }

  const selected: ParentSpanCandidate[] = [];
  for (const span of coarseSpans) {
    const spanEmitted = emitted.filter((c) => c.coarseSpanId === span.id);
    const winner = selectGreedyLongestParentSpanCandidate(spanEmitted, utteranceDomain);
    if (winner) {
      selected.push(winner);
    }
  }

  const dominatedPrunedCount = emitted.length - selected.length;
  const coverageRatios = selected.map((c) => c.coverageRatio);
  const parentSpanCoverageAvg =
    coverageRatios.length > 0
      ? coverageRatios.reduce((sum, r) => sum + r, 0) / coverageRatios.length
      : 0;

  return {
    edges: selected.map(parentSpanCandidateToGraphEdge),
    parentSpanCandidateEmittedCount: emitted.length,
    parentSpanCandidateSelectedCount: selected.length,
    dominatedPrunedCount,
    ruleBRejectedByHoleCount,
    parentSpanCoverageAvg,
  };
}
