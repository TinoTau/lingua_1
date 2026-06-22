import { describe, expect, it } from '@jest/globals';
import {
  buildSentenceCandidates,
  type CoarseSpanRange,
  type SpanReplacementPick,
} from './build-sentence-candidates';
import { rawOverlap } from './span-assembly-v4/classify-overlap-relation';
import { V4_LIMITS } from './span-assembly-v4/v4-limits';

const D001_RAW = '你好,我想點一杯熱拿鐵鐘貝少糖';
const D001_COARSE: CoarseSpanRange[] = [
  { start: 11, end: 12 },
  { start: 12, end: 15 },
];

function makeRepair(
  rawText: string,
  start: number,
  end: number,
  word: string,
  overrides: Partial<SpanReplacementPick> = {}
): SpanReplacementPick {
  return {
    span: { text: rawText.slice(start, end), start, end },
    word,
    source: 'base_term',
    priorScore: 1,
    repairTarget: true,
    candidateScore: 1,
    ...overrides,
  };
}

function makeCanonical(
  rawText: string,
  start: number,
  end: number
): SpanReplacementPick {
  const text = rawText.slice(start, end);
  return {
    span: { text, start, end },
    word: text,
    source: 'canonical_exact',
    priorScore: 0,
    repairTarget: false,
    candidateScore: 0,
  };
}

function pathHasRepair(
  replacements: SpanReplacementPick[],
  start: number,
  end: number,
  word: string
): boolean {
  return replacements.some(
    (r) => r.repairTarget && r.span.start === start && r.span.end === end && r.word === word
  );
}

function pathHasIllegalZhongZhongbei(replacements: SpanReplacementPick[]): boolean {
  const hasZhong = replacements.some(
    (r) => r.span.start === 11 && r.span.end === 12 && r.word === '鐘'
  );
  const hasZhongbei = pathHasRepair(replacements, 11, 13, '中杯');
  return hasZhong && hasZhongbei;
}

describe('buildSentenceCandidates interval assembly (Contract V1.1)', () => {
  it('T1 d001: exposes 中杯[11,13] + 少糖[13,15] without 鐘 canonical overlap', () => {
    const spanSets: SpanReplacementPick[][] = [
      [makeCanonical(D001_RAW, 11, 12)],
      [
        makeRepair(D001_RAW, 11, 13, '中杯', {
          windowSource: 'boundary_window',
          candidateScore: 2,
        }),
        makeRepair(D001_RAW, 13, 15, '少糖', {
          windowSource: 'in_span_window',
          candidateScore: 1.5,
        }),
      ],
    ];

    const result = buildSentenceCandidates(D001_RAW, spanSets, 16, D001_COARSE);
    expect(result.intervalAssemblyCandidateCount).toBeGreaterThan(0);

    const best = result.combinations[0]!;
    expect(pathHasRepair(best.replacements, 11, 13, '中杯')).toBe(true);
    expect(pathHasRepair(best.replacements, 13, 15, '少糖')).toBe(true);
    expect(best.text).toContain('中杯少糖');
    expect(best.text).not.toContain('鐘貝');

    for (const combo of result.combinations) {
      expect(pathHasIllegalZhongZhongbei(combo.replacements)).toBe(false);
    }
  });

  it('T2 canonical gap: uncovered tail becomes gap canonical pick', () => {
    const raw = 'abcdef';
    const spanSets: SpanReplacementPick[][] = [
      [makeRepair(raw, 0, 2, 'AB', { candidateScore: 1 })],
    ];
    const coarse: CoarseSpanRange[] = [{ start: 0, end: 5 }];

    const result = buildSentenceCandidates(raw, spanSets, 16, coarse);
    const combo = result.combinations[0]!;
    const gap = combo.replacements.find(
      (r) => !r.repairTarget && r.span.start === 2 && r.span.end === 5
    );
    expect(gap).toMatchObject({
      word: 'cde',
      source: 'canonical_exact',
      candidateScore: 0,
      repairTarget: false,
    });
    expect(combo.text).toBe('ABcdef');
  });

  it('T3 overlap reject: overlapping repair picks never share a path', () => {
    const raw = 'xxxxx';
    const spanSets: SpanReplacementPick[][] = [
      [
        makeRepair(raw, 0, 3, 'AAA', { candidateScore: 2 }),
        makeRepair(raw, 1, 4, 'BBB', { candidateScore: 1 }),
      ],
    ];
    const coarse: CoarseSpanRange[] = [{ start: 0, end: 4 }];

    expect(rawOverlap(0, 3, 1, 4)).toBe(true);

    const result = buildSentenceCandidates(raw, spanSets, 16, coarse);
    expect(result.intervalRejectedOverlapCount).toBeGreaterThan(0);

    for (const combo of result.combinations) {
      const repairs = combo.replacements.filter((r) => r.repairTarget);
      for (let i = 0; i < repairs.length; i += 1) {
        for (let j = i + 1; j < repairs.length; j += 1) {
          const a = repairs[i]!;
          const b = repairs[j]!;
          expect(
            rawOverlap(a.span.start, a.span.end, b.span.start, b.span.end)
          ).toBe(false);
        }
      }
    }
  });

  it('T4 enum cap: stops expanding when maxIntervalEnumNodes exceeded', () => {
    const raw = '0123456789';
    const repairs: SpanReplacementPick[] = [];
    for (let i = 0; i < 10; i += 1) {
      repairs.push(
        makeRepair(raw, i, i + 1, String(i), { candidateScore: i + 1 })
      );
    }
    const spanSets: SpanReplacementPick[][] = [repairs];
    const coarse: CoarseSpanRange[] = [{ start: 0, end: 10 }];

    const result = buildSentenceCandidates(raw, spanSets, 16, coarse);
    expect(result.intervalAssemblyCandidateCount).toBeLessThan(
      2 ** repairs.length
    );
    expect(result.intervalAssemblyCandidateCount).toBeGreaterThan(0);
    expect(V4_LIMITS.maxIntervalEnumNodes).toBe(1024);
  });

  it('T5 in_span regression: single-slot non-overlap repairs compose like before', () => {
    const raw = '我想去咖啡厅坐坐';
    const spanSets: SpanReplacementPick[][] = [
      [
        makeRepair(raw, 3, 6, '咖啡馆', {
          windowSource: 'in_span_window',
          candidateScore: 1,
        }),
      ],
    ];
    const coarse: CoarseSpanRange[] = [{ start: 3, end: 6 }];

    const result = buildSentenceCandidates(raw, spanSets, 16, coarse);
    const repairCombo = result.combinations.find((c) => c.text === '我想去咖啡馆坐坐');
    expect(repairCombo).toBeDefined();
    expect(repairCombo!.replacements.some((r) => r.repairTarget && r.word === '咖啡馆')).toBe(true);
    expect(result.combinations[0]!.text).toBe('我想去咖啡馆坐坐');
  });
});
