import { describe, expect, it } from '@jest/globals';
import {
  evaluateKenlmDecision,
  gateSpanReplacement,
  scoreSpanCandidateSentences,
} from './kenlm-span-gate';
import type { KenlmSpanGateOptions } from '../fw-detector/types';

const WEAK_OPTS: KenlmSpanGateOptions = {
  enabled: true,
  mode: 'weak_veto',
  deltaThreshold: 0.8,
  vetoThreshold: -0.2,
};

const HARD_OPTS: KenlmSpanGateOptions = {
  enabled: true,
  mode: 'hard_gate',
  deltaThreshold: 0.8,
  vetoThreshold: -0.2,
};

const SPAN = { text: '后选', start: 4, end: 6 };

describe('evaluateKenlmDecision', () => {
  it('hard_gate: delta below threshold → below_delta_threshold', () => {
    const d = evaluateKenlmDecision({
      delta: 0.3,
      mode: 'hard_gate',
      deltaThreshold: 0.8,
      vetoThreshold: -0.2,
    });
    expect(d.approved).toBe(false);
    expect(d.vetoed).toBe(true);
    expect(d.reason).toBe('below_delta_threshold');
  });

  it('weak_veto: delta -0.08 → not_worse_than_threshold', () => {
    const d = evaluateKenlmDecision({
      delta: -0.08,
      mode: 'weak_veto',
      deltaThreshold: 0.8,
      vetoThreshold: -0.2,
    });
    expect(d.approved).toBe(true);
    expect(d.vetoed).toBe(false);
    expect(d.reason).toBe('not_worse_than_threshold');
  });

  it('weak_veto: delta -0.5 → vetoed_worse_than_threshold', () => {
    const d = evaluateKenlmDecision({
      delta: -0.5,
      mode: 'weak_veto',
      deltaThreshold: 0.8,
      vetoThreshold: -0.2,
    });
    expect(d.approved).toBe(false);
    expect(d.vetoed).toBe(true);
    expect(d.reason).toBe('vetoed_worse_than_threshold');
  });
});

describe('scoreSpanCandidateSentences', () => {
  it('delegates to same batch path as gateSpanReplacement', async () => {
    const scorer = {
      scoreBatch: async (sentences: string[]) => ({
        scores: sentences.map((s, i) => ({
          sentence: s,
          score: i,
          normalizedScore: i === 0 ? 0.5 : 0.6,
        })),
        timing: { batchMs: 1, queryCount: sentences.length, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 },
      }),
    };
    const batch = await scoreSpanCandidateSentences(scorer, '原文', ['候选'], WEAK_OPTS);
    const single = await gateSpanReplacement(scorer, '原文', { text: '文', start: 1, end: 2 }, '选', WEAK_OPTS);
    expect(batch.candidates[0]?.delta).toBeCloseTo(single.delta, 5);
  });
});

describe('gateSpanReplacement', () => {
  it('KenLM 不可用时 fail-closed', async () => {
    const diag = await gateSpanReplacement(
      null,
      '我们要做后选',
      SPAN,
      '候选',
      WEAK_OPTS
    );
    expect(diag.approved).toBe(false);
    expect(diag.vetoed).toBe(true);
    expect(diag.reason).toBe('kenlm_unavailable');
  });

  it('KenLM 关闭时 kenlm_disabled', async () => {
    const diag = await gateSpanReplacement(null, '我们要做后选', SPAN, '候选', {
      ...WEAK_OPTS,
      enabled: false,
    });
    expect(diag.approved).toBe(true);
    expect(diag.vetoed).toBe(false);
    expect(diag.reason).toBe('kenlm_disabled');
  });

  it('hard_gate delta 达标 → approved_hard_gate', async () => {
    const scorer = {
      scoreBatch: async () => ({
        scores: [
          { sentence: 'a', score: 0, normalizedScore: 0.2 },
          { sentence: 'b', score: 1, normalizedScore: 1.0 },
        ],
        timing: { batchMs: 1, queryCount: 2, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 },
      }),
    };
    const diag = await gateSpanReplacement(scorer, '我们要做后选', SPAN, '候选', {
      ...HARD_OPTS,
      deltaThreshold: 0.5,
    });
    expect(diag.approved).toBe(true);
    expect(diag.reason).toBe('approved_hard_gate');
  });

  it('weak_veto 使用 scorer delta', async () => {
    const scorer = {
      scoreBatch: async () => ({
        scores: [
          { sentence: 'a', score: 0, normalizedScore: 0.5 },
          { sentence: 'b', score: 0, normalizedScore: 0.42 },
        ],
        timing: { batchMs: 1, queryCount: 2, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 },
      }),
    };
    const diag = await gateSpanReplacement(scorer, '我们要做后选', SPAN, '候选', WEAK_OPTS);
    expect(diag.approved).toBe(true);
    expect(diag.reason).toBe('not_worse_than_threshold');
    expect(diag.delta).toBeCloseTo(-0.08, 5);
  });
});
