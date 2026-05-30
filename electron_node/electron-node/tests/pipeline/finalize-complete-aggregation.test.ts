/**
 * P0-Guard: finalize 路径调用 completeAggregation 门控。
 */
import { completeAggregation } from '../../main/src/pipeline/complete-aggregation';
import { getTextForTranslation } from '../../main/src/pipeline/post-asr-routing';
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

  it('segmentReady 时允许翻译且 NMT 读 segmentForJobResult', () => {
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '完整 turn 文本';

    completeAggregation(job, ctx, {
      segmentReady: true,
      wantsPostAsrPipeline: true,
    });

    expect(ctx.shouldAllowTranslation).toBe(true);
    expect(getTextForTranslation(ctx)).toBe('完整 turn 文本');
  });

  it('defer 时保留 segmentForJobResult', () => {
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '已有 segment';

    completeAggregation(job, ctx, {
      segmentReady: true,
      wantsPostAsrPipeline: false,
      deferTranslation: true,
    });

    expect(ctx.segmentForJobResult).toBe('已有 segment');
    expect(ctx.shouldDeferTranslation).toBe(true);
  });
});
