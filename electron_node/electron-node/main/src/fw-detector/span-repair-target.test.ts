import { describe, expect, it } from '@jest/globals';
import { evaluateSpanReplacementFromRecall } from './span-replacement-eval';

describe('evaluateSpanReplacementFromRecall (candidate layer)', () => {
  it('requires repair_target when candidateRequireRepairTarget enabled', () => {
    const recall = {
      hits: [
        {
          word: '拿铁',
          priorScore: 0.9,
          candidateScore: 1,
          phoneticScore: 1,
          source: 'lexicon_pinyin_topk' as const,
          domains: ['restaurant'],
          repairTarget: false,
        },
      ],
      maxPhoneticScore: 1,
    };
    const evalResult = evaluateSpanReplacementFromRecall(recall, '拿铁', true);
    expect(evalResult.hasReplacementCandidate).toBe(false);
  });

  it('alias replacement counts when repair_target true', () => {
    const recall = {
      hits: [
        {
          word: '美式',
          priorScore: 0.95,
          candidateScore: 1.2,
          phoneticScore: 0.95,
          source: 'alias_pinyin' as const,
          domains: ['restaurant'],
          repairTarget: true,
        },
      ],
      maxPhoneticScore: 0.95,
    };
    const evalResult = evaluateSpanReplacementFromRecall(recall, '美食', true);
    expect(evalResult.hasReplacementCandidate).toBe(true);
    expect(evalResult.topReplacementWord).toBe('美式');
  });

  it('requireRepairTarget=false 允许非 repair_target hit', () => {
    const recall = {
      hits: [
        {
          word: '拿铁',
          priorScore: 0.9,
          candidateScore: 1,
          phoneticScore: 0.9,
          source: 'lexicon_pinyin_topk' as const,
          domains: ['restaurant'],
          repairTarget: false,
        },
      ],
      maxPhoneticScore: 0.9,
    };
    const evalResult = evaluateSpanReplacementFromRecall(recall, '那铁', false);
    expect(evalResult.hasReplacementCandidate).toBe(true);
  });
});
