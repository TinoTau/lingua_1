import type { NbestAugmentDiagnostics } from '../asr/segment-alignment-diagnostics';

export type NbestAugmentDropEvent = {
  augmentSliceDropped: true;
  dropReason: string;
  windowStart?: number;
  windowEnd?: number;
  hypothesisRank?: number;
};

/** Recover V3 Phase B — per-job window recall diagnostics (Signoff T-10). */

export type WindowRecallDiagnostics = {
  segmentTextLength: number;
  hypothesisCount: number;
  windowsEnumerated: number;
  windowsWithRecallTriggered: number;
  hitsObserved: number;
  hitsPinyin: number;
  hitsConfusion: number;
  droppedBelowPinyinThreshold: number;
  droppedByQuota: number;
  nbestAugmentSlices: number;
  confusionSpansOnSegment: number;
  confusionSpansFuzzyOnSegment: number;
  confusionSpansChunkPinyinOnSegment?: number;
  nbestConfusionSpansMapped: number;
  windowCandidateCount: number;
  truncated: boolean;
  segmentHypothesisAligned: boolean;
  hitsFuzzyObserved: number;
  candidateDedupDropped: number;
  fuzzyObservedAttemptCount?: number;
  fuzzyObservedHitCount?: number;
  fuzzyObservedRejectedCount?: number;
  pinyinAttemptCount?: number;
  pinyinHitCount?: number;
  pinyinNoHitCount?: number;
  pinyinNormalizationMismatchCount?: number;
  noWindowBucket?: string;
  nbestAugmentDroppedSlices?: number;
  nbestAugmentDropReason?: string;
  /** Q1.8：结构化 augment 汇总（批测 / regression） */
  nbestAugment?: NbestAugmentDiagnostics;
  /** Q1.8：逐条 drop 事件（上限 32，避免 extra 膨胀） */
  nbestAugmentDropEvents?: NbestAugmentDropEvent[];
};

export function emptyWindowRecallDiagnostics(): WindowRecallDiagnostics {
  return {
    segmentTextLength: 0,
    hypothesisCount: 0,
    windowsEnumerated: 0,
    windowsWithRecallTriggered: 0,
    hitsObserved: 0,
    hitsPinyin: 0,
    hitsConfusion: 0,
    droppedBelowPinyinThreshold: 0,
    droppedByQuota: 0,
    nbestAugmentSlices: 0,
    confusionSpansOnSegment: 0,
    confusionSpansFuzzyOnSegment: 0,
    nbestConfusionSpansMapped: 0,
    windowCandidateCount: 0,
    truncated: false,
    segmentHypothesisAligned: true,
    hitsFuzzyObserved: 0,
    candidateDedupDropped: 0,
    nbestAugmentDroppedSlices: 0,
  };
}
