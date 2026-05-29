/**
 * P0-Guard: finalize 路径调用 completeAggregation 门控。
 */
import { completeAggregation } from '../../main/src/pipeline/complete-aggregation';
import { initJobContext } from '../../main/src/pipeline/context/job-context';
import { JobAssignMessage } from '@shared/protocols/messages';

jest.mock('../../main/src/fw-detector/fw-mode', () => ({
  isFwDetectorEngineEnabled: jest.fn(() => true),
}));

jest.mock('../../main/src/asr/sync-asr-hypotheses-to-segment', () => ({
  syncAsrHypothesesToSegment: jest.fn(),
}));

jest.mock('../../main/src/node-config', () => {
  const actual = jest.requireActual('../../main/src/node-config');
  return {
    ...actual,
    isSemanticRepairEnabled: jest.fn(() => false),
    isPhoneticCorrectionEnabled: jest.fn(() => false),
    isPunctuationRestoreEnabled: jest.fn(() => false),
  };
});

describe('P0-Guard: completeAggregation', () => {
  const job = {
    job_id: 'agg-complete',
    session_id: 's-agg',
    utterance_index: 0,
    src_lang: 'zh',
    pipeline: { use_asr: true },
  } as JobAssignMessage;

  it('segmentReady 时写入 repairedText 基线并允许翻译', () => {
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '聚合段';
    ctx.repairedText = '已有修复';

    completeAggregation(job, ctx, {
      segmentReady: true,
      wantsPostAsrPipeline: true,
    });

    expect(ctx.shouldAllowTranslation).toBe(true);
    expect(ctx.repairedText).toBe('已有修复');
  });

  it('defer 时清空 repairedText', () => {
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '聚合段';
    ctx.repairedText = '已有修复';

    completeAggregation(job, ctx, {
      segmentReady: true,
      wantsPostAsrPipeline: false,
      deferTranslation: true,
    });

    expect(ctx.repairedText).toBe('');
    expect(ctx.shouldDeferTranslation).toBe(true);
  });
});
