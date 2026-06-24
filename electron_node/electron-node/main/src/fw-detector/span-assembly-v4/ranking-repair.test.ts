import { describe, expect, it } from '@jest/globals';
import { applyToneAssemblyGuard } from './apply-tone-assembly-guard';
import { filterDomainCandidatesPerSpan } from './filter-domain-candidates-per-span';
import type { DomainAwareSpanReplacementPick, DomainFilteredSpanSet } from './domain-assembly-types';

function makePick(
  overrides: Partial<DomainAwareSpanReplacementPick> & Pick<DomainAwareSpanReplacementPick, 'candidateId' | 'word'>
): DomainAwareSpanReplacementPick {
  return {
    span: { text: '烧病', start: 0, end: 2 },
    graphSource: 'base_term',
    hitKind: 'exact_term',
    score: 1,
    repairTarget: true,
    recallSource: 'lexicon_pinyin_topk',
    ...overrides,
  };
}

describe('filterDomainCandidatesPerSpan (GATE-RANK-01)', () => {
  it('places base_term in baseCandidates', () => {
    const ranked = [
      {
        coarseSpanId: 'c0',
        rawRange: [0, 2] as [number, number],
        syllableRange: [0, 2] as [number, number],
        rankedCandidates: [
          makePick({ candidateId: 'b1', word: '烧饼', graphSource: 'base_term' }),
          makePick({
            candidateId: 'd1',
            word: '少冰',
            graphSource: 'domain_term',
            domainId: 'coffee',
            matchedDomain: 'coffee',
          }),
        ],
      },
    ];
    const vote = {
      utteranceDomain: 'coffee',
      insufficientEvidence: false,
      domainScores: { coffee: 2 },
      domainVoteMs: 0,
      parentTermVoteCount: 0,
    };
    const filtered = filterDomainCandidatesPerSpan(ranked, vote);
    expect(filtered[0]?.baseCandidates.map((p) => p.word)).toEqual(['烧饼']);
    expect(filtered[0]?.sameDomainCandidates.map((p) => p.word)).toEqual(['少冰']);
  });
});

describe('applyToneAssemblyGuard (GATE-RANK-04)', () => {
  it('blocks base tone mismatch when sameDomain tone match exists', () => {
    const set: DomainFilteredSpanSet = {
      coarseSpanId: 'c0',
      rawRange: [0, 2],
      syllableRange: [0, 2],
      sameDomainCandidates: [
        makePick({
          candidateId: 'd1',
          word: '少冰',
          graphSource: 'domain_term',
          toneReason: 'match',
        }),
      ],
      baseCandidates: [
        makePick({ candidateId: 'b1', word: '烧饼', toneReason: 'mismatch' }),
      ],
      fallbackCandidates: [],
      selectedCandidates: [],
    };
    const result = applyToneAssemblyGuard([set]);
    expect(result.blockedCount).toBe(1);
    expect(result.filteredSets[0]?.baseCandidates).toHaveLength(0);
    expect(result.blockTraces[0]?.blockedBy).toBe('ToneGuard');
  });

  it('does not block base when no sameDomain tone match', () => {
    const set: DomainFilteredSpanSet = {
      coarseSpanId: 'c0',
      rawRange: [0, 2],
      syllableRange: [0, 2],
      sameDomainCandidates: [
        makePick({
          candidateId: 'd1',
          word: '少冰',
          graphSource: 'domain_term',
          toneReason: 'mismatch',
        }),
      ],
      baseCandidates: [
        makePick({ candidateId: 'b1', word: '烧饼', toneReason: 'mismatch' }),
      ],
      fallbackCandidates: [],
      selectedCandidates: [],
    };
    const result = applyToneAssemblyGuard([set]);
    expect(result.blockedCount).toBe(0);
    expect(result.filteredSets[0]?.baseCandidates).toHaveLength(1);
  });
});
