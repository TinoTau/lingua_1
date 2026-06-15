import { describe, expect, it } from '@jest/globals';
import type { AcousticToneSlice, SegmentInfo, TonePosterior } from '../task-router/types';
import {
  buildWordTimeSpans,
  extractAcousticTonePatternByTime,
  normalizeAcousticSlices,
  offsetAcousticSlices,
} from './tone-time-align';

function makePosterior(toneNum: 1 | 2 | 3 | 4 | 5): TonePosterior {
  const posterior = { t1: 0.02, t2: 0.02, t3: 0.02, t4: 0.02, t5: 0.02 };
  posterior[`t${toneNum}` as keyof TonePosterior] = 0.9;
  return posterior;
}

function makeSlice(toneNum: 1 | 2 | 3 | 4 | 5, start: number): AcousticToneSlice {
  return {
    start,
    end: start + 0.09,
    tonePosterior: makePosterior(toneNum),
    confidence: 0.9,
  };
}

function makeSegments(raw: string): SegmentInfo[] {
  const chars = [...raw];
  return [
    {
      text: raw,
      words: chars.map((ch, i) => ({
        word: ch,
        start: i * 0.1,
        end: i * 0.1 + 0.09,
        probability: 0.9,
      })),
    },
  ];
}

describe('tone-time-align', () => {
  it('normalizeAcousticSlices preserves slice fields without token text', () => {
    const slice = makeSlice(4, 0.2);
    const normalized = normalizeAcousticSlices([slice]);
    expect(normalized[0].start).toBe(0.2);
    expect(normalized[0].end).toBeCloseTo(0.29);
    expect(normalized[0].tonePosterior.t4).toBe(0.9);
  });

  it('offsetAcousticSlices shifts global time axis', () => {
    const slices = normalizeAcousticSlices([makeSlice(1, 0), makeSlice(2, 0.1)]);
    const shifted = offsetAcousticSlices(slices, 1.5);
    expect(shifted[0].start).toBe(1.5);
    expect(shifted[1].start).toBeCloseTo(1.6);
  });

  it('extractAcousticTonePatternByTime returns pattern when slice count matches syllables', () => {
    const raw = '贝少糖';
    const slices = normalizeAcousticSlices([
      makeSlice(4, 0),
      makeSlice(3, 0.1),
      makeSlice(2, 0.2),
    ]);
    const wordTimeSpans = buildWordTimeSpans(raw, makeSegments(raw), [0], [0], [0]);
    const beiShao = extractAcousticTonePatternByTime(0, 2, 0, 2, slices, wordTimeSpans);
    expect(beiShao.windowTimeRange).not.toBeNull();
    expect(beiShao.pattern).toEqual([4, 3]);
  });

  it('returns null when overlap slice count mismatches syllable count', () => {
    const raw = '贝少';
    const slices = normalizeAcousticSlices([makeSlice(4, 0)]);
    const wordTimeSpans = buildWordTimeSpans(raw, makeSegments(raw), [0], [0], [0]);
    const result = extractAcousticTonePatternByTime(0, 2, 0, 2, slices, wordTimeSpans);
    expect(result.pattern).toBeNull();
  });
});
