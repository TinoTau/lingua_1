import { describe, expect, it } from '@jest/globals';
import {
  extractAcousticTonePattern,
  extractToneNumbersFromKey,
  isCandidateToneCompatible,
  isToneAlignmentValid,
  mapSpanToToneTokens,
} from './tone-match-score';
import type { ToneToken, UtteranceTonePayload } from '../task-router/types';

function makeToken(token: string, toneNum: 1 | 2 | 3 | 4 | 5, start: number): ToneToken {
  const posterior = { t1: 0.02, t2: 0.02, t3: 0.02, t4: 0.02, t5: 0.02 };
  posterior[`t${toneNum}` as keyof typeof posterior] = 0.9;
  return {
    token,
    start,
    end: start + 0.1,
    tonePosterior: posterior,
    confidence: 0.9,
  };
}

function makeTone(rawText: string, pattern: number[]): UtteranceTonePayload {
  const chars = [...rawText].filter((c) => /[\u4e00-\u9fff]/.test(c));
  return {
    toneEnabled: true,
    alignmentText: rawText,
    toneTokens: chars.map((ch, i) => makeToken(ch, (pattern[i] || 1) as 1 | 2 | 3 | 4 | 5, i * 0.1)),
    toneTokenCount: chars.length,
  };
}

describe('tone acoustic pattern P0.5', () => {
  it('extracts tone numbers from tone_pinyin_key', () => {
    expect(extractToneNumbersFromKey('shao3|bing1')).toEqual([3, 1]);
    expect(extractToneNumbersFromKey('shao1|bing3')).toEqual([1, 3]);
  });

  it('maps span chars to toneTokens from CNN payload only', () => {
    const raw = '少病';
    const tone = makeTone(raw, [3, 1]);
    const spanTokens = mapSpanToToneTokens(raw, 0, 2, tone.toneTokens);
    expect(spanTokens).toHaveLength(2);
    expect(extractAcousticTonePattern(raw, 0, 2, tone)).toEqual([3, 1]);
  });

  it('requires alignmentText === rawText for acoustic pattern', () => {
    const raw = '少病';
    const tone = makeTone(raw, [3, 1]);
    expect(isToneAlignmentValid(raw, tone)).toBe(true);
    expect(isToneAlignmentValid('烧病', tone)).toBe(false);
    expect(extractAcousticTonePattern('烧病', 0, 2, tone)).toBeNull();
  });

  it('returns null when alignmentText missing', () => {
    const raw = '少病';
    const tone: UtteranceTonePayload = {
      toneEnabled: true,
      toneTokens: makeTone(raw, [3, 1]).toneTokens,
      toneTokenCount: 2,
    };
    expect(extractAcousticTonePattern(raw, 0, 2, tone)).toBeNull();
  });

  it('checks candidate tone compatibility via reference key only', () => {
    expect(isCandidateToneCompatible([3, 1], 'shao3|bing1')).toBe(true);
    expect(isCandidateToneCompatible([3, 1], 'shao1|bing3')).toBe(false);
    expect(isCandidateToneCompatible([3, 1], 'shao4|bing1')).toBe(false);
  });
});
