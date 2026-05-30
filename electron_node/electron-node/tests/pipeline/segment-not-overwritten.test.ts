/**
 * P0-Guard Gate 2: FW 写回的 segmentForJobResult 不得被 aggregation routing 覆盖。
 */
import { runAggregationStep } from '../../main/src/pipeline/steps/aggregation-step';
import { applyPostAggregationRouting } from '../../main/src/pipeline/post-asr-routing';
import { buildJobResult } from '../../main/src/pipeline/result-builder';
import { initJobContext } from '../../main/src/pipeline/context/job-context';
import { JobAssignMessage } from '@shared/protocols/messages';

jest.mock('../../main/src/fw-detector/fw-mode', () => ({
  isFwDetectorEngineEnabled: jest.fn(() => true),
  isFwDetectorPipelineActive: jest.fn(() => true),
  getFwDetectorFeatureEnabled: jest.fn(() => true),
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

describe('P0-Guard Gate 2: segmentForJobResult 不被覆盖', () => {
  const job = {
    job_id: 'gate2',
    session_id: 's2',
    utterance_index: 0,
    src_lang: 'zh',
    tgt_lang: 'en',
    pipeline: { use_asr: true, use_nmt: false },
  } as JobAssignMessage;

  it('post-asr-routing defer 不清 segmentForJobResult', () => {
    const ctx = initJobContext(job);
    ctx.rawAsrText = '美食大背';
    ctx.asrText = '美食大背';
    ctx.segmentForJobResult = '美式大杯';

    applyPostAggregationRouting(job, ctx, {
      segmentReady: true,
      wantsPostAsrPipeline: false,
      deferTranslation: true,
    });

    expect(ctx.segmentForJobResult).toBe('美式大杯');
    expect(ctx.shouldDeferTranslation).toBe(true);
  });

  it('aggregation 后 result-builder.text_asr 仍为 segmentForJobResult', async () => {
    const ctx = initJobContext(job);
    ctx.rawAsrText = '美食大背';
    ctx.asrText = '美食大背';
    ctx.segmentForJobResult = '美式大杯';

    await runAggregationStep(job, ctx, { taskRouter: {} as never });

    const result = buildJobResult(job, ctx);
    expect(result.text_asr).toBe('美式大杯');
    expect(result.extra?.raw_asr_text).toBe('美食大背');
  });
});
