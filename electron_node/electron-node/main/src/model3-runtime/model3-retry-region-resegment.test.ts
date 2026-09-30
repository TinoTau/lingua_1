/**
 * Retry-region resegment multi-hypothesis consumer tests.
 */

import type { RetryRegionLocalSpan } from './model3-retry-region-resegment';
import { dedupRetryRegionLocalSpans } from './model3-retry-region-resegment';
import { routeModel3Retry } from './model3-retry-router';
import {
  buildFineSpanCandidatePool,
  coarseSpansAsPathFineSpansForTests,
} from '../fw-detector/span-assembly-v4/assemble-domain-aware-span-sets';
import type { CoarseSpan } from '../fw-detector/span-assembly-shared/types';
import type { WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';
import * as voteModule from '../fw-detector/span-assembly-shared/utterance-domain-vote';

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

function local(rawStart: number, rawEnd: number, surface: string): RetryRegionLocalSpan {
  return {
    rawStart,
    rawEnd,
    syllableStart: rawStart,
    syllableEnd: rawEnd,
    surface,
  };
}

describe('dedupRetryRegionLocalSpans', () => {
  it('keeps distinct coordinate windows', () => {
    const out = dedupRetryRegionLocalSpans([
      local(0, 1, '顺'),
      local(1, 2, '便'),
      local(0, 2, '顺便'),
    ]);
    expect(out.map((s) => s.surface)).toEqual(['顺', '便', '顺便']);
  });

  it('dedups identical bounds from different paths (stable first-wins)', () => {
    const out = dedupRetryRegionLocalSpans([
      local(0, 1, '顺'),
      local(0, 1, '顺'),
      local(2, 3, '向'),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.surface).toBe('顺');
    expect(out[1]!.surface).toBe('向');
  });
});

describe('routeModel3Retry — multi-hypothesis local spans', () => {
  it('success path: Stage-2 Recall over full legal 1..min(5,R) window set', async () => {
    const spans = [span('c0', '顺', 0), span('c1', '便', 1), span('c2', '向', 2)];
    const path = coarseSpansAsPathFineSpansForTests(spans);
    const cands = path.map((s, i) => ({
      candidateId: `b${i}`,
      windowId: 'w',
      windowSource: 'in_span_window' as const,
      anchorCoarseSpanId: spans[i]!.id,
      originSpanId: s.spanId,
      syllableStart: s.syllableStart,
      syllableEnd: s.syllableEnd,
      rawStart: s.rawStart,
      rawEnd: s.rawEnd,
      windowPinyinKey: 'x',
      candidateScore: 1,
      score: 1,
      boundaryPenalty: 1,
      candidateRank: 1,
      hitKind: 'exact_term' as const,
      replacement: 'x',
      source: 'base_term' as const,
      recallSource: 'lexicon_pinyin_topk' as const,
      repairTarget: true,
    }));
    const windowTexts: string[] = [];
    await routeModel3Retry({
      decisions: path.map((s) => ({ spanId: s.spanId, decision: 'RETRY' as const, eligible: true })),
      anchors: [],
      pathFineSpans: path,
      activeCandidates: cands,
      retainedDomains: ['milk_tea'],
      rawText: '顺便向',
      globalSyllables: ['shun', 'bian', 'xiang'],
      resegment: () => ({
        ok: true,
        localSpans: dedupRetryRegionLocalSpans([
          local(0, 1, '顺'),
          local(1, 2, '便'),
          local(2, 3, '向'),
          local(0, 2, '顺便'),
          local(0, 1, '顺'),
        ]),
      }),
      recall: ({ windowText }) => {
        windowTexts.push(windowText);
        return [];
      },
    });
    // R=3 → SUM(R-L+1)=6; prior localSpan-only set is a subset
    expect(windowTexts.sort()).toEqual(['便', '便向', '向', '顺', '顺便', '顺便向']);
  });

  it('single-path union equals original span set (regression)', async () => {
    const spans = [span('c0', 'A', 0), span('c1', 'B', 1)];
    const path = coarseSpansAsPathFineSpansForTests(spans);
    const cands = path.map((s, i) => ({
      candidateId: `b${i}`,
      windowId: 'w',
      windowSource: 'in_span_window' as const,
      anchorCoarseSpanId: spans[i]!.id,
      originSpanId: s.spanId,
      syllableStart: s.syllableStart,
      syllableEnd: s.syllableEnd,
      rawStart: s.rawStart,
      rawEnd: s.rawEnd,
      windowPinyinKey: 'x',
      candidateScore: 1,
      score: 1,
      boundaryPenalty: 1,
      candidateRank: 1,
      hitKind: 'exact_term' as const,
      replacement: 'x',
      source: 'base_term' as const,
      recallSource: 'lexicon_pinyin_topk' as const,
      repairTarget: true,
    }));
    let recallCalls = 0;
    const result = await routeModel3Retry({
      decisions: [{ spanId: path[0]!.spanId, decision: 'RETRY', eligible: true }],
      anchors: [],
      pathFineSpans: path,
      activeCandidates: cands as WindowCandidate[],
      retainedDomains: [],
      rawText: 'AB',
      globalSyllables: ['a', 'b'],
      resegment: () => ({
        ok: true,
        localSpans: [local(0, 1, 'A')],
      }),
      recall: () => {
        recallCalls += 1;
        return [];
      },
    });
    expect(recallCalls).toBe(1);
    expect(result.retryRegions[0]!.newLocalSpanSurfaces).toEqual(['A']);
  });

  it('does not re-vote when union spans are supplied', async () => {
    const spans = [span('c0', 'A', 0), span('c1', 'B', 1)];
    const path = coarseSpansAsPathFineSpansForTests(spans);
    const cands = path.map((s, i) => ({
      candidateId: `m${i}`,
      windowId: 'w',
      windowSource: 'in_span_window' as const,
      anchorCoarseSpanId: spans[i]!.id,
      originSpanId: s.spanId,
      domains: ['milk_tea'],
      syllableStart: s.syllableStart,
      syllableEnd: s.syllableEnd,
      rawStart: s.rawStart,
      rawEnd: s.rawEnd,
      windowPinyinKey: 'x',
      candidateScore: 1,
      score: 1,
      boundaryPenalty: 1,
      candidateRank: 1,
      hitKind: 'exact_term' as const,
      replacement: 'x',
      source: 'base_term' as const,
      recallSource: 'lexicon_pinyin_topk' as const,
      repairTarget: true,
    }));
    const spy = jest.spyOn(voteModule, 'voteUtteranceDomainFromPool');
    const vote = voteModule.voteUtteranceDomainFromPool(
      buildFineSpanCandidatePool(cands as WindowCandidate[], spans, path)
    );
    await routeModel3Retry({
      decisions: [{ spanId: path[0]!.spanId, decision: 'RETRY', eligible: true }],
      anchors: [],
      pathFineSpans: path,
      activeCandidates: cands as WindowCandidate[],
      retainedDomains: vote.retainedDomains,
      rawText: 'AB',
      globalSyllables: ['a', 'b'],
      resegment: () => ({
        ok: true,
        localSpans: [local(0, 1, 'A'), local(0, 2, 'AB')],
      }),
      recall: () => [],
    });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
