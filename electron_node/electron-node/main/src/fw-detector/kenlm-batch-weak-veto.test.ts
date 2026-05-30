import { describe, expect, it } from '@jest/globals';
import type { KenLMScorer } from '../asr-repair/kenlm-batch-types';
import { scoreSpanCandidateSentences } from '../asr-repair/kenlm-span-gate';

describe('scoreSpanCandidateSentences (FW topK batch)', () => {
  it('returns disabled rows when KenLM gate off', async () => {
    const result = await scoreSpanCandidateSentences(null, '原文', ['候选句'], {
      enabled: false,
      mode: 'weak_veto',
      deltaThreshold: 0.8,
      vetoThreshold: -0.2,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.reason).toBe('kenlm_disabled');
    expect(result.candidates[0]?.vetoed).toBe(false);
  });

  it('batch-scores raw + candidates and applies weak_veto', async () => {
    const scorer: KenLMScorer = {
      scoreBatch: async (sentences) => ({
        scores: sentences.map((s, i) => ({
          sentence: s,
          score: i === 0 ? 0.5 : 0.9,
          normalizedScore: i === 0 ? 0.5 : 0.9,
        })),
        timing: { batchMs: 1, queryCount: sentences.length, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 },
      }),
    };
    const result = await scoreSpanCandidateSentences(scorer, '原文', ['更好'], {
      enabled: true,
      mode: 'weak_veto',
      deltaThreshold: 0.8,
      vetoThreshold: -0.2,
    });
    expect(result.candidates[0]?.delta).toBeCloseTo(0.4);
    expect(result.candidates[0]?.approved).toBe(true);
    expect(result.unavailable).toBe(false);
  });

  it('fail-closed when scorer missing but gate enabled', async () => {
    const result = await scoreSpanCandidateSentences(null, '原文', ['候选'], {
      enabled: true,
      mode: 'weak_veto',
      deltaThreshold: 0.8,
      vetoThreshold: -0.2,
    });
    expect(result.unavailable).toBe(true);
    expect(result.candidates[0]?.vetoed).toBe(true);
    expect(result.candidates[0]?.reason).toBe('kenlm_unavailable');
  });
});
