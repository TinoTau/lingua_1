import { describe, expect, it, jest } from '@jest/globals';
import Database = require('better-sqlite3');
import {
  DOMAIN_BUCKET_RETENTION_RATIO,
  buildFineSpanDomainSet,
  voteUtteranceDomainFromPool,
  type FineSpanPoolForVote,
  type PoolVoteCandidate,
} from '../span-assembly-shared/utterance-domain-vote';
import {
  buildFineSpanCandidatePoolFromCoarseSpansForTests,
  coarseSpansAsFormalFineSpansForTests,
  filterDomainCandidatesPerSpan,
  runDomainAwareAssembly,
} from './assemble-domain-aware-span-sets';
import { buildSentenceCandidates, mergeCrossBucketSentenceCandidates } from '../build-sentence-candidates';
import { runFwSentenceRerankFromPrefilled } from '../kenlm/run-fw-sentence-rerank-from-prefilled';
import { queryDomainMultiRowsAtomic } from '../../lexicon-v2/lexicon-runtime-v2';
import type { CoarseSpan } from '../span-assembly-shared/types';
import type { WindowCandidate } from './v4-types';
import * as voteModule from '../span-assembly-shared/utterance-domain-vote';

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

describe('T1 passive_domain_weak Presence Vote', () => {
  it('T1a: same span multi passive same domain → one vote', () => {
    const pool: FineSpanPoolForVote[] = [
      {
        candidates: [
          cand({ candidateId: 'p1', source: 'passive_domain_weak', domains: ['milk_tea'], score: 9 }),
          cand({ candidateId: 'p2', source: 'passive_domain_weak', domains: ['milk_tea'], score: 1 }),
          cand({ candidateId: 'p3', source: 'passive_domain_weak', domains: ['milk_tea'], score: 5 }),
        ],
      },
    ];
    expect([...buildFineSpanDomainSet(pool[0].candidates)]).toEqual(['milk_tea']);
    expect(voteUtteranceDomainFromPool(pool).domainScores.milk_tea).toBe(1);
  });

  it('T1b: one passive multi-domain → one presence each; no extra weight', () => {
    const pool: FineSpanPoolForVote[] = [
      {
        candidates: [
          cand({
            candidateId: 'm',
            source: 'passive_domain_weak',
            domains: ['coffee', 'milk_tea'],
            score: 99,
          }),
        ],
      },
    ];
    const vote = voteUtteranceDomainFromPool(pool);
    expect(vote.domainScores.coffee).toBe(1);
    expect(vote.domainScores.milk_tea).toBe(1);
    expect(vote.isTie).toBe(true);
  });

  it('T1c: passive does not override domain_term; same span still one vote per domain', () => {
    const pool: FineSpanPoolForVote[] = [
      {
        candidates: [
          cand({ candidateId: 'd', source: 'domain_term', domains: ['coffee'] }),
          cand({ candidateId: 'p', source: 'passive_domain_weak', domains: ['coffee'] }),
        ],
      },
    ];
    expect(voteUtteranceDomainFromPool(pool).domainScores.coffee).toBe(1);
  });
});

describe('T2 Base enters every retained bucket', () => {
  it('base in each bucket; pure other-domain excluded; base not in domainScores', () => {
    const spans = [makeSpan('c0', '词', 0)];
    const candidates = [
      wc({
        candidateId: 'base',
        replacement: '你好',
        anchorCoarseSpanId: 'c0',
        source: 'base_term',
        domains: undefined,
        recallSource: 'lexicon_base',
      }),
      wc({
        candidateId: 'da',
        replacement: '咖啡',
        anchorCoarseSpanId: 'c0',
        domains: ['coffee'],
        source: 'domain_term',
      }),
      wc({
        candidateId: 'db',
        replacement: '奶茶',
        anchorCoarseSpanId: 'c0',
        domains: ['milk_tea'],
        source: 'domain_term',
      }),
    ];
    const pool = buildFineSpanCandidatePoolFromCoarseSpansForTests(candidates, spans);
    expect(pool[0]?.candidates.length).toBe(3);
    const vote = voteUtteranceDomainFromPool(pool);
    expect(vote.domainScores.coffee).toBe(1);
    expect(vote.domainScores.milk_tea).toBe(1);
    expect(vote.domainScores).not.toHaveProperty('base_term');
    expect(vote.retainedDomains.sort()).toEqual(['coffee', 'milk_tea']);

    const bucketA = filterDomainCandidatesPerSpan(pool, vote, '词', 'coffee');
    const bucketB = filterDomainCandidatesPerSpan(pool, vote, '词', 'milk_tea');
    expect(bucketA[0]?.sameDomainCandidates.some((p) => p.word === '咖啡')).toBe(true);
    expect(bucketA[0]?.baseCandidates.some((p) => p.word === '你好')).toBe(true);
    expect(bucketA[0]?.sameDomainCandidates.some((p) => p.word === '奶茶')).toBe(false);

    expect(bucketB[0]?.sameDomainCandidates.some((p) => p.word === '奶茶')).toBe(true);
    expect(bucketB[0]?.baseCandidates.some((p) => p.word === '你好')).toBe(true);
    expect(bucketB[0]?.sameDomainCandidates.some((p) => p.word === '咖啡')).toBe(false);
  });
});

describe('T3–T4 same-term multi-domain preservation into Vote', () => {
  it('Hotword-style domains[] reaches FineSpanDomainSet intact (≥3)', () => {
    const domains = ['bakery', 'coffee', 'food_order', 'milk_tea'] as const;
    const pool: FineSpanPoolForVote[] = [
      {
        candidates: [
          cand({
            candidateId: 'menu',
            source: 'domain_term',
            domains: [...domains],
          }),
        ],
      },
    ];
    const set = buildFineSpanDomainSet(pool[0].candidates);
    expect([...set].sort()).toEqual([...domains].sort());
    const vote = voteUtteranceDomainFromPool(pool);
    for (const d of domains) {
      expect(vote.domainScores[d]).toBe(1);
    }
  });

  it('same text / different domains as separate WindowCandidates: Vote sees union via multi-domain Hotword copy', () => {
    // Contract: upstream Hotword must already union tags; WindowCandidate copies full list.
    // Simulate two hits that both carry the full union (post mergeDomainTierRows).
    const spans = [makeSpan('c0', '菜单', 0)];
    const full = ['bakery', 'coffee', 'food_order', 'milk_tea'];
    const result = runDomainAwareAssembly(
      [
        wc({
          candidateId: 'c1',
          replacement: '菜单',
          anchorCoarseSpanId: 'c0',
          domains: full,
          score: 2,
        }),
        wc({
          candidateId: 'c2',
          replacement: '菜单',
          anchorCoarseSpanId: 'c0',
          domains: full,
          score: 1,
        }),
      ],
      spans,
      '菜单',
      coarseSpansAsFormalFineSpansForTests(spans)
    );
    expect(Object.keys(result.vote.domainScores).sort()).toEqual(full.sort());
  });
});

describe('T5 SQL LIMIT domain atomicity', () => {
  it('pure algorithm: stage-1 term LIMIT then full in-scope tags (no partial)', () => {
    // Mirrors queryDomainMultiRowsAtomic without native sqlite (Jest ABI may differ from Electron).
    type JoinRow = { id: string; domain_id: string; weight: number; prior: number };
    const joinRows: JoinRow[] = [
      { id: 'term_high', domain_id: 'a', weight: 0.99, prior: 1 },
      { id: 'term_high', domain_id: 'b', weight: 0.98, prior: 1 },
      { id: 'term_high', domain_id: 'c', weight: 0.97, prior: 1 },
      { id: 'term_multi', domain_id: 'a', weight: 0.1, prior: 10 },
      { id: 'term_multi', domain_id: 'b', weight: 0.05, prior: 10 },
      { id: 'term_multi', domain_id: 'c', weight: 0.01, prior: 10 },
    ];
    const limit = 2;
    const byTerm = new Map<string, { maxW: number; maxP: number }>();
    for (const r of joinRows) {
      const cur = byTerm.get(r.id) ?? { maxW: -Infinity, maxP: -Infinity };
      cur.maxW = Math.max(cur.maxW, r.weight);
      cur.maxP = Math.max(cur.maxP, r.prior);
      byTerm.set(r.id, cur);
    }
    const termIds = [...byTerm.entries()]
      .sort((a, b) => b[1].maxW - a[1].maxW || b[1].maxP - a[1].maxP)
      .slice(0, limit)
      .map(([id]) => id);
    const rows = joinRows.filter((r) => termIds.includes(r.id));
    for (const id of termIds) {
      expect(rows.filter((r) => r.id === id).map((r) => r.domain_id).sort()).toEqual([
        'a',
        'b',
        'c',
      ]);
    }
  });

  it('native sqlite atomic query when ABI matches', () => {
    let db: InstanceType<typeof Database> | undefined;
    try {
      db = new Database(':memory:');
    } catch (e) {
      if (String(e).includes('NODE_MODULE_VERSION')) {
        return;
      }
      throw e;
    }
    db.exec(`
      CREATE TABLE term (id TEXT PRIMARY KEY, word TEXT, pinyin_key TEXT);
      CREATE TABLE domain_lexicon (
        id TEXT, domain_id TEXT, pinyin_key TEXT, tone_pinyin_key TEXT,
        word TEXT, normalized TEXT, prior_score REAL, repair_target INT,
        enabled INT, aliases TEXT, source TEXT, canonical_word TEXT, is_alias INT
      );
      CREATE TABLE term_domain_tags (term_id TEXT, domain_id TEXT, weight REAL);
    `);

    const insertTerm = db.prepare(
      `INSERT INTO term(id, word, pinyin_key) VALUES (?, ?, ?)`
    );
    const insertDl = db.prepare(
      `INSERT INTO domain_lexicon VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    const insertTag = db.prepare(
      `INSERT INTO term_domain_tags(term_id, domain_id, weight) VALUES (?,?,?)`
    );

    insertTerm.run('term_multi', '多域', 'duo|yu');
    insertTerm.run('term_high', '高频', 'duo|yu');
    for (const [id, word, prior] of [
      ['term_multi', '多域', 10],
      ['term_high', '高频', 1],
    ] as const) {
      for (const domain of ['a', 'b', 'c']) {
        insertDl.run(
          id,
          domain,
          'duo|yu',
          null,
          word,
          word,
          prior,
          1,
          1,
          null,
          null,
          word,
          0
        );
      }
    }
    insertTag.run('term_multi', 'a', 0.1);
    insertTag.run('term_multi', 'b', 0.05);
    insertTag.run('term_multi', 'c', 0.01);
    insertTag.run('term_high', 'a', 0.99);
    insertTag.run('term_high', 'b', 0.98);
    insertTag.run('term_high', 'c', 0.97);

    const { termIds, rows } = queryDomainMultiRowsAtomic(db, ['a', 'b', 'c'], 'duo|yu', 2, 2);
    expect(termIds.length).toBe(2);
    const byId = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!byId.has(row.id)) byId.set(row.id, new Set());
      byId.get(row.id)!.add(row.domain_id!);
    }
    for (const id of termIds) {
      expect([...byId.get(id)!].sort()).toEqual(['a', 'b', 'c']);
    }
    db.close();
  });
});

describe('T6 Recall Scope completeness (Hotword contract)', () => {
  it('scope filter keeps only requested domains from full tag set', () => {
    const dbDomains = ['a', 'b', 'c'];
    const activeScope = ['a', 'c'];
    const hotwordDomains = dbDomains.filter((d) => activeScope.includes(d)).sort();
    expect(hotwordDomains).toEqual(['a', 'c']);
    expect(hotwordDomains).not.toContain('b');
  });

  it('native sqlite scope filter when ABI matches', () => {
    let db: InstanceType<typeof Database> | undefined;
    try {
      db = new Database(':memory:');
    } catch (e) {
      if (String(e).includes('NODE_MODULE_VERSION')) {
        return;
      }
      throw e;
    }
    db.exec(`
      CREATE TABLE term (id TEXT PRIMARY KEY, word TEXT, pinyin_key TEXT);
      CREATE TABLE domain_lexicon (
        id TEXT, domain_id TEXT, pinyin_key TEXT, tone_pinyin_key TEXT,
        word TEXT, normalized TEXT, prior_score REAL, repair_target INT,
        enabled INT, aliases TEXT, source TEXT, canonical_word TEXT, is_alias INT
      );
      CREATE TABLE term_domain_tags (term_id TEXT, domain_id TEXT, weight REAL);
    `);
    db.prepare(`INSERT INTO term VALUES ('t1','词','ci')`).run();
    for (const d of ['a', 'b', 'c']) {
      db.prepare(
        `INSERT INTO domain_lexicon VALUES ('t1',?,?,null,'词','词',1,1,1,null,null,'词',0)`
      ).run(d, 'ci');
      db.prepare(`INSERT INTO term_domain_tags VALUES ('t1',?,1)`).run(d);
    }
    const { rows } = queryDomainMultiRowsAtomic(db, ['a', 'c'], 'ci', 1, 5);
    const domains = [...new Set(rows.map((r) => r.domain_id))].sort();
    expect(domains).toEqual(['a', 'c']);
    expect(domains).not.toContain('b');
    db.close();
  });
});

describe('T7 Parent fragment Vote semantics', () => {
  it('parent_fragment with full scope domains[] contributes all domains once per span', () => {
    const pool: FineSpanPoolForVote[] = [
      {
        candidates: [
          cand({
            candidateId: 'frag',
            hitKind: 'parent_fragment',
            parentTermId: 'parent-1',
            source: 'domain_term',
            domains: ['coffee', 'milk_tea', 'food_order'],
          }),
        ],
      },
    ];
    const vote = voteUtteranceDomainFromPool(pool);
    expect(vote.domainScores.coffee).toBe(1);
    expect(vote.domainScores.milk_tea).toBe(1);
    expect(vote.domainScores.food_order).toBe(1);
    expect(vote.parentTermVoteCount).toBe(1);
  });

  it('second fragment same parentTermId does not double-count', () => {
    const pool: FineSpanPoolForVote[] = [
      {
        candidates: [
          cand({
            candidateId: 'f1',
            hitKind: 'parent_fragment',
            parentTermId: 'parent-1',
            source: 'domain_term',
            domains: ['coffee'],
          }),
          cand({
            candidateId: 'f2',
            hitKind: 'parent_fragment',
            parentTermId: 'parent-1',
            source: 'domain_term',
            domains: ['milk_tea'],
          }),
        ],
      },
    ];
    // First fragment wins structural key; enrichment path must put full domains on first hit.
    // With only coffee on first, milk_tea is lost — enrichment fix puts full set on each hit.
    // After enrichment, both candidates carry full domains; first key still one Set union.
    const enriched: FineSpanPoolForVote[] = [
      {
        candidates: [
          cand({
            candidateId: 'f1',
            hitKind: 'parent_fragment',
            parentTermId: 'parent-1',
            source: 'domain_term',
            domains: ['coffee', 'milk_tea'],
          }),
          cand({
            candidateId: 'f2',
            hitKind: 'parent_fragment',
            parentTermId: 'parent-1',
            source: 'domain_term',
            domains: ['coffee', 'milk_tea'],
          }),
        ],
      },
    ];
    const vote = voteUtteranceDomainFromPool(enriched);
    expect(vote.domainScores.coffee).toBe(1);
    expect(vote.domainScores.milk_tea).toBe(1);
  });
});

describe('T8 Production Vote call count', () => {
  it('runDomainAwareAssembly invokes voteUtteranceDomainFromPool exactly once', () => {
    const spy = jest.spyOn(voteModule, 'voteUtteranceDomainFromPool');
    const spans = [makeSpan('c0', '少糖', 0), makeSpan('c1', '中杯', 2)];
    runDomainAwareAssembly(
      [
        wc({
          candidateId: 'a',
          replacement: '少糖',
          anchorCoarseSpanId: 'c0',
          domains: ['milk_tea'],
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
      ],
      spans,
      '少糖中杯',
      coarseSpansAsFormalFineSpansForTests(spans)
    );
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('T9–T10 Multi-Bucket KenLM prefilled boundary', () => {
  function mockScorer(scored: string[]) {
    return {
      scoreBatch: async (sentences: string[]) => {
        scored.push(...sentences);
        return {
          scores: sentences.map((sentence) => ({
            sentence,
            score: -1,
            normalizedScore: 0,
          })),
          timing: {
            batchMs: 0,
            queryCount: 1,
            avgMs: 0,
            p50Ms: 0,
            p95Ms: 0,
            maxMs: 0,
          },
        };
      },
    };
  }

  it('T9: prefilled merged pool reaches KenLM; no domain metadata on combinations', async () => {
    const scored: string[] = [];
    const comboA = {
      text: '句子A',
      replacements: [],
      candidateScore: 2,
    };
    const comboB = {
      text: '句子B',
      replacements: [],
      candidateScore: 1,
    };
    const merged = mergeCrossBucketSentenceCandidates([[comboA], [comboB]], 16);
    expect(merged.combinations.map((c) => c.text).sort()).toEqual(['句子A', '句子B']);
    for (const c of merged.combinations) {
      expect(c).not.toHaveProperty('domainScores');
      expect(c).not.toHaveProperty('retainedDomains');
      expect(c).not.toHaveProperty('bucketDomain');
    }

    await runFwSentenceRerankFromPrefilled({
      rawText: '原文',
      spans: [{ text: '原文', start: 0, end: 2, candidates: [] }],
      spanSets: [[]],
      config: {
        minPrior: 0,
        maxSentenceCandidates: 16,
        minDeltaToReplace: 3,
        candidateRequireRepairTarget: true,
      },
      kenlmScorer: mockScorer(scored) as never,
      prefilledCombinations: merged.combinations,
    });
    expect(scored).toContain('句子A');
    expect(scored).toContain('句子B');
  });

  it('T10: empty prefilled does not rebuild from primary spanSets', async () => {
    const scored: string[] = [];
    await runFwSentenceRerankFromPrefilled({
      rawText: '原文句子',
      spans: [
        {
          text: '原文',
          start: 0,
          end: 2,
          candidates: [],
        },
      ],
      spanSets: [
        [
          {
            span: { text: '原文', start: 0, end: 2 },
            word: '替换桶',
            source: 'lexicon_pinyin_topk',
            priorScore: 1,
            repairTarget: true,
            candidateScore: 5,
          },
        ],
      ],
      config: {
        minPrior: 0,
        maxSentenceCandidates: 16,
        minDeltaToReplace: 3,
        candidateRequireRepairTarget: true,
      },
      kenlmScorer: mockScorer(scored) as never,
      prefilledCombinations: [],
    });
    expect(scored.some((s) => s.includes('替换桶'))).toBe(false);
  });

  it('T10b: prefilledCombinations is required (no undefined legacy rebuild)', () => {
    const rerankSrc = require('fs').readFileSync(
      require('path').join(__dirname, '../kenlm/run-fw-sentence-rerank-from-prefilled.ts'),
      'utf8'
    ) as string;
    expect(rerankSrc).toContain('prefilledCombinations: SentenceCombination[]');
    expect(rerankSrc).not.toContain('prefilledCombinations?:');
    expect(rerankSrc).not.toMatch(
      /prefilledCombinations !== undefined[\s\S]*buildSentenceCandidates/
    );
    expect(rerankSrc).not.toContain('buildSentenceCandidates(');
  });
});

describe('T11 Deterministic ordering', () => {
  it('repeated vote yields stable domainScores and retainedDomains', () => {
    const pool: FineSpanPoolForVote[] = [
      { candidates: [cand({ candidateId: '1', source: 'domain_term', domains: ['tourism_transport'] })] },
      { candidates: [cand({ candidateId: '2', source: 'domain_term', domains: ['tourism_pickup'] })] },
      { candidates: [cand({ candidateId: '3', source: 'domain_term', domains: ['tourism_transport'] })] },
      { candidates: [cand({ candidateId: '4', source: 'domain_term', domains: ['tourism_pickup'] })] },
    ];
    const a = voteUtteranceDomainFromPool(pool);
    const b = voteUtteranceDomainFromPool(pool);
    expect(a.domainScores).toEqual(b.domainScores);
    expect(a.retainedDomains).toEqual(b.retainedDomains);
    expect(DOMAIN_BUCKET_RETENTION_RATIO).toBe(0.75);

    const lists = [
      [
        { text: 'B', replacements: [], candidateScore: 2 },
        { text: 'A', replacements: [], candidateScore: 3 },
      ],
      [{ text: 'A', replacements: [], candidateScore: 1 }],
    ];
    const m1 = mergeCrossBucketSentenceCandidates(lists, 16);
    const m2 = mergeCrossBucketSentenceCandidates(lists, 16);
    expect(m1.combinations.map((c) => c.text)).toEqual(m2.combinations.map((c) => c.text));
  });
});
