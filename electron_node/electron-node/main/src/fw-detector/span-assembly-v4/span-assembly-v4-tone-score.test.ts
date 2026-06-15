import { describe, expect, it } from '@jest/globals';
import { sortRecallHitsByToneCompatibility } from '../../lexicon/tone-recall-sort';
import {
  computeToneScoreResult,
  TONE_MISMATCH_PENALTY,
} from '../tone-match-score';

describe('span-assembly-v4 tone score restoration', () => {
  it('mismatch candidate retains positive score after penalty (d001-like)', () => {
    const toneResult = computeToneScoreResult([3, 3], 'zhong1|bei1', '中杯');
    expect(toneResult.toneReason).toBe('mismatch');
    expect(toneResult.tonePenalty).toBe(TONE_MISMATCH_PENALTY);

    const hits = [
      {
        hotword: { word: '中杯', priorScore: 0.99, tonePinyinKey: 'zhong1|bei1' },
        candidateScore: 0.99,
      },
    ];
    const { hits: ranked, recallToneFallbackCount } = sortRecallHitsByToneCompatibility(hits, [3, 3]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.candidateScore).toBeCloseTo(0.99 * TONE_MISMATCH_PENALTY);
    expect(ranked[0]!.toneReason).toBe('mismatch');
    expect(recallToneFallbackCount).toBe(1);
  });

  it('boundary score = penalized candidateScore × boundaryPenalty', () => {
    const penalized = 0.99 * TONE_MISMATCH_PENALTY;
    const boundaryPenalty = 0.85;
    expect(penalized * boundaryPenalty).toBeCloseTo(0.6728);
  });
});
