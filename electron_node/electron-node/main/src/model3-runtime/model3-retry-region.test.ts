/**
 * Model3 retry-region unit tests — §30–38.
 */

import {
  buildFineSpanCandidatePool,
  coarseSpansAsPathFineSpansForTests,
} from '../fw-detector/span-assembly-v4/assemble-domain-aware-span-sets';
import type { PathFineSpan } from '../fw-detector/span-assembly-v4/path-fine-span-types';
import type { WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';
import type { CoarseSpan } from '../fw-detector/span-assembly-shared/types';
import { getPerSpanCandidateLimit } from '../fw-detector/per-span-candidate-limit';
import * as voteModule from '../fw-detector/span-assembly-shared/utterance-domain-vote';
import type { RecallSpanTopKV2Hit } from '../lexicon-v2/recall-span-topk-v2';
import { deriveRetryRegions } from './model3-retry-region';
import { routeModel3Retry } from './model3-retry-router';
import type { Model3SpanDecision } from './model3-types';

function makeSpan(id: string, text: string, start: number): CoarseSpan {
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

function wc(
  overrides: Partial<WindowCandidate> &
    Pick<WindowCandidate, 'candidateId' | 'replacement' | 'anchorCoarseSpanId'>
): WindowCandidate {
  const replacement = overrides.replacement;
  const inferredEnd =
    typeof replacement === 'string' && replacement.length > 0 ? replacement.length : 2;
  return {
    windowId: 'w0',
    windowSource: 'in_span_window',
    syllableStart: 0,
    syllableEnd: inferredEnd,
    rawStart: 0,
    rawEnd: inferredEnd,
    windowPinyinKey: 'x|y',
    candidateScore: 1,
    score: 1,
    boundaryPenalty: 1,
    candidateRank: 1,
    hitKind: 'exact_term',
    source: 'base_term',
    recallSource: 'lexicon_pinyin_topk',
    repairTarget: true,
    termId: overrides.termId ?? overrides.candidateId,
    ...overrides,
  };
}

function pathFromSpans(spans: CoarseSpan[]): PathFineSpan[] {
  return coarseSpansAsPathFineSpansForTests(spans);
}

describe('deriveRetryRegions', () => {
  it('§31: adjacent RETRY → one merged region', () => {
    const spans = [
      makeSpan('c0', 'A', 0),
      makeSpan('c1', 'B', 1),
      makeSpan('c2', 'C', 2),
    ];
    const path = pathFromSpans(spans);
    const decisions: Model3SpanDecision[] = path.map((s) => ({
      spanId: s.spanId,
      decision: 'RETRY',
      eligible: true,
    }));
    const regions = deriveRetryRegions({ decisions, anchors: [], pathFineSpans: path });
    expect(regions).toHaveLength(1);
    expect(regions[0]!.sourceSpanIds).toHaveLength(3);
    expect(regions[0]!.regionMergedFromAdjacentRetry).toBe(true);
  });

  it('§32: Anchor barrier → two regions', () => {
    const spans = [
      makeSpan('c0', 'A', 0),
      makeSpan('c1', 'B', 1),
      makeSpan('c2', 'C', 2),
    ];
    const path = pathFromSpans(spans);
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
        source: 'MODEL2' as const,
      },
    ];
    const regions = deriveRetryRegions({ decisions, anchors, pathFineSpans: path });
    expect(regions).toHaveLength(2);
    expect(regions[0]!.sourceSpanIds).toEqual([path[0]!.spanId]);
    expect(regions[1]!.sourceSpanIds).toEqual([path[2]!.spanId]);
  });

  it('§33: KEEP barrier → two regions', () => {
    const spans = [
      makeSpan('c0', 'A', 0),
      makeSpan('c1', 'B', 1),
      makeSpan('c2', 'C', 2),
    ];
    const path = pathFromSpans(spans);
    const decisions: Model3SpanDecision[] = [
      { spanId: path[0]!.spanId, decision: 'RETRY', eligible: true },
      { spanId: path[1]!.spanId, decision: 'KEEP', eligible: true },
      { spanId: path[2]!.spanId, decision: 'RETRY', eligible: true },
    ];
    const regions = deriveRetryRegions({ decisions, anchors: [], pathFineSpans: path });
    expect(regions).toHaveLength(2);
  });

  it('§30: single RETRY → one region', () => {
    const spans = [makeSpan('c0', 'A', 0), makeSpan('c1', 'B', 1)];
    const path = pathFromSpans(spans);
    const decisions: Model3SpanDecision[] = [
      { spanId: path[0]!.spanId, decision: 'RETRY', eligible: true },
      { spanId: path[1]!.spanId, decision: 'KEEP', eligible: true },
    ];
    const regions = deriveRetryRegions({ decisions, anchors: [], pathFineSpans: path });
    expect(regions).toHaveLength(1);
    expect(regions[0]!.regionMergedFromAdjacentRetry).toBe(false);
  });
});

describe('routeModel3Retry — region correction', () => {
  it('§30: single RETRY region — recall, no second vote/model3 in trace', async () => {
    const spans = [makeSpan('c0', 'A', 0), makeSpan('c1', 'B', 1)];
    const path = pathFromSpans(spans);
    const cands = path.map((s, i) =>
      wc({
        candidateId: `b${i}`,
        replacement: 'x',
        anchorCoarseSpanId: spans[i]!.id,
        originSpanId: s.spanId,
        syllableStart: s.syllableStart,
        syllableEnd: s.syllableEnd,
        rawStart: s.rawStart,
        rawEnd: s.rawEnd,
      })
    );
    let recallCalls = 0;
    const result = await routeModel3Retry({
      decisions: [{ spanId: path[0]!.spanId, decision: 'RETRY', eligible: true }],
      anchors: [],
      pathFineSpans: path,
      activeCandidates: cands,
      retainedDomains: ['milk_tea'],
      rawText: 'AB',
      globalSyllables: ['a', 'b'],
      recall: () => {
        recallCalls += 1;
        return [];
      },
    });
    expect(recallCalls).toBe(1);
    expect(result.retryRegions).toHaveLength(1);
    expect(result.retryRegions[0]!.secondDomainVote).toBe(false);
    expect(result.retryRegions[0]!.model3Reinvoked).toBe(false);
  });

  it('§31: adjacent RETRY merged — one region trace', async () => {
    const spans = [
      makeSpan('c0', 'A', 0),
      makeSpan('c1', 'B', 1),
      makeSpan('c2', 'C', 2),
    ];
    const path = pathFromSpans(spans);
    const cands = path.map((s, i) =>
      wc({
        candidateId: `b${i}`,
        replacement: 'x',
        anchorCoarseSpanId: spans[i]!.id,
        originSpanId: s.spanId,
        syllableStart: s.syllableStart,
        syllableEnd: s.syllableEnd,
        rawStart: s.rawStart,
        rawEnd: s.rawEnd,
      })
    );
    const result = await routeModel3Retry({
      decisions: path.map((s) => ({ spanId: s.spanId, decision: 'RETRY' as const, eligible: true })),
      anchors: [],
      pathFineSpans: path,
      activeCandidates: cands,
      retainedDomains: [],
      rawText: 'ABC',
      globalSyllables: ['a', 'b', 'c'],
      recall: () => [],
    });
    expect(result.retryRegions).toHaveLength(1);
    expect(result.retryRegions[0]!.regionMergedFromAdjacentRetry).toBe(true);
  });

  it('§34: segmentation change consumed via resegment hook', async () => {
    const spans = [
      makeSpan('c0', 'A', 0),
      makeSpan('c1', 'B', 1),
      makeSpan('c2', 'C', 2),
    ];
    const path = pathFromSpans(spans);
    const cands = path.map((s, i) =>
      wc({
        candidateId: `b${i}`,
        replacement: 'x',
        anchorCoarseSpanId: spans[i]!.id,
        originSpanId: s.spanId,
        syllableStart: s.syllableStart,
        syllableEnd: s.syllableEnd,
        rawStart: s.rawStart,
        rawEnd: s.rawEnd,
      })
    );
    const windowTexts: string[] = [];
    const result = await routeModel3Retry({
      decisions: path.map((s) => ({ spanId: s.spanId, decision: 'RETRY' as const, eligible: true })),
      anchors: [],
      pathFineSpans: path,
      activeCandidates: cands,
      retainedDomains: [],
      rawText: 'ABC',
      globalSyllables: ['a', 'b', 'c'],
      resegment: () => ({
        ok: true,
        localSpans: [
          {
            rawStart: 0,
            rawEnd: 2,
            syllableStart: 0,
            syllableEnd: 2,
            surface: 'AB',
          },
          {
            rawStart: 2,
            rawEnd: 3,
            syllableStart: 2,
            syllableEnd: 3,
            surface: 'C',
          },
        ],
      }),
      recall: ({ windowText }) => {
        windowTexts.push(windowText);
        return [
          {
            hotword: { id: 'w', word: windowText === 'AB' ? 'AB' : 'C', domains: [] },
            phoneticScore: 1,
            candidateScore: 5,
            candidateScoreBreakdown: {} as never,
            source: 'lexicon_pinyin_topk',
          } as RecallSpanTopKV2Hit,
        ];
      },
    });
    expect(result.retryRegions[0]!.newLocalSpanSurfaces).toEqual(['AB', 'C']);
    expect(windowTexts).toContain('AB');
    expect(result.mutated).toBe(true);
  });

  it('§35: outside region immutable', async () => {
    const spans = [
      makeSpan('c0', 'A', 0),
      makeSpan('c1', 'B', 1),
      makeSpan('c2', 'C', 2),
    ];
    const path = pathFromSpans(spans);
    const keepCand = wc({
      candidateId: 'keep0',
      replacement: 'KEEP_A',
      anchorCoarseSpanId: 'c0',
      originSpanId: path[0]!.spanId,
      syllableStart: 0,
      syllableEnd: 1,
      rawStart: 0,
      rawEnd: 1,
      candidateScore: 99,
    });
    const retryCand = wc({
      candidateId: 'retry1',
      replacement: 'OLD_B',
      anchorCoarseSpanId: 'c1',
      originSpanId: path[1]!.spanId,
      syllableStart: 1,
      syllableEnd: 2,
      rawStart: 1,
      rawEnd: 2,
    });
    const tailCand = wc({
      candidateId: 'tail2',
      replacement: 'KEEP_C',
      anchorCoarseSpanId: 'c2',
      originSpanId: path[2]!.spanId,
      syllableStart: 2,
      syllableEnd: 3,
      rawStart: 2,
      rawEnd: 3,
      candidateScore: 88,
    });
    const result = await routeModel3Retry({
      decisions: [{ spanId: path[1]!.spanId, decision: 'RETRY', eligible: true }],
      anchors: [],
      pathFineSpans: path,
      activeCandidates: [keepCand, retryCand, tailCand],
      retainedDomains: [],
      rawText: 'ABC',
      globalSyllables: ['a', 'b', 'c'],
      recall: () => [
        {
          hotword: { id: 'new', word: 'NEW_B', domains: [] },
          phoneticScore: 1,
          candidateScore: 5,
          candidateScoreBreakdown: {} as never,
          source: 'lexicon_pinyin_topk',
        } as RecallSpanTopKV2Hit,
      ],
    });
    expect(result.activeCandidates.some((c) => c.candidateId === 'keep0')).toBe(true);
    expect(result.activeCandidates.some((c) => c.candidateId === 'tail2')).toBe(true);
    expect(
      result.activeCandidates.some((c) => c.replacement === 'NEW_B' && c.originSpanId === path[1]!.spanId)
    ).toBe(true);
  });

  it('§36: per-span cap preserved', async () => {
    const spans = [makeSpan('c0', 'A', 0), makeSpan('c1', 'B', 1), makeSpan('c2', 'C', 2)];
    const path = pathFromSpans(spans);
    const cap = getPerSpanCandidateLimit(path.length);
    const existing = Array.from({ length: 3 }, (_, i) =>
      wc({
        candidateId: `e${i}`,
        replacement: `旧${i}`,
        anchorCoarseSpanId: 'c0',
        originSpanId: path[0]!.spanId,
        syllableStart: 0,
        syllableEnd: 1,
        rawStart: 0,
        rawEnd: 1,
        candidateScore: 10 - i,
      })
    );
    const result = await routeModel3Retry({
      decisions: [{ spanId: path[0]!.spanId, decision: 'RETRY', eligible: true }],
      anchors: [],
      pathFineSpans: path,
      activeCandidates: existing,
      retainedDomains: [],
      rawText: 'ABC',
      globalSyllables: ['a', 'b', 'c'],
      recall: () =>
        Array.from({ length: 10 }, (_, i) =>
          ({
            hotword: { id: `new${i}`, word: `新${i}`, domains: [] },
            phoneticScore: 1,
            candidateScore: 5,
            candidateScoreBreakdown: {} as never,
            source: 'lexicon_pinyin_topk',
          }) as RecallSpanTopKV2Hit
        ),
    });
    const final = result.activeCandidates.filter(
      (c) => c.originSpanId === path[0]!.spanId && !c.isCovered
    );
    expect(final.length).toBeLessThanOrEqual(cap);
    expect(result.perSpanBudgetViolations).toBe(0);
  });

  it('§37: Domain Vote call count === 1 (via path step pattern)', async () => {
    const spans = [makeSpan('c0', 'A', 0), makeSpan('c1', 'B', 1)];
    const path = pathFromSpans(spans);
    const cands = path.map((s, i) =>
      wc({
        candidateId: `m${i}`,
        replacement: 'x',
        anchorCoarseSpanId: spans[i]!.id,
        originSpanId: s.spanId,
        domains: ['milk_tea'],
        syllableStart: s.syllableStart,
        syllableEnd: s.syllableEnd,
        rawStart: s.rawStart,
        rawEnd: s.rawEnd,
      })
    );
    const spy = jest.spyOn(voteModule, 'voteUtteranceDomainFromPool');
    const vote = voteModule.voteUtteranceDomainFromPool(
      buildFineSpanCandidatePool(cands, spans, path)
    );
    await routeModel3Retry({
      decisions: [{ spanId: path[0]!.spanId, decision: 'RETRY', eligible: true }],
      anchors: [],
      pathFineSpans: path,
      activeCandidates: cands,
      retainedDomains: vote.retainedDomains,
      rawText: 'AB',
      globalSyllables: ['a', 'b'],
      recall: () => [],
    });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
