import {
  buildNbestAugmentDiagnostics,
  buildSegmentAlignmentDiagnostics,
} from './segment-alignment-diagnostics';

describe('buildSegmentAlignmentDiagnostics', () => {
  it('aligned 时不输出 mismatchType', () => {
    const d = buildSegmentAlignmentDiagnostics('你好世界', '你好世界');
    expect(d.alignmentStatus).toBe('aligned');
    expect(d.mismatchType).toBeUndefined();
  });

  it('标点差异归类为 punctuation_diff', () => {
    const d = buildSegmentAlignmentDiagnostics('你好 世界', '你好世界');
    expect(d.alignmentStatus).toBe('mismatched');
    expect(d.mismatchType).toBe('punctuation_diff');
  });

  it('子串缺失归类为 substring_missing', () => {
    const d = buildSegmentAlignmentDiagnostics('你好世界啊', '你好');
    expect(d.mismatchType).toBe('substring_missing');
  });
});

describe('buildNbestAugmentDiagnostics', () => {
  it('有 drop 时带 dropReason', () => {
    const d = buildNbestAugmentDiagnostics({
      nbestAugmentSlices: 2,
      nbestAugmentDroppedSlices: 1,
      nbestAugmentDropReason: 'span_out_of_range',
    });
    expect(d.augmentSliceDropped).toBe(true);
    expect(d.dropReason).toBe('span_out_of_range');
    expect(d.attemptedSliceCount).toBe(3);
  });

  it('无 drop 时不带 dropReason', () => {
    const d = buildNbestAugmentDiagnostics({
      nbestAugmentSlices: 3,
      nbestAugmentDroppedSlices: 0,
    });
    expect(d.augmentSliceDropped).toBe(false);
    expect(d.dropReason).toBeUndefined();
  });
});
