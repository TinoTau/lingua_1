import { describe, expect, it } from '@jest/globals';
import type { CoarseSpan } from '../span-assembly-shared/types';
import {
  assembleDomainAwareSpanSets,
  buildFineSpanCandidatePool,
  filterDomainCandidatesPerSpan,
  runDomainAwareAssembly,
  selectPerSpanCandidates,
} from './assemble-domain-aware-span-sets';
import { voteUtteranceDomainFromPool } from '../span-assembly-shared/utterance-domain-vote';
import type { WindowCandidate } from './v4-types';

function makeCoarseSpan(id: string, text: string, start: number): CoarseSpan {
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

function makeCandidate(
  overrides: Partial<WindowCandidate> & Pick<WindowCandidate, 'candidateId' | 'replacement'>
): WindowCandidate {
  return {
    windowId: 'w0',
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
    source: 'base_term',
    recallSource: 'lexicon_pinyin_topk',
    repairTarget: true,
    ...overrides,
  };
}

describe('assemble-domain-aware-span-sets', () => {
  const rawText = '我要中杯';
  const coarseSpans = [makeCoarseSpan('c0', '我要', 0), makeCoarseSpan('c1', '中杯', 2)];

  it('buildFineSpanCandidatePool groups by anchorCoarseSpanId', () => {
    const pool = buildFineSpanCandidatePool(
      [
        makeCandidate({ candidateId: 'a', replacement: '我要', anchorCoarseSpanId: 'c0', rawStart: 0, rawEnd: 2 }),
        makeCandidate({
          candidateId: 'b',
          replacement: '中杯',
          anchorCoarseSpanId: 'c1',
          rawStart: 2,
          rawEnd: 4,
          syllableStart: 2,
          syllableEnd: 4,
        }),
      ],
      coarseSpans
    );
    expect(pool).toHaveLength(2);
    expect(pool[0]?.candidates).toHaveLength(1);
    expect(pool[1]?.candidates).toHaveLength(1);
  });

  it('voteUtteranceDomainFromPool counts parent_fragment once per parentTermId', () => {
    const pool = buildFineSpanCandidatePool(
      [
        makeCandidate({
          candidateId: 'p1',
          replacement: '中',
          hitKind: 'parent_fragment',
          parentTermId: 'pt1',
          domainId: 'restaurant',
          source: 'domain_term',
          matchedTermStart: 0,
          matchedTermEnd: 1,
        }),
        makeCandidate({
          candidateId: 'p2',
          replacement: '杯',
          hitKind: 'parent_fragment',
          parentTermId: 'pt1',
          domainId: 'restaurant',
          source: 'domain_term',
          matchedTermStart: 1,
          matchedTermEnd: 2,
        }),
      ],
      coarseSpans
    );
    const vote = voteUtteranceDomainFromPool(pool);
    expect(vote.parentTermVoteCount).toBe(1);
    expect(vote.utteranceDomain).toBe('restaurant');
  });

  it('selectPerSpanCandidates fills canonical ASR when no candidates', () => {
    const vote = { utteranceDomain: 'general', insufficientEvidence: true, domainScores: {}, domainVoteMs: 0, parentTermVoteCount: 0 };
    const filtered = filterDomainCandidatesPerSpan(
      buildFineSpanCandidatePool([], coarseSpans),
      vote,
      rawText
    );
    const selected = selectPerSpanCandidates(filtered, coarseSpans.length, coarseSpans);
    const spanSets = assembleDomainAwareSpanSets(selected);
    expect(spanSets).toHaveLength(2);
    expect(spanSets[0]?.[0]?.word).toBe('我要');
    expect(spanSets[0]?.[0]?.source).toBe('canonical_exact');
    expect(spanSets[1]?.[0]?.word).toBe('中杯');
  });

  it('sameDomain candidates prioritized over base when domain wins', () => {
    const result = runDomainAwareAssembly(
      [
        makeCandidate({
          candidateId: 'base',
          replacement: '中杯',
          anchorCoarseSpanId: 'c1',
          rawStart: 2,
          rawEnd: 4,
          syllableStart: 2,
          syllableEnd: 4,
          source: 'base_term',
          score: 0.9,
        }),
        makeCandidate({
          candidateId: 'domain',
          replacement: '大杯',
          anchorCoarseSpanId: 'c1',
          rawStart: 2,
          rawEnd: 4,
          syllableStart: 2,
          syllableEnd: 4,
          source: 'domain_term',
          domainId: 'restaurant',
          score: 0.8,
        }),
        makeCandidate({
          candidateId: 'vote',
          replacement: '点餐',
          anchorCoarseSpanId: 'c0',
          rawStart: 0,
          rawEnd: 2,
          source: 'domain_term',
          domainId: 'restaurant',
          score: 2,
        }),
      ],
      coarseSpans,
      rawText
    );
    const c1Picks = result.spanSets[1] ?? [];
    expect(c1Picks[0]?.word).toBe('大杯');
    expect(result.metrics.domainCandidateCount).toBeGreaterThan(0);
    expect(result.metrics.baseCandidateCount).toBeGreaterThan(0);
  });

  it('SpanReplacementPick.source comes from recallSource not graphSource', () => {
    const result = runDomainAwareAssembly(
      [
        makeCandidate({
          candidateId: 'd1',
          replacement: '大杯',
          anchorCoarseSpanId: 'c1',
          rawStart: 2,
          rawEnd: 4,
          syllableStart: 2,
          syllableEnd: 4,
          source: 'domain_term',
          domainId: 'restaurant',
          recallSource: 'lexicon_pinyin_topk',
          score: 2,
        }),
        makeCandidate({
          candidateId: 'v1',
          replacement: '点餐',
          anchorCoarseSpanId: 'c0',
          source: 'domain_term',
          domainId: 'restaurant',
          score: 2,
        }),
      ],
      coarseSpans,
      rawText
    );
    const domainPick = result.spanSets[1]?.find((p) => p.word === '大杯');
    expect(domainPick?.source).toBe('lexicon_pinyin_topk');
  });
});
