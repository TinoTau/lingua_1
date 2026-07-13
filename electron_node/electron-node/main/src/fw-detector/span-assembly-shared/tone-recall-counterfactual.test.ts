import { describe, expect, it } from '@jest/globals';
import { resolveTimestampToneState } from '../span-assembly-shared/tone-recall';
import {
  computeToneScoreResult,
  TONE_MATCH_PENALTY,
  TONE_MISMATCH_PENALTY,
} from '../tone-match-score';
import type { AcousticToneSlice } from '../tone-time-align';

const sampleSlices: AcousticToneSlice[] = [
  {
    start: 0.1,
    end: 0.4,
    tonePosterior: { t1: 0.1, t2: 0.1, t3: 0.6, t4: 0.1, t5: 0.1 },
    confidence: 0.6,
  },
];

describe('tone semantic counterfactual (Addendum §9)', () => {
  it('toneTimestampOnlyEnabled=true enables effective tone path', () => {
    const state = resolveTimestampToneState(sampleSlices, true);
    expect(state.toneEnabled).toBe(true);
    expect(state.tonePayloadAvailable).toBe(true);

    const mismatch = computeToneScoreResult([3, 1], 'shao1|bing3');
    expect(mismatch.toneReason).toBe('mismatch');
    expect(mismatch.tonePenalty).toBe(TONE_MISMATCH_PENALTY);
    expect(mismatch.tonePenalty).toBeLessThan(TONE_MATCH_PENALTY);
  });

  it('toneTimestampOnlyEnabled=false disables tone effective path (no penalty)', () => {
    const state = resolveTimestampToneState(sampleSlices, false);
    expect(state.toneEnabled).toBe(false);
    expect(state.toneSkippedReason).toBe('tone_timestamp_disabled');

    const withoutPattern = computeToneScoreResult(undefined, 'shao1|bing3');
    expect(withoutPattern.toneReason).toBe('no_pattern');
    expect(withoutPattern.tonePenalty).toBe(TONE_MATCH_PENALTY);
  });
});
