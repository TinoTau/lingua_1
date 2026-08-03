/**
 * Lattice Hard-block — adjacency vs true cross-sentence (Change Record 1.0.2).
 */
import { describe, expect, it } from '@jest/globals';
import type { CoarseSpan } from '../span-assembly-shared/types';
import { latticeHardBlockFilter } from './lattice-hard-block-filter';
import type { GlobalWindowDescriptor } from './v4-types';

function span(
  id: string,
  sylStart: number,
  sylEnd: number,
  rawStart: number,
  rawEnd: number,
  text: string
): CoarseSpan {
  return {
    id,
    text,
    rawStart,
    rawEnd,
    syllableStart: sylStart,
    syllableEnd: sylEnd,
    source: 'punctuation_fallback',
    boundaryConfidence: 0.3,
  };
}

function windowDesc(
  partial: Partial<GlobalWindowDescriptor> &
    Pick<
      GlobalWindowDescriptor,
      'windowId' | 'syllableStart' | 'syllableEnd' | 'rawStart' | 'rawEnd' | 'windowText'
    >
): GlobalWindowDescriptor {
  return {
    windowPinyinKey: 'x',
    spanIds: ['c0'],
    boundaryCrossCount: 0,
    windowSource: 'in_span_window',
    anchorCoarseSpanId: 'c0',
    blocked: false,
    ...partial,
  };
}

describe('latticeHardBlockFilter sentence boundary (Batch 1)', () => {
  it('12.1 adjacent trailing ？ — Window「吗」allowed', () => {
    const rawText = '你要吗？';
    const coarse = [span('c0', 0, 3, 0, 3, '你要吗')];
    const windows = [
      windowDesc({
        windowId: '2:3',
        syllableStart: 2,
        syllableEnd: 3,
        rawStart: 2,
        rawEnd: 3,
        windowText: '吗',
      }),
    ];
    const out = latticeHardBlockFilter({ windows, rawText, coarseSpans: coarse });
    expect(out[0]!.blocked).toBe(false);
  });

  it('12.1 adjacent leading ？ — Window「我」allowed', () => {
    const rawText = '？我想点咖啡';
    const coarse = [span('c0', 0, 5, 1, 6, '我想点咖啡')];
    const windows = [
      windowDesc({
        windowId: '0:1',
        syllableStart: 0,
        syllableEnd: 1,
        rawStart: 1,
        rawEnd: 2,
        windowText: '我',
        spanIds: ['c0'],
      }),
    ];
    const out = latticeHardBlockFilter({ windows, rawText, coarseSpans: coarse });
    expect(out[0]!.blocked).toBe(false);
  });

  it('12.2 true cross-sentence 「吗我」blocked', () => {
    const rawText = '吗？我';
    // Single coarse span so gap rule does not mask sentence-boundary-in-slice.
    const coarse = [span('c0', 0, 2, 0, 3, '吗？我')];
    const windows = [
      windowDesc({
        windowId: '0:2',
        syllableStart: 0,
        syllableEnd: 2,
        rawStart: 0,
        rawEnd: 3,
        windowText: '吗？我',
        spanIds: ['c0'],
      }),
    ];
    const out = latticeHardBlockFilter({ windows, rawText, coarseSpans: coarse });
    expect(out[0]!.blocked).toBe(true);
    expect(['sentence_boundary', 'punctuation_in_window']).toContain(out[0]!.blockedBoundaryReason);
  });

  it('12.2 cross 「好请」 via 。 blocked', () => {
    const rawText = '你好。请问';
    const coarse = [
      span('c0', 0, 2, 0, 2, '你好'),
      span('c1', 2, 4, 3, 5, '请问'),
    ];
    const windows = [
      windowDesc({
        windowId: '1:3',
        syllableStart: 1,
        syllableEnd: 3,
        rawStart: 1,
        rawEnd: 4,
        windowText: '好。请',
        spanIds: ['c0', 'c1'],
      }),
    ];
    const out = latticeHardBlockFilter({ windows, rawText, coarseSpans: coarse });
    expect(out[0]!.blocked).toBe(true);
  });

  it('12.3 punctuation inside window still blocked', () => {
    const rawText = '好，请';
    const coarse = [span('c0', 0, 2, 0, 3, '好，请')];
    const windows = [
      windowDesc({
        windowId: '0:2',
        syllableStart: 0,
        syllableEnd: 2,
        rawStart: 0,
        rawEnd: 3,
        windowText: '好，请',
      }),
    ];
    const out = latticeHardBlockFilter({ windows, rawText, coarseSpans: coarse });
    expect(out[0]!.blocked).toBe(true);
    expect(out[0]!.blockedBoundaryReason).toBe('punctuation_in_window');
  });

  it('12.4 raw gap between spans still blocked', () => {
    const rawText = '好 请';
    const coarse = [
      span('c0', 0, 1, 0, 1, '好'),
      span('c1', 1, 2, 2, 3, '请'),
    ];
    const windows = [
      windowDesc({
        windowId: '0:2',
        syllableStart: 0,
        syllableEnd: 2,
        rawStart: 0,
        rawEnd: 3,
        windowText: '好 请',
        spanIds: ['c0', 'c1'],
      }),
    ];
    const out = latticeHardBlockFilter({ windows, rawText, coarseSpans: coarse });
    expect(out[0]!.blocked).toBe(true);
    expect(['raw_gap_between_spans', 'whitespace_gap']).toContain(out[0]!.blockedBoundaryReason);
  });
});
