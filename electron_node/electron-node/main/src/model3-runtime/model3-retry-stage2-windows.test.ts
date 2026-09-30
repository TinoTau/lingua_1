/**
 * Unit #1 — Stage-2 SSOT restoration: window enumeration on success; Delta 2 parity.
 */

import { coarseSpansAsPathFineSpansForTests } from '../fw-detector/span-assembly-v4/assemble-domain-aware-span-sets';
import type { CoarseSpan } from '../fw-detector/span-assembly-shared/types';
import type { WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';
import {
  enumerateStage2SuccessPathQueryRanges,
  expectedStage2WindowCount,
  stage2QueryRangeKey,
} from './model3-retry-stage2-windows';
import { deriveRetryRegions } from './model3-retry-region';
import { routeModel3Retry } from './model3-retry-router';
import type { Model3SpanDecision } from './model3-types';

function span(id: string, text: string, start: number): CoarseSpan {
  return {
    id,
    text,
    rawStart: start,
    rawEnd: start + text.length,
    syllableStart: start,
    syllableEnd: start + text.length,
    source: 'ime_token_boundary',
    boundaryConfidence: 1,
  };
}

function cand(
  pathId: string,
  coarseId: string,
  s: { syllableStart: number; syllableEnd: number; rawStart: number; rawEnd: number },
  id: string
): WindowCandidate {
  return {
    candidateId: id,
    windowId: 'w',
    windowSource: 'in_span_window',
    anchorCoarseSpanId: coarseId,
    originSpanId: pathId,
    syllableStart: s.syllableStart,
    syllableEnd: s.syllableEnd,
    rawStart: s.rawStart,
    rawEnd: s.rawEnd,
    windowPinyinKey: 'x',
    candidateScore: 1,
    score: 1,
    boundaryPenalty: 1,
    candidateRank: 1,
    hitKind: 'exact_term',
    replacement: 'x',
    source: 'base_term',
    recallSource: 'lexicon_pinyin_topk',
    repairTarget: true,
  };
}

describe('Stage-2 SSOT — window enumeration (Unit #1)', () => {
  it('expected count matches SUM(R-L+1) for L=1..min(5,R)', () => {
    expect(expectedStage2WindowCount(1)).toBe(1);
    expect(expectedStage2WindowCount(2)).toBe(3);
    expect(expectedStage2WindowCount(3)).toBe(6);
    expect(expectedStage2WindowCount(4)).toBe(10);
    expect(expectedStage2WindowCount(5)).toBe(15);
    expect(expectedStage2WindowCount(7)).toBe(25);
  });

  it('B_CROSS_LOCALSPAN_WINDOW: enumerates cross-localSpan windows inside region', () => {
    const region = {
      retryRegionId: 'r',
      sourceSpanIds: ['a', 'b', 'c'],
      firstSpanId: 'a',
      lastSpanId: 'c',
      rawStart: 0,
      rawEnd: 3,
      syllableStart: 0,
      syllableEnd: 3,
      regionMergedFromAdjacentRetry: true,
    };
    const ranges = enumerateStage2SuccessPathQueryRanges({
      region,
      rawText: '顺便向',
      globalSyllables: ['shun', 'bian', 'xiang'],
    });
    expect(ranges).toHaveLength(6);
    const texts = ranges.map((r) => r.windowText).sort();
    expect(texts).toEqual(['便', '便向', '向', '顺', '顺便', '顺便向']);
    expect(ranges.every((r) => r.rawStart >= 0 && r.rawEnd <= 3)).toBe(true);
    expect(ranges.every((r) => r.syllableStart >= 0 && r.syllableEnd <= 3)).toBe(true);
  });

  it('coordinate remap: mid-utterance region offsets stay global', () => {
    const region = {
      retryRegionId: 'r',
      sourceSpanIds: ['b', 'c'],
      firstSpanId: 'b',
      lastSpanId: 'c',
      rawStart: 2,
      rawEnd: 4,
      syllableStart: 2,
      syllableEnd: 4,
      regionMergedFromAdjacentRetry: true,
    };
    const ranges = enumerateStage2SuccessPathQueryRanges({
      region,
      rawText: '前缀便向',
      globalSyllables: ['qian', 'zhui', 'bian', 'xiang'],
    });
    expect(ranges).toHaveLength(3);
    for (const r of ranges) {
      expect(r.syllableStart).toBeGreaterThanOrEqual(2);
      expect(r.syllableEnd).toBeLessThanOrEqual(4);
      expect(r.rawStart).toBeGreaterThanOrEqual(2);
      expect(r.rawEnd).toBeLessThanOrEqual(4);
    }
    expect(ranges.some((r) => r.windowText === '便向')).toBe(true);
  });

  it('A_ADEQUATE_LOCALSPAN: prior localSpan queries remain representable', async () => {
    const spans = [span('c0', '顺', 0), span('c1', '便', 1)];
    const path = coarseSpansAsPathFineSpansForTests(spans);
    const windowTexts: string[] = [];
    await routeModel3Retry({
      decisions: path.map((s) => ({ spanId: s.spanId, decision: 'RETRY' as const, eligible: true })),
      anchors: [],
      pathFineSpans: path,
      activeCandidates: path.map((s, i) => cand(s.spanId, spans[i]!.id, s, `b${i}`)),
      retainedDomains: [],
      rawText: '顺便',
      globalSyllables: ['shun', 'bian'],
      resegment: () => ({
        ok: true,
        localSpans: [
          { rawStart: 0, rawEnd: 1, syllableStart: 0, syllableEnd: 1, surface: '顺' },
          { rawStart: 1, rawEnd: 2, syllableStart: 1, syllableEnd: 2, surface: '便' },
        ],
      }),
      recall: ({ windowText }) => {
        windowTexts.push(windowText);
        return [];
      },
    });
    expect(windowTexts).toContain('顺');
    expect(windowTexts).toContain('便');
    expect(windowTexts).toContain('顺便');
    expect(windowTexts).toHaveLength(3);
  });

  it('D_SINGLE_CHAR: R=1 → exactly one Stage-2 query', async () => {
    const spans = [span('c0', 'A', 0), span('c1', 'B', 1)];
    const path = coarseSpansAsPathFineSpansForTests(spans);
    let calls = 0;
    const texts: string[] = [];
    await routeModel3Retry({
      decisions: [{ spanId: path[0]!.spanId, decision: 'RETRY', eligible: true }],
      anchors: [],
      pathFineSpans: path,
      activeCandidates: path.map((s, i) => cand(s.spanId, spans[i]!.id, s, `b${i}`)),
      retainedDomains: [],
      rawText: 'AB',
      globalSyllables: ['a', 'b'],
      resegment: () => ({
        ok: true,
        localSpans: [
          { rawStart: 0, rawEnd: 1, syllableStart: 0, syllableEnd: 1, surface: 'A' },
        ],
      }),
      recall: ({ windowText }) => {
        calls += 1;
        texts.push(windowText);
        return [];
      },
    });
    expect(calls).toBe(1);
    expect(texts).toEqual(['A']);
  });

  it('E_ANCHOR_ADJACENT: queries never cross Anchor KEEP barrier', async () => {
    const spans = [span('c0', 'A', 0), span('c1', 'B', 1), span('c2', 'C', 2)];
    const path = coarseSpansAsPathFineSpansForTests(spans);
    const decisions: Model3SpanDecision[] = [
      { spanId: path[0]!.spanId, decision: 'RETRY', eligible: true },
      { spanId: path[1]!.spanId, decision: 'KEEP', eligible: true },
      { spanId: path[2]!.spanId, decision: 'RETRY', eligible: true },
    ];
    const anchors = [
      {
        spanId: path[1]!.spanId,
        surface: 'B',
        rawStart: 1,
        rawEnd: 2,
        syllableStart: 1,
        syllableEnd: 2,
      },
    ];
    const regions = deriveRetryRegions({ decisions, anchors, pathFineSpans: path });
    expect(regions).toHaveLength(2);
    const windowKeys: string[] = [];
    await routeModel3Retry({
      decisions,
      anchors,
      pathFineSpans: path,
      activeCandidates: path.map((s, i) => cand(s.spanId, spans[i]!.id, s, `b${i}`)),
      retainedDomains: [],
      rawText: 'ABC',
      globalSyllables: ['a', 'b', 'c'],
      resegment: () => ({
        ok: true,
        localSpans: [
          { rawStart: 0, rawEnd: 1, syllableStart: 0, syllableEnd: 1, surface: 'A' },
        ],
      }),
      recall: ({ local }) => {
        windowKeys.push(stage2QueryRangeKey(local));
        return [];
      },
    });
    for (const key of windowKeys) {
      const [syl] = key.split('|');
      const [s0, s1] = syl!.split(':').map(Number);
      // No Stage-2 query may cross the Anchor syllable at index 1
      expect(s0! < 1 && s1! > 1).toBe(false);
      expect(s0!).toBeGreaterThanOrEqual(0);
      expect(s1!).toBeLessThanOrEqual(3);
    }
    // Two separate R=1 regions → two L=1 queries only
    expect(windowKeys.sort()).toEqual(['0:1|0:1', '2:3|2:3']);
  });

  it('F_KEEP_ADJACENT: region queries stay inside RetryRegion (no KEEP cross)', async () => {
    const spans = [span('c0', 'A', 0), span('c1', 'B', 1), span('c2', 'C', 2)];
    const path = coarseSpansAsPathFineSpansForTests(spans);
    const decisions: Model3SpanDecision[] = [
      { spanId: path[0]!.spanId, decision: 'KEEP', eligible: true },
      { spanId: path[1]!.spanId, decision: 'RETRY', eligible: true },
      { spanId: path[2]!.spanId, decision: 'KEEP', eligible: true },
    ];
    const regions = deriveRetryRegions({ decisions, anchors: [], pathFineSpans: path });
    expect(regions).toHaveLength(1);
    expect(regions[0]!.syllableStart).toBe(1);
    expect(regions[0]!.syllableEnd).toBe(2);
    const queries: { rawStart: number; rawEnd: number }[] = [];
    await routeModel3Retry({
      decisions,
      anchors: [],
      pathFineSpans: path,
      activeCandidates: path.map((s, i) => cand(s.spanId, spans[i]!.id, s, `b${i}`)),
      retainedDomains: [],
      rawText: 'ABC',
      globalSyllables: ['a', 'b', 'c'],
      resegment: () => ({
        ok: true,
        localSpans: [
          { rawStart: 1, rawEnd: 2, syllableStart: 1, syllableEnd: 2, surface: 'B' },
        ],
      }),
      recall: ({ local }) => {
        queries.push({ rawStart: local.rawStart, rawEnd: local.rawEnd });
        return [];
      },
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toEqual({ rawStart: 1, rawEnd: 2 });
  });

  it('DELTA2: fallback path uses legal 1..min(5,R) windows; resegmentOk stays false', async () => {
    const spans = [span('c0', '顺', 0), span('c1', '便', 1), span('c2', '向', 2)];
    const path = coarseSpansAsPathFineSpansForTests(spans);
    const localSpans = [
      { rawStart: 0, rawEnd: 1, syllableStart: 0, syllableEnd: 1, surface: '顺' },
      { rawStart: 1, rawEnd: 2, syllableStart: 1, syllableEnd: 2, surface: '便' },
      { rawStart: 2, rawEnd: 3, syllableStart: 2, syllableEnd: 3, surface: '向' },
    ];
    const windowTexts: string[] = [];
    const result = await routeModel3Retry({
      decisions: path.map((s) => ({ spanId: s.spanId, decision: 'RETRY' as const, eligible: true })),
      anchors: [],
      pathFineSpans: path,
      activeCandidates: path.map((s, i) => cand(s.spanId, spans[i]!.id, s, `b${i}`)),
      retainedDomains: [],
      rawText: '顺便向',
      globalSyllables: ['shun', 'bian', 'xiang'],
      resegment: () => ({
        ok: false,
        code: 'NO_PATH',
        localSpans,
      }),
      recall: ({ windowText }) => {
        windowTexts.push(windowText);
        return [];
      },
    });
    expect(result.retryRegions[0]!.resegmentOk).toBe(false);
    expect(result.retryRegions[0]!.fallbackGeometrySource).toBe('RETRY_REGION_LEGAL_WINDOW_SPACE');
    expect(result.retryRegions[0]!.fallbackReason).toBe('NO_PATH');
    // Supporting FineSpan surfaces retained for trace; not the query set
    expect(result.retryRegions[0]!.newLocalSpanSurfaces).toEqual(['顺', '便', '向']);
    // R=3 → 6 legal windows (cross-FineSpan included)
    expect(windowTexts.sort()).toEqual(['便', '便向', '向', '顺', '顺便', '顺便向']);
  });

  it('DELTA1 parity: success path still full legal windows; resegmentOk true', async () => {
    const spans = [span('c0', '顺', 0), span('c1', '便', 1)];
    const path = coarseSpansAsPathFineSpansForTests(spans);
    const windowTexts: string[] = [];
    const result = await routeModel3Retry({
      decisions: path.map((s) => ({ spanId: s.spanId, decision: 'RETRY' as const, eligible: true })),
      anchors: [],
      pathFineSpans: path,
      activeCandidates: path.map((s, i) => cand(s.spanId, spans[i]!.id, s, `b${i}`)),
      retainedDomains: [],
      rawText: '顺便',
      globalSyllables: ['shun', 'bian'],
      resegment: () => ({
        ok: true,
        localSpans: [
          { rawStart: 0, rawEnd: 1, syllableStart: 0, syllableEnd: 1, surface: '顺' },
          { rawStart: 1, rawEnd: 2, syllableStart: 1, syllableEnd: 2, surface: '便' },
        ],
      }),
      recall: ({ windowText }) => {
        windowTexts.push(windowText);
        return [];
      },
    });
    expect(result.retryRegions[0]!.resegmentOk).toBe(true);
    expect(result.retryRegions[0]!.fallbackGeometrySource).toBeUndefined();
    expect(windowTexts.sort()).toEqual(['便', '顺', '顺便']);
  });

  it('window-set assertion: missing/extra/outOfRegion = 0 on success', () => {
    const region = {
      retryRegionId: 'r',
      sourceSpanIds: ['a', 'b', 'c', 'd'],
      firstSpanId: 'a',
      lastSpanId: 'd',
      rawStart: 0,
      rawEnd: 4,
      syllableStart: 0,
      syllableEnd: 4,
      regionMergedFromAdjacentRetry: true,
    };
    const actual = enumerateStage2SuccessPathQueryRanges({
      region,
      rawText: '一二三四',
      globalSyllables: ['yi', 'er', 'san', 'si'],
    });
    const expectedKeys = new Set<string>();
    for (let start = 0; start < 4; start += 1) {
      for (let len = 1; len <= Math.min(5, 4 - start); len += 1) {
        expectedKeys.add(`${start}:${start + len}|${start}:${start + len}`);
      }
    }
    const actualKeys = new Set(actual.map(stage2QueryRangeKey));
    let missing = 0;
    let extra = 0;
    let outOfRegion = 0;
    for (const k of expectedKeys) {
      if (!actualKeys.has(k)) missing += 1;
    }
    for (const k of actualKeys) {
      if (!expectedKeys.has(k)) extra += 1;
    }
    for (const q of actual) {
      if (
        q.syllableStart < region.syllableStart ||
        q.syllableEnd > region.syllableEnd ||
        q.rawStart < region.rawStart ||
        q.rawEnd > region.rawEnd
      ) {
        outOfRegion += 1;
      }
    }
    expect(missing).toBe(0);
    expect(extra).toBe(0);
    expect(outOfRegion).toBe(0);
    expect(actual).toHaveLength(10);
  });
});
