import { describe, expect, it } from '@jest/globals';
import { attributeMappingMiss } from './tone-miss-attribution';

describe('attributeMappingMiss', () => {
  it('attributes short_duration_skipped by overlapping production diagnostic', () => {
    const attr = attributeMappingMiss({
      missReason: 'no_slice_overlap_word_time',
      failedWordSpan: { word: '一', start: 1.0, end: 1.01, rawStart: 0, rawEnd: 1 },
      evidenceProduction: [
        {
          word: '一',
          startSec: 1.0,
          endSec: 1.01,
          durationSec: 0.01,
          segmentIndex: 0,
          batchIndex: 0,
          status: 'short_duration_skipped',
          errorCode: 'below_min_slice_sec',
        },
      ],
    });
    expect(attr).toBe('short_duration_skipped');
  });

  it('attributes slice_exists_but_no_overlap when production created a slice', () => {
    const attr = attributeMappingMiss({
      missReason: 'no_slice_overlap_word_time',
      failedWordSpan: { word: '点', start: 3.0, end: 3.2 },
      evidenceProduction: [
        {
          word: '点',
          startSec: 3.0,
          endSec: 3.2,
          durationSec: 0.2,
          segmentIndex: 0,
          status: 'slice_created',
        },
      ],
    });
    expect(attr).toBe('slice_exists_but_no_overlap');
  });

  it('returns word_timespan_mapping_failure for slot miss', () => {
    expect(
      attributeMappingMiss({ missReason: 'no_word_timespan_for_slot' })
    ).toBe('word_timespan_mapping_failure');
  });
});
