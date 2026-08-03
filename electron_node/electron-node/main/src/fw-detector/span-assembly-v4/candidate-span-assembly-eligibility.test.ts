import { describe, expect, it } from '@jest/globals';
import { isCandidateEligibleForSpanAssembly } from './candidate-span-assembly-eligibility';
import {
  assembleDomainAwareSpanSets,
  budgetPerSpanCandidates,
  buildFineSpanCandidatePoolFromCoarseSpansForTests,
  coarseSpansAsPathFineSpansForTests,
  filterDomainCandidatesPerSpan,
  selectPerSpanCandidates,
} from './assemble-domain-aware-span-sets';
import type { CoarseSpan } from '../span-assembly-shared/types';
import type { WindowCandidate } from './v4-types';
import { windowCandidateToDomainAwarePickResult } from './window-candidate-to-pick';

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
    windowId: '0:2',
    windowSource: 'in_span_window',
    anchorCoarseSpanId: 'c0',
    syllableStart: 0,
    syllableEnd: 2,
    rawStart: 0,
    rawEnd: 2,
    windowPinyinKey: 'di|zhi',
    candidateScore: 1,
    score: 1,
    boundaryPenalty: 1,
    candidateRank: 1,
    hitKind: 'exact_term',
    source: 'domain_term',
    recallSource: 'lexicon_pinyin_topk',
    repairTarget: true,
    domains: ['coffee'],
    termId: 't1',
    ...overrides,
  };
}

const fineSpan = {
  fineSpanId: 'fine:0:2',
  rawStart: 0,
  rawEnd: 2,
  syllableStart: 0,
  syllableEnd: 2,
};

describe('isCandidateEligibleForSpanAssembly', () => {
  it('exact_term full FineSpan coverage → eligible', () => {
    const c = makeCandidate({
      candidateId: 'ex1',
      replacement: '低脂',
      hitKind: 'exact_term',
      termId: 'term:1',
    });
    expect(isCandidateEligibleForSpanAssembly(c, fineSpan)).toEqual({ eligible: true });
  });

  it('exact_term partial coverage → rejected', () => {
    const c = makeCandidate({
      candidateId: 'ex2',
      replacement: '低',
      hitKind: 'exact_term',
      syllableStart: 0,
      syllableEnd: 1,
      rawStart: 0,
      rawEnd: 1,
    });
    expect(isCandidateEligibleForSpanAssembly(c, fineSpan)).toEqual({
      eligible: false,
      dropReason: 'DROP_INCOMPLETE_SPAN_COVERAGE',
    });
  });

  it('exact_term full coverage → eligible', () => {
    const c = makeCandidate({ candidateId: 'ex1', replacement: '地址', hitKind: 'exact_term' });
    expect(isCandidateEligibleForSpanAssembly(c, fineSpan).eligible).toBe(true);
  });

  it('covered candidate → rejected', () => {
    const c = makeCandidate({
      candidateId: 'cov',
      replacement: '低脂',
      isCovered: true,
      coveredBy: 'parent',
    });
    expect(isCandidateEligibleForSpanAssembly(c, fineSpan)).toEqual({
      eligible: false,
      dropReason: 'DROP_COVERED_CANDIDATE',
    });
  });

  it('range mismatch → rejected', () => {
    const c = makeCandidate({
      candidateId: 'mm',
      replacement: '别处',
      syllableStart: 2,
      syllableEnd: 4,
      rawStart: 2,
      rawEnd: 4,
    });
    expect(isCandidateEligibleForSpanAssembly(c, fineSpan)).toEqual({
      eligible: false,
      dropReason: 'DROP_RANGE_MISMATCH',
    });
  });

});

describe('windowCandidateToDomainAwarePickResult', () => {
  it('does not reject exact_term candidates based on hitKind alone', () => {
    const c = makeCandidate({
      candidateId: 'ex',
      replacement: '低脂',
      hitKind: 'exact_term',
    });
    const r = windowCandidateToDomainAwarePickResult(c, '地址xx', fineSpan);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pick.word).toBe('低脂');
      expect(r.pick.hitKind).toBe('exact_term');
    }
  });
});

describe('SameDomain multi-candidate budget', () => {
  const rawText = '地址医院';
  const coarseSpans = [makeCoarseSpan('c0', '地址', 0), makeCoarseSpan('c1', '医院', 2)];
  const pathFine = coarseSpansAsPathFineSpansForTests(coarseSpans);

  const voteRestaurant = {
    utteranceDomain: 'coffee',
    insufficientEvidence: false,
    domainScores: { coffee: 1, medical: 1 },
    domainVoteMs: 0,
    parentTermVoteCount: 0,
    winnerScore: 1,
    runnerUpDomain: 'medical',
    runnerUpScore: 1,
    voteMargin: 0,
    retainedDomains: ['coffee', 'medical'] as const,
    maxCount: 1,
    runnerUpCount: 1,
    isTie: true,
  };

  it('same-domain multiple candidates retained within cap', () => {
    const pool = buildFineSpanCandidatePoolFromCoarseSpansForTests(
      [
        makeCandidate({
          candidateId: 'a',
          replacement: '低脂',
          hitKind: 'exact_term',
          domains: ['coffee'],
          score: 2,
          termId: 'n1',
        }),
        makeCandidate({
          candidateId: 'b',
          replacement: '地质',
          hitKind: 'exact_term',
          domains: ['coffee'],
          score: 1.5,
          termId: 'n2',
        }),
      ],
      [coarseSpans[0]!]
    );
    // re-pool against full coarse for filter API
    const fullPool = buildFineSpanCandidatePoolFromCoarseSpansForTests(
      [
        makeCandidate({
          candidateId: 'a',
          replacement: '低脂',
          hitKind: 'exact_term',
          domains: ['coffee'],
          score: 2,
          termId: 'n1',
          anchorCoarseSpanId: 'c0',
        }),
        makeCandidate({
          candidateId: 'b',
          replacement: '地质',
          hitKind: 'exact_term',
          domains: ['coffee'],
          score: 1.5,
          termId: 'n2',
          anchorCoarseSpanId: 'c0',
        }),
        makeCandidate({
          candidateId: 'h',
          replacement: '医院',
          hitKind: 'exact_term',
          domains: ['medical'],
          score: 2,
          termId: 'n3',
          anchorCoarseSpanId: 'c1',
          rawStart: 2,
          rawEnd: 4,
          syllableStart: 2,
          syllableEnd: 4,
          windowId: '2:4',
        }),
      ],
      coarseSpans
    );
    expect(pool[0]?.candidates.length).toBeGreaterThan(0);
    const filtered = filterDomainCandidatesPerSpan(fullPool, voteRestaurant, rawText, 'coffee');
    expect(filtered[0]?.sameDomainCandidates.map((p) => p.word).sort()).toEqual(['低脂', '地质']);
    const budgeted = budgetPerSpanCandidates(
      filtered,
      coarseSpans.length,
      coarseSpans,
      pathFine,
      rawText
    );
    const surfaces = budgeted[0]?.selectedCandidates.map((p) => p.word) ?? [];
    expect(surfaces).toContain('低脂');
    expect(surfaces).toContain('地质');
    expect(surfaces).toContain('地址'); // canonical coexist
    expect(surfaces.length).toBeGreaterThan(1);
  });

  it('cross-domain candidate excluded from current bucket', () => {
    const fullPool = buildFineSpanCandidatePoolFromCoarseSpansForTests(
      [
        makeCandidate({
          candidateId: 'a',
          replacement: '低脂',
          hitKind: 'exact_term',
          domains: ['coffee'],
          termId: 'n1',
        }),
        makeCandidate({
          candidateId: 'h',
          replacement: '议员',
          hitKind: 'exact_term',
          domains: ['meeting'],
          termId: 'n2',
          anchorCoarseSpanId: 'c1',
          rawStart: 2,
          rawEnd: 4,
          syllableStart: 2,
          syllableEnd: 4,
          windowId: '2:4',
        }),
      ],
      coarseSpans
    );
    const filtered = filterDomainCandidatesPerSpan(fullPool, voteRestaurant, rawText, 'coffee');
    expect(filtered[0]?.sameDomainCandidates.map((p) => p.word)).toEqual(['低脂']);
    expect(filtered[1]?.sameDomainCandidates).toHaveLength(0);
  });

  it('canonical + recall coexist; same surface deduped for Assembly', () => {
    const fullPool = buildFineSpanCandidatePoolFromCoarseSpansForTests(
      [
        makeCandidate({
          candidateId: 'same',
          replacement: '地址',
          hitKind: 'exact_term',
          source: 'base_term',
          domains: undefined,
          score: 3,
          termId: 'base1',
        }),
      ],
      coarseSpans
    );
    const filtered = filterDomainCandidatesPerSpan(fullPool, voteRestaurant, rawText, 'coffee');
    const budgeted = selectPerSpanCandidates(
      filtered,
      coarseSpans.length,
      coarseSpans,
      pathFine,
      rawText
    );
    const words = budgeted[0]?.selectedCandidates.map((p) => p.word) ?? [];
    expect(words.filter((w) => w === '地址')).toHaveLength(1);
  });

  it('per-span cap >1 does not collapse to single winner when multi eligible', () => {
    const cands: WindowCandidate[] = [];
    for (let i = 0; i < 3; i++) {
      cands.push(
        makeCandidate({
          candidateId: `c${i}`,
          replacement: `词${i}`,
          hitKind: 'exact_term',
          domains: ['coffee'],
          score: 3 - i,
          termId: `n${i}`,
        })
      );
    }
    const fullPool = buildFineSpanCandidatePoolFromCoarseSpansForTests(cands, coarseSpans);
    const filtered = filterDomainCandidatesPerSpan(fullPool, voteRestaurant, rawText, 'coffee');
    const budgeted = budgetPerSpanCandidates(
      filtered,
      2,
      coarseSpans,
      pathFine,
      rawText
    );
    expect((budgeted[0]?.selectedCandidates.length ?? 0) > 1).toBe(true);
    const grid = assembleDomainAwareSpanSets(budgeted);
    expect(grid[0]!.length).toBeGreaterThan(1);
  });

  it('eligibility drop reasons are explicit (not windowCandidateToDomainAwarePick_null)', () => {
    const fullPool = buildFineSpanCandidatePoolFromCoarseSpansForTests(
      [
        makeCandidate({
          candidateId: 'partial',
          replacement: '低',
          hitKind: 'exact_term',
          syllableEnd: 1,
          rawEnd: 1,
          termId: 'n1',
        }),
      ],
      coarseSpans
    );
    const filtered = filterDomainCandidatesPerSpan(fullPool, voteRestaurant, rawText, 'coffee');
    const reasons = (filtered[0]?.assemblyDropTraces ?? []).map((d) => d.dropReason);
    expect(reasons).toContain('DROP_INCOMPLETE_SPAN_COVERAGE');
    expect(reasons.join(',')).not.toContain('windowCandidateToDomainAwarePick_null');
  });
});
