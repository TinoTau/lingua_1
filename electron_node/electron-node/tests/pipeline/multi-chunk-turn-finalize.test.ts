/**
 * P0-Guard: multi-chunk turn finalize 输出完整 turn 文本到 segmentForJobResult。
 */
import { runAggregationStep } from '../../main/src/pipeline/steps/aggregation-step';
import { getTextForTranslation } from '../../main/src/pipeline/post-asr-routing';
import { initJobContext } from '../../main/src/pipeline/context/job-context';
import { JobAssignMessage } from '@shared/protocols/messages';

jest.mock('../../main/src/fw-detector/fw-mode', () => ({
  isFwDetectorEngineEnabled: jest.fn(() => true),
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

jest.mock('../../main/src/agent/postprocess/aggregation-stage', () => ({
  AggregationStage: jest.fn().mockImplementation(() => ({
    process: jest.fn((_job: unknown, tempResult: { text_asr: string }) => ({
      action: 'COMMIT',
      aggregationChanged: false,
      isLastInMergedGroup: true,
      shouldSendToSemanticRepair: true,
      segmentForJobResult: tempResult.text_asr,
      metrics: {},
    })),
  })),
}));

describe('P0-Guard: multi-chunk turn finalize', () => {
  const turnId = 'turn-mc';
  const sessionId = 's-mc';

  const makeServices = () => {
    let accumulator = '';
    return {
      appendTurnSegment: jest.fn((_sid: string, _tid: string, text: string) => {
        accumulator = accumulator ? `${accumulator} ${text}` : text;
      }),
      getAndClearTurnAccumulator: jest.fn(() => {
        const acc = accumulator;
        accumulator = '';
        return acc;
      }),
      getLastCommittedText: jest.fn(() => null),
    };
  };

  it('中间 chunk defer；finalize chunk 合并 accumulator + 本段', async () => {
    const aggregatorManager = makeServices();

    const chunkJob = {
      job_id: 'chunk-1',
      session_id: sessionId,
      utterance_index: 0,
      src_lang: 'zh',
      turn_id: turnId,
      is_manual_cut: false,
      is_timeout_triggered: false,
      pipeline: { use_asr: true, use_nmt: true },
    } as JobAssignMessage;

    const chunkCtx = initJobContext(chunkJob);
    chunkCtx.asrText = '第一段';
    chunkCtx.rawAsrText = '第一段';
    chunkCtx.segmentForJobResult = '第一段';

    await runAggregationStep(chunkJob, chunkCtx, {
      taskRouter: {} as never,
      aggregatorManager: aggregatorManager as never,
    });

    expect(aggregatorManager.appendTurnSegment).toHaveBeenCalledWith(sessionId, turnId, '第一段');
    expect(chunkCtx.shouldDeferTranslation).toBe(true);
    expect(chunkCtx.segmentForJobResult).toBe('第一段');

    const finalizeJob = {
      ...chunkJob,
      job_id: 'chunk-2',
      utterance_index: 1,
      is_manual_cut: true,
    } as JobAssignMessage;

    const finalizeCtx = initJobContext(finalizeJob);
    finalizeCtx.asrText = '第二段';
    finalizeCtx.rawAsrText = '第二段';
    finalizeCtx.segmentForJobResult = '第二段';

    await runAggregationStep(finalizeJob, finalizeCtx, {
      taskRouter: {} as never,
      aggregatorManager: aggregatorManager as never,
    });

    expect(finalizeCtx.segmentForJobResult).toBe('第一段 第二段');
    expect(finalizeCtx.shouldDeferTranslation).toBe(false);
    expect(finalizeCtx.shouldAllowTranslation).toBe(true);
    expect(getTextForTranslation(finalizeCtx)).toBe('第一段 第二段');
  });
});
