import { describe, expect, it } from '@jest/globals';
import {
  computeToneScoreResult,
  extractToneNumbersFromKey,
  isCandidateToneCompatible,
  TONE_MATCH_PENALTY,
  TONE_MISMATCH_PENALTY,
} from './tone-match-score';

describe('tone recall scoring', () => {
  it('extracts tone numbers from tone_pinyin_key', () => {
    expect(extractToneNumbersFromKey('shao3|bing1')).toEqual([3, 1]);
    expect(extractToneNumbersFromKey('shao1|bing3')).toEqual([1, 3]);
  });

  it('checks candidate tone compatibility via reference key only', () => {
    expect(isCandidateToneCompatible([3, 1], 'shao3|bing1')).toBe(true);
    expect(isCandidateToneCompatible([3, 1], 'shao1|bing3')).toBe(false);
    expect(isCandidateToneCompatible([3, 1], 'shao4|bing1')).toBe(false);
  });

  it('computeToneScoreResult: match', () => {
    const result = computeToneScoreResult([3, 1], 'shao3|bing1');
    expect(result).toEqual({
      toneCompatible: true,
      tonePenalty: TONE_MATCH_PENALTY,
      toneReason: 'match',
    });
  });

  it('computeToneScoreResult: mismatch', () => {
    const result = computeToneScoreResult([3, 1], 'shao1|bing3');
    expect(result).toEqual({
      toneCompatible: false,
      tonePenalty: TONE_MISMATCH_PENALTY,
      toneReason: 'mismatch',
    });
  });

  it('computeToneScoreResult: no_pattern', () => {
    const result = computeToneScoreResult(undefined, 'shao3|bing1');
    expect(result).toEqual({
      toneCompatible: true,
      tonePenalty: TONE_MATCH_PENALTY,
      toneReason: 'no_pattern',
    });
  });
});
