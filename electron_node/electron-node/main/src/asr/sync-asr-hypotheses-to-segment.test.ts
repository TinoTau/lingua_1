import { describe, expect, it } from '@jest/globals';
import type { JobContext } from '../pipeline/context/job-context';
import { syncAsrHypothesesToSegment } from './sync-asr-hypotheses-to-segment';

describe('syncAsrHypothesesToSegment', () => {
  it('segment 与 CTC rank0 一致时不改动', () => {
    const ctx: JobContext = {
      segmentForJobResult: '聚合后文本',
      asrHypotheses: [
        { text: '聚合后文本', rank: 0 },
        { text: '另一假设', rank: 1, acousticScore: -1 },
      ],
      asrNbest: [
        { rank: 0, text: '聚合后文本' },
        { rank: 1, text: '另一假设' },
      ],
      nbestSynthetic: false,
    };
    const changed = syncAsrHypothesesToSegment(ctx);
    expect(changed).toBe(false);
    expect(ctx.asrHypotheses).toHaveLength(2);
    expect(ctx.nbestSynthetic).toBe(false);
    expect(ctx.ctcNbestPreserved).toBe(true);
  });

  it('segment 与 rank0 不一致但有多条 CTC nbest 时保留 nbest', () => {
    const ctx: JobContext = {
      segmentForJobResult: '聚合后文本B',
      asrHypotheses: [
        { text: '原始ASR文本A', rank: 0 },
        { text: '假设一', rank: 1, acousticScore: -2 },
      ],
      asrNbest: [
        { rank: 0, text: '原始ASR文本A' },
        { rank: 1, text: '假设一' },
      ],
      nbestSynthetic: false,
    };
    const changed = syncAsrHypothesesToSegment(ctx);
    expect(changed).toBe(true);
    expect(ctx.asrHypotheses).toHaveLength(2);
    expect(ctx.asrHypotheses![0].text).toBe('原始ASR文本A');
    expect(ctx.nbestSynthetic).toBe(false);
    expect(ctx.ctcNbestPreserved).toBe(true);
    expect(ctx.segmentSynthetic).toBe(true);
    expect(ctx.aggregationResyncReason).toBe('segment_mismatch_ctc_preserved');
  });

  it('无多假设时仍重建 synthetic top1', () => {
    const ctx: JobContext = {
      segmentForJobResult: '聚合后文本B',
      asrHypotheses: [{ text: '原始ASR文本A', rank: 0 }],
      nbestSynthetic: false,
    };
    const changed = syncAsrHypothesesToSegment(ctx);
    expect(changed).toBe(true);
    expect(ctx.asrHypotheses).toHaveLength(1);
    expect(ctx.asrHypotheses![0].text).toBe('聚合后文本B');
    expect(ctx.nbestSynthetic).toBe(true);
    expect(ctx.ctcNbestPreserved).toBe(false);
  });
});
