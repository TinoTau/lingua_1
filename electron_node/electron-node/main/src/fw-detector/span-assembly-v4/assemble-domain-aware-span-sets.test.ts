import { describe, expect, it } from '@jest/globals';
import type { CoarseSpan } from '../span-assembly-shared/types';
import {
  assembleDomainAwareSpanSets,
  buildFineSpanCandidatePool,
  buildFineSpanCandidatePoolFromCoarseSpansForTests,
  coarseSpansAsPathFineSpansForTests,
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

describe('assemble-domain-aware-span-sets (presence vote + multi-bucket)', () => {
  const rawText = '????';
  const coarseSpans = [makeCoarseSpan('c0', '??', 0), makeCoarseSpan('c1', '??', 2)];

  it('buildFineSpanCandidatePoolFromCoarseSpansForTests groups by anchorCoarseSpanId', () => {
    const pool = buildFineSpanCandidatePoolFromCoarseSpansForTests(
      [
        makeCandidate({ candidateId: 'a', replacement: '??', anchorCoarseSpanId: 'c0', rawStart: 0, rawEnd: 2 }),
        makeCandidate({
          candidateId: 'b',
          replacement: '??',
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

  it('production buildFineSpanCandidatePool hard-fails without PathFineSpan', () => {
    expect(() => buildFineSpanCandidatePool([], coarseSpans, [])).toThrow(/PATH_FINE_SPAN_POOL/);
  });

  it('voteUtteranceDomainFromPool counts exact_term once per span domain; parentTermVoteCount stays 0 (PF retired)', () => {
    const pool = buildFineSpanCandidatePoolFromCoarseSpansForTests(
      [
        makeCandidate({
          candidateId: 'p1',
          replacement: '?',
          hitKind: 'exact_term',
          domains: ['restaurant'],
          source: 'domain_term',
        }),
        makeCandidate({
          candidateId: 'p1',
          replacement: '?',
          hitKind: 'exact_term',
          domains: ['restaurant'],
          source: 'domain_term',
        }),
      ],
      coarseSpans
    );
    const vote = voteUtteranceDomainFromPool(pool);
    // JOBRESULT_ADAPTER_DEBT — parent-term structural vote retired (Phase 2/3); always 0.
    expect(vote.parentTermVoteCount).toBe(0);
    expect(vote.domainScores.restaurant).toBe(1);
    expect(vote.retainedDomains).toEqual(['restaurant']);
    expect(vote.utteranceDomain).toBe('restaurant');
  });

  it('selectPerSpanCandidates keeps canonical/raw when no recall candidates (preservation, not winner mask)', () => {
    const vote = {
      utteranceDomain: 'general',
      insufficientEvidence: true,
      domainScores: {},
      domainVoteMs: 0,
      parentTermVoteCount: 0,
      winnerScore: 0,
      runnerUpDomain: 'general',
      runnerUpScore: 0,
      voteMargin: 0,
      retainedDomains: [] as const,
      maxCount: 0,
      runnerUpCount: 0,
      isTie: false,
    };
    const filtered = filterDomainCandidatesPerSpan(
      buildFineSpanCandidatePoolFromCoarseSpansForTests([], coarseSpans),
      vote,
      rawText,
      null
    );
    const selected = selectPerSpanCandidates(
      filtered,
      coarseSpans.length,
      coarseSpans,
      coarseSpansAsPathFineSpansForTests(coarseSpans),
      rawText
    );
    const spanSets = assembleDomainAwareSpanSets(selected);
    expect(spanSets).toHaveLength(2);
    expect(spanSets[0]?.[0]?.word).toBe('??');
    expect(spanSets[0]?.[0]?.source).toBe('canonical_exact');
    expect(spanSets[1]?.[0]?.word).toBe('??');
  });

  it('sameDomain candidates prioritized over base when domain wins', () => {
    const result = runDomainAwareAssembly(
      [
        makeCandidate({
          candidateId: 'base',
          replacement: '??',
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
          replacement: '??',
          anchorCoarseSpanId: 'c1',
          rawStart: 2,
          rawEnd: 4,
          syllableStart: 2,
          syllableEnd: 4,
          source: 'domain_term',
          domains: ['restaurant'],
          score: 0.8,
        }),
        makeCandidate({
          candidateId: 'vote',
          replacement: '??',
          anchorCoarseSpanId: 'c0',
          rawStart: 0,
          rawEnd: 2,
          source: 'domain_term',
          domains: ['restaurant'],
          score: 2,
        }),
      ],
      coarseSpans,
      rawText,
      coarseSpansAsPathFineSpansForTests(coarseSpans)
    );
    const c1Picks = result.spanSets[1] ?? [];
    expect(c1Picks[0]?.word).toBe('??');
    expect(result.metrics.domainCandidateCount).toBeGreaterThan(0);
    expect(result.metrics.baseCandidateCount).toBeGreaterThan(0);
    expect(result.vote.retainedDomains).toEqual(['restaurant']);
  });

  it('SpanReplacementPick.source comes from recallSource not graphSource and has no domains', () => {
    const result = runDomainAwareAssembly(
      [
        makeCandidate({
          candidateId: 'd1',
          replacement: '??',
          anchorCoarseSpanId: 'c1',
          rawStart: 2,
          rawEnd: 4,
          syllableStart: 2,
          syllableEnd: 4,
          source: 'domain_term',
          domains: ['restaurant'],
          recallSource: 'lexicon_pinyin_topk',
          score: 2,
        }),
        makeCandidate({
          candidateId: 'v1',
          replacement: '??',
          anchorCoarseSpanId: 'c0',
          source: 'domain_term',
          domains: ['restaurant'],
          score: 2,
        }),
      ],
      coarseSpans,
      rawText,
      coarseSpansAsPathFineSpansForTests(coarseSpans)
    );
    const domainPick = result.spanSets[1]?.find((p) => p.word === '??');
    expect(domainPick?.source).toBe('lexicon_pinyin_topk');
    expect(domainPick).not.toHaveProperty('domains');
    expect(domainPick).not.toHaveProperty('domainId');
  });
});
