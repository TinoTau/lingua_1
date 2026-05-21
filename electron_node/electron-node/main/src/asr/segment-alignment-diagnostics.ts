/**
 * Q1.8：segment ↔ rank0 对齐与 n-best augment 诊断（只观测，不改 segment-first）。
 */

export type SegmentAlignmentDiagnostics = {
  segmentText: string;
  rank0HypothesisText: string;
  alignmentStatus: 'aligned' | 'mismatched';
  /** 仅 mismatched 时填写；aligned 时为 undefined，避免 unknown 污染批测统计 */
  mismatchType?:
    | 'substring_missing'
    | 'punctuation_diff'
    | 'normalization_diff'
    | 'hypothesis_reordered'
    | 'unknown';
  segmentLength: number;
  rank0Length: number;
};

export type NbestAugmentDropReason =
  | 'segment_hypothesis_mismatch'
  | 'span_out_of_range'
  | 'normalized_text_mismatch';

export type NbestAugmentDiagnostics = {
  augmentSliceDropped: boolean;
  dropReason?: NbestAugmentDropReason;
  droppedSliceCount: number;
  attemptedSliceCount: number;
  augmentSlicesSucceeded: number;
};

export function emptyNbestAugmentDiagnostics(): NbestAugmentDiagnostics {
  return {
    augmentSliceDropped: false,
    droppedSliceCount: 0,
    attemptedSliceCount: 0,
    augmentSlicesSucceeded: 0,
  };
}

function classifyMismatch(
  segment: string,
  rank0: string
): NonNullable<SegmentAlignmentDiagnostics['mismatchType']> {
  if (!rank0) {
    return 'substring_missing';
  }
  if (segment.includes(rank0) || rank0.includes(segment)) {
    return 'substring_missing';
  }
  const segNorm = segment.replace(/\s+/g, '');
  const hypNorm = rank0.replace(/\s+/g, '');
  if (segNorm === hypNorm) {
    return 'punctuation_diff';
  }
  return 'normalization_diff';
}

export function buildSegmentAlignmentDiagnostics(
  segmentText: string,
  rank0HypothesisText: string
): SegmentAlignmentDiagnostics {
  const segmentTextNorm = segmentText.trim();
  const rank0 = rank0HypothesisText.trim();
  const aligned = segmentTextNorm === rank0;
  return {
    segmentText: segmentTextNorm.slice(0, 200),
    rank0HypothesisText: rank0.slice(0, 200),
    alignmentStatus: aligned ? 'aligned' : 'mismatched',
    mismatchType: aligned ? undefined : classifyMismatch(segmentTextNorm, rank0),
    segmentLength: segmentTextNorm.length,
    rank0Length: rank0.length,
  };
}

export function buildNbestAugmentDiagnostics(input: {
  nbestAugmentSlices: number;
  nbestAugmentDroppedSlices: number;
  nbestAugmentDropReason?: string;
}): NbestAugmentDiagnostics {
  const attemptedSliceCount =
    input.nbestAugmentSlices + (input.nbestAugmentDroppedSlices ?? 0);
  const droppedSliceCount = input.nbestAugmentDroppedSlices ?? 0;
  const dropReason = normalizeAugmentDropReason(input.nbestAugmentDropReason);

  return {
    augmentSliceDropped: droppedSliceCount > 0,
    dropReason: droppedSliceCount > 0 ? dropReason : undefined,
    droppedSliceCount,
    attemptedSliceCount,
    augmentSlicesSucceeded: input.nbestAugmentSlices,
  };
}

function normalizeAugmentDropReason(
  reason?: string
): NbestAugmentDropReason | undefined {
  if (reason === 'segment_hypothesis_mismatch' || reason === 'span_out_of_range') {
    return reason;
  }
  if (reason === 'normalized_text_mismatch') {
    return reason;
  }
  return reason ? 'segment_hypothesis_mismatch' : undefined;
}
