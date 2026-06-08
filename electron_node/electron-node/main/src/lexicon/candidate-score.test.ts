import { describe, expect, it } from '@jest/globals';
import {
  computeCandidateScore,
  computeEditDistancePenalty,
  computeCandidateScoreBreakdown,
  recallKindFuzzyPenalty,
} from './candidate-score';
import type { HotwordEntry } from './hotword-types';

const hw: HotwordEntry = {
  id: '1',
  word: '候选生成',
  pinyin: ['hou', 'xuan', 'sheng', 'cheng'],
  priorScore: 8,
  frequency: 10,
  enabled: true,
  domain: 'tech_ai',
  domains: ['tech_ai'],
};

describe('computeCandidateScore', () => {
  it('includes priorScore and phonetic similarity', () => {
    const score = computeCandidateScore({
      hotword: hw,
      windowSyllables: ['hou', 'xuan', 'sheng', 'cheng'],
      windowText: '候选生成',
    });
    expect(score).toBeGreaterThan(hw.priorScore);
  });

  it('adds exact length bonus when window matches word length', () => {
    const short = { ...hw, word: '候选', pinyin: ['hou', 'xuan'] };
    const withBonus = computeCandidateScore({
      hotword: short,
      windowSyllables: ['hou', 'xuan'],
      windowText: '候选',
    });
    const without = computeCandidateScore({
      hotword: short,
      windowSyllables: ['hou', 'xuan'],
      windowText: '候选生',
    });
    expect(withBonus).toBeGreaterThan(without);
  });

  it('editDistancePenalty is in [0, 1]', () => {
    const p = computeEditDistancePenalty('候选生', '候选');
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  it('breakdown includes editDistancePenalty and lowers total score', () => {
    const b = computeCandidateScoreBreakdown({
      hotword: hw,
      windowSyllables: ['hou', 'xuan', 'sheng', 'cheng'],
      windowText: '候选生成',
    });
    expect(b.editDistancePenalty).toBeGreaterThanOrEqual(0);
    expect(b.editDistancePenalty).toBeLessThanOrEqual(1);
    const total =
      b.priorScore +
      b.phoneticSimilarity +
      b.exactLengthBonus +
      b.domainBoost -
      b.editDistancePenalty -
      b.fuzzyPenalty;
    expect(computeCandidateScore({
      hotword: hw,
      windowSyllables: ['hou', 'xuan', 'sheng', 'cheng'],
      windowText: '候选生成',
    })).toBeCloseTo(total, 5);
  });

  it('fuzzy penalty values match V1.2 freeze', () => {
    expect(recallKindFuzzyPenalty('exact_base')).toBe(0);
    expect(recallKindFuzzyPenalty('exact_domain_weak')).toBe(0.02);
    expect(recallKindFuzzyPenalty('fuzzy_plain')).toBe(0.08);
    expect(recallKindFuzzyPenalty('fuzzy_plain_domain')).toBe(0.1);
  });
});
