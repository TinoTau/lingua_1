import { describe, expect, it } from '@jest/globals';
import { sortRecallHitsByToneCompatibility } from './tone-recall-sort';

describe('tone-aware recall sort P0.5', () => {
  const mkHit = (word: string, toneKey: string, prior: number, score: number) => ({
    hotword: { word, priorScore: prior, tonePinyinKey: toneKey },
    candidateScore: score,
    phoneticScore: score,
    source: 'lexicon_pinyin_topk' as const,
    candidateScoreBreakdown: {
      priorScore: prior,
      phoneticSimilarity: 0,
      exactLengthBonus: 0,
      domainBoost: 0,
      editDistancePenalty: 0,
    },
  });

  it('ranks 少冰 first for acoustic pattern [3,1]', () => {
    const hits = [
      mkHit('烧饼', 'shao1|bing3', 0.7, 1.2),
      mkHit('少冰', 'shao3|bing1', 0.65, 1.15),
      mkHit('哨兵', 'shao4|bing1', 0.6, 1.1),
    ];
    const { hits: sorted, recallToneCompatibleCount } = sortRecallHitsByToneCompatibility(
      hits,
      [3, 1]
    );
    expect(sorted[0]!.hotword.word).toBe('少冰');
    expect(recallToneCompatibleCount).toBe(1);
  });

  it('without acoustic pattern preserves plain recall order', () => {
    const hits = [
      mkHit('烧饼', 'shao1|bing3', 0.7, 1.2),
      mkHit('少冰', 'shao3|bing1', 0.65, 1.15),
    ];
    const { hits: sorted, recallToneCompatibleCount, recallToneFallbackCount } =
      sortRecallHitsByToneCompatibility(hits, undefined);
    expect(sorted[0]!.hotword.word).toBe('烧饼');
    expect(recallToneCompatibleCount).toBe(0);
    expect(recallToneFallbackCount).toBe(2);
  });

  it('sorts tone-compatible before incompatible then by priorScore', () => {
    const hits = [
      mkHit('哨兵', 'shao4|bing1', 0.9, 1.5),
      mkHit('少冰', 'shao3|bing1', 0.5, 1.0),
    ];
    const { hits: sorted } = sortRecallHitsByToneCompatibility(hits, [3, 1]);
    expect(sorted[0]!.hotword.word).toBe('少冰');
    expect(sorted[1]!.hotword.word).toBe('哨兵');
  });
});
