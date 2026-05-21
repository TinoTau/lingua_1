import type { WindowRecallDiagnostics } from './window-recall-diagnostics';

/** Q1-04 冻结 bucket（禁止 unknown/other 作为长期分类）。 */
export type NoWindowBucket =
  | 'no_observed_substring'
  | 'pinyin_no_hit'
  | 'normalization_mismatch'
  | 'segment_alignment_risk'
  | 'bundle_missing_observed'
  | 'window_budget_exceeded';

export function classifyNoWindowBucket(input: {
  segmentTextLength: number;
  diagnostics: WindowRecallDiagnostics;
  confusionObservedCount: number;
}): NoWindowBucket {
  const d = input.diagnostics;
  if (input.segmentTextLength < 2) {
    return 'no_observed_substring';
  }
  if (input.confusionObservedCount === 0) {
    return 'bundle_missing_observed';
  }
  if (d.truncated || d.droppedByQuota > 0) {
    return 'window_budget_exceeded';
  }
  if (!d.segmentHypothesisAligned) {
    return 'segment_alignment_risk';
  }
  if (
    d.confusionSpansOnSegment === 0 &&
    d.confusionSpansFuzzyOnSegment === 0 &&
    (d.confusionSpansChunkPinyinOnSegment ?? 0) === 0 &&
    d.hitsFuzzyObserved === 0
  ) {
    return 'no_observed_substring';
  }
  const hits = d.hitsObserved + d.hitsPinyin + d.hitsConfusion + d.hitsFuzzyObserved;
  if (d.windowsEnumerated > 0 && d.windowsWithRecallTriggered === 0 && hits === 0) {
    return 'pinyin_no_hit';
  }
  if (hits > 0 && d.windowCandidateCount === 0) {
    return 'normalization_mismatch';
  }
  return 'pinyin_no_hit';
}
