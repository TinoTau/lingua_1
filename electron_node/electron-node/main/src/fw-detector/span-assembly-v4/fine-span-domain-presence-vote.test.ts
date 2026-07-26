import { describe, expect, it } from '@jest/globals';
import {
  DOMAIN_BUCKET_RETENTION_RATIO,
  allocateDomainBucketSentenceBudget,
  buildFineSpanDomainSet,
  voteUtteranceDomainFromPool,
  type FineSpanPoolForVote,
  type PoolVoteCandidate,
} from '../span-assembly-shared/utterance-domain-vote';
import {
  coarseSpansAsFormalFineSpansForTests,
  runDomainAwareAssembly,
} from './assemble-domain-aware-span-sets';
import { buildSentenceCandidates, mergeCrossBucketSentenceCandidates } from '../build-sentence-candidates';
import type { CoarseSpan } from '../span-assembly-shared/types';
import type { WindowCandidate } from './v4-types';

function cand(partial: Partial<PoolVoteCandidate> & Pick<PoolVoteCandidate, 'source'>): PoolVoteCandidate {
  return {
    candidateId: partial.candidateId ?? `id-${Math.random().toString(36).slice(2, 8)}`,
    hitKind: partial.hitKind ?? 'exact_term',
    score: partial.score ?? 1,
    syllableStart: partial.syllableStart ?? 0,
    syllableEnd: partial.syllableEnd ?? 2,
    domains: partial.domains,
    parentTermId: partial.parentTermId,
    isCovered: partial.isCovered,
    source: partial.source,
  };
}

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
  overrides: Partial<WindowCandidate> & Pick<WindowCandidate, 'candidateId' | 'replacement' | 'anchorCoarseSpanId'>
): WindowCandidate {
  return {
    windowId: 'w0',
    windowSource: 'in_span_window',
    syllableStart: 0,
    syllableEnd: 2,
    rawStart: 0,
    rawEnd: 2,
    windowPinyinKey: 'x|y',
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

describe('Fine-span domain presence vote', () => {
  it('uses DOMAIN_BUCKET_RETENTION_RATIO = 0.75 as single SSOT', () => {
    expect(DOMAIN_BUCKET_RETENTION_RATIO).toBe(0.75);
  });

  it('17.7 same span multi-candidate same domain → one vote; candidates preserved', () => {
    const pool: FineSpanPoolForVote[] = [
      {
        candidates: [
          cand({ candidateId: 'a', source: 'domain_term', domains: ['milk_tea'] }),
          cand({ candidateId: 'b', source: 'domain_term', domains: ['milk_tea'] }),
          cand({ candidateId: 'c', source: 'domain_term', domains: ['milk_tea'] }),
        ],
      },
    ];
    const set = buildFineSpanDomainSet(pool[0].candidates);
    expect([...set]).toEqual(['milk_tea']);
    const vote = voteUtteranceDomainFromPool(pool);
    expect(vote.domainScores.milk_tea).toBe(1);
  });

  it('17.8 three spans same domain → count 3', () => {
    const pool: FineSpanPoolForVote[] = [
      { candidates: [cand({ candidateId: 's1', source: 'domain_term', domains: ['milk_tea'] })] },
      { candidates: [cand({ candidateId: 's2', source: 'domain_term', domains: ['milk_tea'] })] },
      { candidates: [cand({ candidateId: 's3', source: 'domain_term', domains: ['milk_tea'] })] },
    ];
    expect(voteUtteranceDomainFromPool(pool).domainScores.milk_tea).toBe(3);
  });

  it('17.9 multi-domain candidate contributes one presence per domain in FineSpanDomainSet', () => {
    const pool: FineSpanPoolForVote[] = [
      {
        candidates: [
          cand({
            candidateId: 'm',
            source: 'domain_term',
            domains: ['coffee', 'milk_tea', 'food_order'],
          }),
        ],
      },
    ];
    const set = buildFineSpanDomainSet(pool[0].candidates);
    expect(set.size).toBe(3);
    const vote = voteUtteranceDomainFromPool(pool);
    expect(vote.domainScores.coffee).toBe(1);
    expect(vote.domainScores.milk_tea).toBe(1);
    expect(vote.domainScores.food_order).toBe(1);
    expect(vote.isTie).toBe(true);
    expect(vote.retainedDomains.sort()).toEqual(['coffee', 'food_order', 'milk_tea']);
  });

  it('17.5 single fine span three domains → three tied buckets', () => {
    const pool: FineSpanPoolForVote[] = [
      {
        candidates: [
          cand({ candidateId: 'a', source: 'domain_term', domains: ['coffee'] }),
          cand({ candidateId: 'b', source: 'domain_term', domains: ['milk_tea'] }),
          cand({ candidateId: 'c', source: 'domain_term', domains: ['food_order'] }),
        ],
      },
      { candidates: [cand({ candidateId: 'base', source: 'base_term' })] },
    ];
    const vote = voteUtteranceDomainFromPool(pool);
    expect(vote.domainScores).toEqual({ coffee: 1, milk_tea: 1, food_order: 1 });
    expect(vote.retainedDomains).toHaveLength(3);
    expect(vote.isTie).toBe(true);
  });

  it('17.6 no domain evidence → base-only (insufficientEvidence)', () => {
    const pool: FineSpanPoolForVote[] = [
      { candidates: [cand({ candidateId: 'b1', source: 'base_term' })] },
      { candidates: [cand({ candidateId: 'b2', source: 'base_term' })] },
    ];
    const vote = voteUtteranceDomainFromPool(pool);
    expect(vote.insufficientEvidence).toBe(true);
    expect(vote.retainedDomains).toEqual([]);
    expect(vote.utteranceDomain).toBe('general');
  });

  it('17.2 tied maximum → all max buckets retained (no localeCompare winner)', () => {
    const pool: FineSpanPoolForVote[] = [
      { candidates: [cand({ candidateId: 'a', source: 'domain_term', domains: ['tourism_pickup'] })] },
      { candidates: [cand({ candidateId: 'b', source: 'domain_term', domains: ['tourism_transport'] })] },
      { candidates: [cand({ candidateId: 'c', source: 'domain_term', domains: ['tourism_pickup'] })] },
      { candidates: [cand({ candidateId: 'd', source: 'domain_term', domains: ['tourism_transport'] })] },
      { candidates: [cand({ candidateId: 'e', source: 'domain_term', domains: ['transport'] })] },
    ];
    const vote = voteUtteranceDomainFromPool(pool);
    expect(vote.domainScores.tourism_pickup).toBe(2);
    expect(vote.domainScores.tourism_transport).toBe(2);
    expect(vote.domainScores.transport).toBe(1);
    expect(vote.retainedDomains.sort()).toEqual(['tourism_pickup', 'tourism_transport']);
    expect(vote.isTie).toBe(true);
  });

  it('17.3 insufficient margin 4 vs 3 → retain both at 0.75', () => {
    const pool: FineSpanPoolForVote[] = [
      { candidates: [cand({ candidateId: '1', source: 'domain_term', domains: ['tourism_transport'] })] },
      { candidates: [cand({ candidateId: '2', source: 'domain_term', domains: ['tourism_transport'] })] },
      { candidates: [cand({ candidateId: '3', source: 'domain_term', domains: ['tourism_transport'] })] },
      { candidates: [cand({ candidateId: '4', source: 'domain_term', domains: ['tourism_transport'] })] },
      { candidates: [cand({ candidateId: '5', source: 'domain_term', domains: ['tourism_pickup'] })] },
      { candidates: [cand({ candidateId: '6', source: 'domain_term', domains: ['tourism_pickup'] })] },
      { candidates: [cand({ candidateId: '7', source: 'domain_term', domains: ['tourism_pickup'] })] },
      { candidates: [cand({ candidateId: '8', source: 'domain_term', domains: ['transport'] })] },
    ];
    const vote = voteUtteranceDomainFromPool(pool);
    expect(vote.maxCount).toBe(4);
    expect(vote.runnerUpCount).toBe(3);
    expect(vote.retainedDomains).toEqual(['tourism_transport', 'tourism_pickup']);
    expect(vote.retainedDomains).not.toContain('transport');
  });

  it('17.4 clear lead 4 vs 2 → single bucket', () => {
    const pool: FineSpanPoolForVote[] = [
      { candidates: [cand({ candidateId: '1', source: 'domain_term', domains: ['milk_tea'] })] },
      { candidates: [cand({ candidateId: '2', source: 'domain_term', domains: ['milk_tea'] })] },
      { candidates: [cand({ candidateId: '3', source: 'domain_term', domains: ['milk_tea'] })] },
      { candidates: [cand({ candidateId: '4', source: 'domain_term', domains: ['milk_tea'] })] },
      { candidates: [cand({ candidateId: '5', source: 'domain_term', domains: ['coffee'] })] },
      { candidates: [cand({ candidateId: '6', source: 'domain_term', domains: ['coffee'] })] },
    ];
    const vote = voteUtteranceDomainFromPool(pool);
    expect(vote.retainedDomains).toEqual(['milk_tea']);
    expect(vote.isTie).toBe(false);
  });

  it('base does not participate in domain vote', () => {
    const pool: FineSpanPoolForVote[] = [
      {
        candidates: [
          cand({ candidateId: 'd', source: 'domain_term', domains: ['coffee'] }),
          cand({ candidateId: 'b', source: 'base_term', domains: ['coffee'] }),
        ],
      },
    ];
    expect(voteUtteranceDomainFromPool(pool).domainScores.coffee).toBe(1);
  });

  it('excludes general / empty / covered', () => {
    const pool: FineSpanPoolForVote[] = [
      {
        candidates: [
          cand({ candidateId: 'g', source: 'domain_term', domains: ['general'] }),
          cand({ candidateId: 'e', source: 'domain_term', domains: [] }),
          cand({ candidateId: 'c', source: 'domain_term', domains: ['coffee'], isCovered: true }),
          cand({ candidateId: 'ok', source: 'domain_term', domains: ['milk_tea'] }),
        ],
      },
    ];
    const vote = voteUtteranceDomainFromPool(pool);
    expect(vote.domainScores).toEqual({ milk_tea: 1 });
  });
});

describe('Multi-bucket assembly + KenLM budget', () => {
  it('17.1 unique clear winner → single bucket', () => {
    const spans = [
      makeSpan('c0', '少糖', 0),
      makeSpan('c1', '中杯', 2),
      makeSpan('c2', '奶茶', 4),
    ];
    const result = runDomainAwareAssembly(
      [
        wc({
          candidateId: 'a',
          replacement: '少糖',
          anchorCoarseSpanId: 'c0',
          domains: ['milk_tea'],
          rawStart: 0,
          rawEnd: 2,
        }),
        wc({
          candidateId: 'b',
          replacement: '中杯',
          anchorCoarseSpanId: 'c1',
          domains: ['milk_tea', 'coffee'],
          rawStart: 2,
          rawEnd: 4,
          syllableStart: 2,
          syllableEnd: 4,
        }),
        wc({
          candidateId: 'c',
          replacement: '奶茶',
          anchorCoarseSpanId: 'c2',
          domains: ['milk_tea'],
          rawStart: 4,
          rawEnd: 6,
          syllableStart: 4,
          syllableEnd: 6,
        }),
        wc({
          candidateId: 'd',
          replacement: '拿铁',
          anchorCoarseSpanId: 'c2',
          domains: ['coffee'],
          rawStart: 4,
          rawEnd: 6,
          syllableStart: 4,
          syllableEnd: 6,
          score: 0.5,
        }),
      ],
      spans,
      '少糖中杯奶茶',
      coarseSpansAsFormalFineSpansForTests(spans)
    );
    expect(result.vote.retainedDomains).toEqual(['milk_tea']);
    expect(result.bucketSpanSets).toHaveLength(1);
  });

  it('tied domains produce multiple buckets; total sentence candidates ≤16', () => {
    const spans = [makeSpan('c0', '接送', 0), makeSpan('c1', '机场', 2)];
    const result = runDomainAwareAssembly(
      [
        wc({
          candidateId: 'a',
          replacement: '接送',
          anchorCoarseSpanId: 'c0',
          domains: ['tourism_pickup'],
          rawStart: 0,
          rawEnd: 2,
        }),
        wc({
          candidateId: 'b',
          replacement: '机场',
          anchorCoarseSpanId: 'c1',
          domains: ['tourism_transport'],
          rawStart: 2,
          rawEnd: 4,
          syllableStart: 2,
          syllableEnd: 4,
        }),
      ],
      spans,
      '接送机场',
      coarseSpansAsFormalFineSpansForTests(spans)
    );
    expect(result.vote.isTie).toBe(true);
    expect(result.bucketSpanSets.length).toBe(2);
    allocateDomainBucketSentenceBudget(result.bucketSpanSets.length, 16);
    const perBucketGenerated = result.bucketSpanSets.map((sets) =>
      buildSentenceCandidates('接送机场', sets, 16).combinations
    );
    const merged = mergeCrossBucketSentenceCandidates(perBucketGenerated, 16);
    expect(merged.combinations.length).toBeLessThanOrEqual(16);
  });

  it('cross-bucket dedup before final cap: duplicate texts do not waste other buckets', () => {
    const shared = {
      text: '共享句',
      replacements: [] as import('../build-sentence-candidates').SpanReplacementPick[],
      candidateScore: 1,
    };
    const uniqueHigh = { text: '正确句', replacements: [], candidateScore: 5 };
    const uniqueNoise = { text: '噪声句', replacements: [], candidateScore: 0.1 };
    // Bucket A: shared (high) + low noise; Bucket B: shared (lower) + correct (mid-high)
    // After dedup, shared keeps score 10; global cap=2 keeps 共享句 + 正确句
    const merged = mergeCrossBucketSentenceCandidates(
      [
        [
          { ...shared, candidateScore: 10 },
          uniqueNoise,
        ],
        [
          { ...shared, candidateScore: 2 },
          uniqueHigh,
        ],
      ],
      2
    );
    const texts = merged.combinations.map((c) => c.text);
    expect(texts).toContain('正确句');
    expect(texts).toContain('共享句');
    expect(texts).not.toContain('噪声句');
    expect(merged.combinations).toHaveLength(2);
    expect(merged.mergedBeforeCap.find((c) => c.text === '共享句')?.candidateScore).toBe(10);
  });

  it('merge order does not change final text set', () => {
    const a = { text: 'A', replacements: [], candidateScore: 3 };
    const b = { text: 'B', replacements: [], candidateScore: 2 };
    const c = { text: 'C', replacements: [], candidateScore: 1 };
    const forward = mergeCrossBucketSentenceCandidates([[a, b], [c, a]], 16);
    const reverse = mergeCrossBucketSentenceCandidates([[c, a], [a, b]], 16);
    expect(forward.combinations.map((x) => x.text).sort()).toEqual(
      reverse.combinations.map((x) => x.text).sort()
    );
  });

  it('base-only assembly when no domain evidence', () => {
    const spans = [makeSpan('c0', '你好', 0)];
    const result = runDomainAwareAssembly(
      [
        wc({
          candidateId: 'b',
          replacement: '你好',
          anchorCoarseSpanId: 'c0',
          source: 'base_term',
          domains: undefined,
        }),
      ],
      spans,
      '你好',
      coarseSpansAsFormalFineSpansForTests(spans)
    );
    expect(result.vote.insufficientEvidence).toBe(true);
    expect(result.bucketSpanSets).toHaveLength(1);
  });

  it('multi-domain candidate appears in multiple buckets without recall fan-out', () => {
    const spans = [makeSpan('c0', '少糖', 0)];
    const multi = wc({
      candidateId: 'one',
      replacement: '少糖',
      anchorCoarseSpanId: 'c0',
      domains: ['coffee', 'milk_tea', 'food_order'],
    });
    const result = runDomainAwareAssembly(
      [multi],
      spans,
      '少糖',
      coarseSpansAsFormalFineSpansForTests(spans)
    );
    expect(result.bucketSpanSets).toHaveLength(3);
    for (const sets of result.bucketSpanSets) {
      expect(sets[0]?.some((p) => p.word === '少糖')).toBe(true);
    }
  });

  it('budget allocator blocks silent drop when buckets > maxSentenceCandidates', () => {
    expect(() => allocateDomainBucketSentenceBudget(17, 16)).toThrow(
      /FINE-SPAN DOMAIN PRESENCE VOTE REPAIR BLOCKED/
    );
  });
});
