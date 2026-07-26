/**
 * P5 counterfactual: domainPriors must not change Presence Vote / retainedDomains;
 * may change Assembly quota ordering only.
 */

import { describe, expect, it } from '@jest/globals';
import {
  coarseSpansAsFormalFineSpansForTests,
  runDomainAwareAssembly,
} from './assemble-domain-aware-span-sets';
import type { CoarseSpan } from '../span-assembly-shared/types';
import type { WindowCandidate } from './v4-types';

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
  overrides: Partial<WindowCandidate> & Pick<WindowCandidate, 'candidateId' | 'replacement'>
): WindowCandidate {
  return {
    windowId: '0:2',
    windowSource: 'in_span_window',
    anchorCoarseSpanId: 'c0',
    syllableStart: 0,
    syllableEnd: 2,
    rawStart: 0,
    rawEnd: 2,
    windowPinyinKey: 'a|b',
    candidateScore: 1,
    score: 1,
    boundaryPenalty: 1,
    candidateRank: 1,
    hitKind: 'exact_term',
    source: 'domain_term',
    recallSource: 'lexicon_pinyin_topk',
    repairTarget: true,
    ...overrides,
  };
}

describe('P5 prior / vote isolation counterfactual', () => {
  it('same candidates: changing domainPriors leaves Vote counts and retainedDomains identical', () => {
    const spans = [makeSpan('c0', '中杯', 0), makeSpan('c1', '奶茶', 2)];
    const candidates = [
      wc({
        candidateId: 'a',
        replacement: '中杯',
        domains: ['coffee'],
        score: 2,
      }),
      wc({
        candidateId: 'b',
        replacement: '奶茶',
        anchorCoarseSpanId: 'c1',
        rawStart: 2,
        rawEnd: 4,
        syllableStart: 2,
        syllableEnd: 4,
        domains: ['milk_tea'],
        score: 2,
      }),
      wc({
        candidateId: 'base',
        replacement: '中杯',
        source: 'base_term',
        domains: undefined,
        score: 0.5,
      }),
    ];
    const formal = coarseSpansAsFormalFineSpansForTests(spans);
    const noPrior = runDomainAwareAssembly(candidates, spans, '中杯奶茶', formal, []);
    const withPrior = runDomainAwareAssembly(candidates, spans, '中杯奶茶', formal, [
      { domain: 'coffee', weight: 1 },
    ]);

    expect(withPrior.vote.domainScores).toEqual(noPrior.vote.domainScores);
    expect([...withPrior.vote.retainedDomains]).toEqual([...noPrior.vote.retainedDomains]);
    expect(withPrior.vote.insufficientEvidence).toBe(noPrior.vote.insufficientEvidence);
  });
});
