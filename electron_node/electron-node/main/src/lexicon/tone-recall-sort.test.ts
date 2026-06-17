import { describe, expect, it } from '@jest/globals';
import { sortRecallHitsByToneCompatibility } from './tone-recall-sort';
import { TONE_MISMATCH_PENALTY } from '../fw-detector/tone-match-score';

describe('tone-aware recall ranking', () => {
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

  it('retains all hits and ranks 少冰 first for acoustic pattern [3,1]', () => {
    const hits = [
      mkHit('烧饼', 'shao1|bing3', 0.7, 1.2),
      mkHit('少冰', 'shao3|bing1', 0.65, 1.15),
      mkHit('哨兵', 'shao4|bing1', 0.6, 1.1),
    ];
    const { hits: ranked, recallToneCompatibleCount, recallToneFallbackCount } =
      sortRecallHitsByToneCompatibility(hits, [3, 1]);
    expect(ranked.map((h) => h.hotword.word)).toEqual(['少冰', '烧饼', '哨兵']);
    expect(recallToneCompatibleCount).toBe(1);
    expect(recallToneFallbackCount).toBe(2);
    expect(ranked[0]!.candidateScore).toBe(1.15);
    expect(ranked[1]!.candidateScore).toBeCloseTo(1.2 * TONE_MISMATCH_PENALTY);
  });

  it('ranks tone_exact stage before plain_fallback at equal score', () => {
    const hits = [
      {
        ...mkHit('烧饼', 'shao1|bing3', 0.7, 1.2),
        toneLookupStage: 'plain_fallback' as const,
      },
      {
        ...mkHit('少冰', 'shao3|bing1', 0.65, 1.2),
        toneLookupStage: 'tone_exact' as const,
        toneReason: 'match' as const,
        toneCompatible: true,
        tonePenalty: 1.0,
      },
    ];
    const { hits: ranked } = sortRecallHitsByToneCompatibility(hits, [3, 1]);
    expect(ranked[0]!.hotword.word).toBe('少冰');
    expect(ranked[0]!.toneLookupStage).toBe('tone_exact');
  });

  it('without acoustic pattern applies no_pattern and zero penalized count', () => {
    const hits = [
      mkHit('烧饼', 'shao1|bing3', 0.7, 1.2),
      mkHit('少冰', 'shao3|bing1', 0.65, 1.15),
    ];
    const { hits: sorted, recallToneCompatibleCount, recallToneFallbackCount } =
      sortRecallHitsByToneCompatibility(hits, undefined);
    expect(sorted[0]!.hotword.word).toBe('烧饼');
    expect(sorted[0]!.toneReason).toBe('no_pattern');
    expect(recallToneCompatibleCount).toBe(0);
    expect(recallToneFallbackCount).toBe(0);
  });

  it('penalizes incompatible hits but retains both in ranking order', () => {
    const hits = [
      mkHit('哨兵', 'shao4|bing1', 0.9, 1.5),
      mkHit('少冰', 'shao3|bing1', 0.5, 1.0),
    ];
    const { hits: ranked } = sortRecallHitsByToneCompatibility(hits, [3, 1]);
    expect(ranked.map((h) => h.hotword.word)).toEqual(['哨兵', '少冰']);
    expect(ranked[0]!.candidateScore).toBeCloseTo(1.5 * TONE_MISMATCH_PENALTY);
    expect(ranked[1]!.candidateScore).toBe(1.0);
    expect(ranked[0]!.toneReason).toBe('mismatch');
    expect(ranked[1]!.toneReason).toBe('match');
  });

  it('penalizes 焙烧 but retains for d001-like bei|shao pattern [4,3]', () => {
    const hits = [
      mkHit('焙烧', 'bei4|shao1', 0.7, 1.2),
      mkHit('贝少', 'bei4|shao3', 0.4, 1.0),
    ];
    const { hits: ranked, recallToneCompatibleCount, recallToneFallbackCount } =
      sortRecallHitsByToneCompatibility(hits, [4, 3]);
    expect(ranked.map((h) => h.hotword.word)).toEqual(['贝少', '焙烧']);
    expect(recallToneCompatibleCount).toBe(1);
    expect(recallToneFallbackCount).toBe(1);
    expect(ranked[1]!.toneReason).toBe('mismatch');
  });

  it('retains sole mismatch hit with reduced score', () => {
    const hits = [mkHit('焙烧', 'bei4|shao1', 0.7, 1.2)];
    const { hits: ranked } = sortRecallHitsByToneCompatibility(hits, [4, 3]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.candidateScore).toBeCloseTo(1.2 * TONE_MISMATCH_PENALTY);
    expect(ranked[0]!.tonePenalty).toBe(TONE_MISMATCH_PENALTY);
  });
});
