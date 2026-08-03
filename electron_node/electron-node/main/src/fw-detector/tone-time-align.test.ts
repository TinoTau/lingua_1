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

  it('Participation Mapping: multi-char ASR token still yields syllable-length pattern from real slice', () => {
    // One ASR word "贝少" → one real Tone slice; Fine Span expects 2 syllables.
    const raw = '贝少';
    const slices = normalizeAcousticSlices([makeSlice(4, 0)]);
    const wordTimeSpans = buildWordTimeSpans(
      raw,
      [
        {
          text: raw,
          words: [{ word: raw, start: 0, end: 0.18, probability: 0.9 }],
        },
      ],
      [0],
      [0],
      [0]
    );
    const result = extractAcousticTonePatternByTime(0, 2, 0, 2, slices, wordTimeSpans);
    expect(result.windowTimeRange).not.toBeNull();
    expect(result.pattern).toEqual([4, 4]);
  });

  it('Participation Mapping: regression samples map real evidence into Recall pattern length', () => {
    const samples = ['你好', '我们', '订单', '预订', '前台', '接口', '上线计划', '机场高速', '大杯小杯'];
    for (const raw of samples) {
      const chars = [...raw];
      const slices = normalizeAcousticSlices(
        chars.map((_, i) => makeSlice(((i % 5) + 1) as 1 | 2 | 3 | 4 | 5, i * 0.1))
      );
      const wordTimeSpans = buildWordTimeSpans(raw, makeSegments(raw), [0], [0], [0]);
      const n = chars.length;
      const result = extractAcousticTonePatternByTime(0, n, 0, n, slices, wordTimeSpans);
      expect(result.pattern).not.toBeNull();
      expect(result.pattern!.length).toBe(n);
      expect(result.pattern!.every((t) => t >= 1 && t <= 5)).toBe(true);
    }
  });

  it('mapping missReason: no WordTimeSpan for slot', () => {
    const raw = '你好';
    const slices = normalizeAcousticSlices([makeSlice(1, 0), makeSlice(2, 0.1)]);
    const result = extractAcousticTonePatternByTime(0, 2, 0, 2, slices, []);
    expect(result.pattern).toBeNull();
    expect(result.windowTimeRange).toBeNull();
  });

  it('mapping missReason: no slice overlap word time', () => {
    const raw = '你好';
    const wordTimeSpans = buildWordTimeSpans(raw, makeSegments(raw), [0], [0], [0]);
    // Slices far away from word times (0–0.19)
    const slices = normalizeAcousticSlices([makeSlice(1, 5.0), makeSlice(2, 5.1)]);
    const result = extractAcousticTonePatternByTime(0, 2, 0, 2, slices, wordTimeSpans);
    expect(result.pattern).toBeNull();
    expect(result.windowTimeRange).not.toBeNull();
    expect(result.missReason).toBe('no_slice_overlap_word_time');
    expect(result.failedWordSpan?.word).toBeDefined();
  });

  it('mapping missReason: empty posterior', () => {
    const raw = '你';
    const wordTimeSpans = buildWordTimeSpans(raw, makeSegments(raw), [0], [0], [0]);
    const slices: AcousticToneSlice[] = [
      {
        start: 0,
        end: 0.09,
        confidence: 0,
        tonePosterior: { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 },
      },
    ];
    const result = extractAcousticTonePatternByTime(0, 1, 0, 1, slices, wordTimeSpans);
    expect(result.pattern).toBeNull();
    expect(result.missReason).toBe('empty_posterior');
  });

  it('mapping missReason: invalid posterior', () => {
    const raw = '你';
    const wordTimeSpans = buildWordTimeSpans(raw, makeSegments(raw), [0], [0], [0]);
    const slices: AcousticToneSlice[] = [
      {
        start: 0,
        end: 0.09,
        confidence: 0,
        tonePosterior: { t1: Number.NaN, t2: 0.2, t3: 0.2, t4: 0.2, t5: 0.2 },
      },
    ];
    const result = extractAcousticTonePatternByTime(0, 1, 0, 1, slices, wordTimeSpans);
    expect(result.pattern).toBeNull();
    expect(result.missReason).toBe('invalid_posterior');
  });

  describe('Frozen half-open overlap + Evidence Unavailable (Tone Mapping Contract)', () => {
    it('full overlap HIT: Word [1.00,1.20] Slice [1.00,1.20]', () => {
      const raw = '测';
      const wordTimeSpans = buildWordTimeSpans(
        raw,
        [{ text: raw, words: [{ word: raw, start: 1.0, end: 1.2, probability: 0.9 }] }],
        [0],
        [0],
        [0]
      );
      const slices: AcousticToneSlice[] = [
        { start: 1.0, end: 1.2, confidence: 0.9, tonePosterior: makePosterior(3) },
      ];
      const result = extractAcousticTonePatternByTime(0, 1, 0, 1, slices, wordTimeSpans);
      expect(result.pattern).toEqual([3]);
    });

    it('partial overlap HIT: Word [1.00,1.20] Slice [1.10,1.30]', () => {
      const raw = '测';
      const wordTimeSpans = buildWordTimeSpans(
        raw,
        [{ text: raw, words: [{ word: raw, start: 1.0, end: 1.2, probability: 0.9 }] }],
        [0],
        [0],
        [0]
      );
      const slices: AcousticToneSlice[] = [
        { start: 1.1, end: 1.3, confidence: 0.9, tonePosterior: makePosterior(2) },
      ];
      const result = extractAcousticTonePatternByTime(0, 1, 0, 1, slices, wordTimeSpans);
      expect(result.pattern).toEqual([2]);
    });

    it('boundary-only touch NO OVERLAP: Word [1.00,1.20] Slice [1.20,1.40]', () => {
      const raw = '测';
      const wordTimeSpans = buildWordTimeSpans(
        raw,
        [{ text: raw, words: [{ word: raw, start: 1.0, end: 1.2, probability: 0.9 }] }],
        [0],
        [0],
        [0]
      );
      const slices: AcousticToneSlice[] = [
        { start: 1.2, end: 1.4, confidence: 0.9, tonePosterior: makePosterior(4) },
      ];
      const result = extractAcousticTonePatternByTime(0, 1, 0, 1, slices, wordTimeSpans);
      expect(result.pattern).toBeNull();
      expect(result.missReason).toBe('no_slice_overlap_word_time');
    });

    it('zero-duration Word does not bind neighbor slices (d132-class Evidence Unavailable)', () => {
      // Mirrors d132「诱惑」: 诱=[3,3] skipped; neighbors 有=[2.92,3] and 惑=[3,3.16]
      const raw = '有诱惑';
      const wordTimeSpans = buildWordTimeSpans(
        raw,
        [
          {
            text: raw,
            words: [
              { word: '有', start: 2.92, end: 3.0, probability: 0.9 },
              { word: '诱', start: 3.0, end: 3.0, probability: 0.9 },
              { word: '惑', start: 3.0, end: 3.16, probability: 0.9 },
            ],
          },
        ],
        [0],
        [0],
        [0]
      );
      const slices: AcousticToneSlice[] = [
        { start: 2.92, end: 3.0, confidence: 0.9, tonePosterior: makePosterior(1) },
        { start: 3.0, end: 3.16, confidence: 0.9, tonePosterior: makePosterior(4) },
      ];
      // Window「诱惑」chars [1,3)
      const result = extractAcousticTonePatternByTime(1, 3, 0, 2, slices, wordTimeSpans);
      expect(result.pattern).toBeNull();
      expect(result.missReason).toBe('no_slice_overlap_word_time');
      expect(result.failedWordSpan?.word).toBe('诱');
      // Must not borrow 有 or 惑
      expect(result.pattern).not.toEqual([1, 4]);
      expect(result.pattern).not.toEqual([4, 4]);
    });
  });
});
