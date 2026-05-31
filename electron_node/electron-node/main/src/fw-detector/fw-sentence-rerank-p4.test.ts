import { describe, expect, it } from '@jest/globals';
import { buildSentenceCandidates } from './build-sentence-candidates';
import { getPerSpanCandidateLimit } from './per-span-candidate-limit';
import { rerankFwSentences } from './rerank-fw-sentences';
import { mapSentenceToApprovedReplacements } from './map-sentence-to-approved';
import { toneDistance } from '../lexicon/phonetic/tone-pinyin';
import { mergeSpanCandidatesCombined } from '../lexicon-v2/merge-span-candidates';

describe('P4 per-span limit', () => {
  it('matches frozen table', () => {
    expect(getPerSpanCandidateLimit(1)).toBe(8);
    expect(getPerSpanCandidateLimit(2)).toBe(4);
    expect(getPerSpanCandidateLimit(3)).toBe(2);
    expect(getPerSpanCandidateLimit(4)).toBe(2);
  });
});

describe('P4 mergeSpanCandidatesCombined', () => {
  const row = (word: string, tier: 'domain' | 'base', isAlias: boolean) => ({
    id: word,
    word,
    pinyin: ['a'],
    priorScore: 1,
    frequency: 1,
    enabled: true,
    isAlias,
    tier,
  });

  it('domain > alias > base with combined cap', () => {
    const merged = mergeSpanCandidatesCombined(
      [
        row('域词', 'domain', false),
        row('别名', 'domain', true),
        row('基词', 'base', false),
      ],
      2,
      true
    );
    expect(merged.map((r) => r.word)).toEqual(['域词', '别名']);
  });
});

describe('P4 buildSentenceCandidates', () => {
  it('caps combinations at maxSentenceCandidates', () => {
    const span = { text: 'ab', start: 0, end: 2 };
    const mk = (word: string) => ({
      span,
      word,
      source: 'lexicon_pinyin_topk' as const,
      priorScore: 1,
      repairTarget: true,
      candidateScore: 1,
    });
    const combos = buildSentenceCandidates(
      'ab',
      [
        [mk('x1'), mk('x2'), mk('x3')],
        [mk('y1'), mk('y2')],
      ],
      4
    );
    expect(combos.length).toBe(4);
  });
});

describe('P4 rerankFwSentences', () => {
  it('raw wins when maxDelta below threshold', async () => {
    const scorer = {
      async scoreBatch(sentences: string[]) {
        return {
          scores: sentences.map((sentence, i) => ({
            sentence,
            score: i === 0 ? 0 : 0.01,
            normalizedScore: i === 0 ? 0.5 : 0.51,
          })),
          timing: { batchMs: 1, queryCount: sentences.length, avgMs: 1, p50Ms: 1, p95Ms: 1, maxMs: 1 },
        };
      },
    };
    const result = await rerankFwSentences(
      'raw',
      [{ text: 'cand', replacements: [], candidateScore: 1 }],
      scorer,
      0.03
    );
    expect(result.pickedIsRaw).toBe(true);
    expect(result.picked).toBeNull();
  });

  it('batch includes raw first (length <= 17)', async () => {
    let batchLen = 0;
    const scorer = {
      async scoreBatch(sentences: string[]) {
        batchLen = sentences.length;
        return {
          scores: sentences.map((sentence) => ({
            sentence,
            score: 0,
            normalizedScore: 0.5,
          })),
          timing: { batchMs: 0, queryCount: sentences.length, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 },
        };
      },
    };
    await rerankFwSentences(
      'raw',
      [{ text: 'cand', replacements: [], candidateScore: 1 }],
      scorer,
      0.03
    );
    expect(batchLen).toBe(2);
    expect(batchLen).toBeLessThanOrEqual(17);
  });
});

describe('P4 mapSentenceToApprovedReplacements', () => {
  it('filters repairTarget when required', () => {
    const span = { text: 'ab', start: 0, end: 2 };
    const approved = mapSentenceToApprovedReplacements(
      {
        text: 'cd',
        candidateScore: 1,
        replacements: [
          {
            span,
            word: 'cd',
            source: 'lexicon_pinyin_topk',
            priorScore: 1,
            repairTarget: false,
            candidateScore: 1,
          },
        ],
      },
      true
    );
    expect(approved).toHaveLength(0);
  });
});

describe('P4 toneDistance', () => {
  it('counts syllable tone mismatches', () => {
    expect(toneDistance('mei3|shi4', 'mei3|shi2')).toBe(1);
    expect(toneDistance('mei3|shi2', 'mei2|shi4')).toBe(2);
  });
});
