/**
 * P0-Guard: non-finalize segment 仍 append turn buffer。
 */
import { runAggregationStep } from '../../main/src/pipeline/steps/aggregation-step';
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
  };
});

describe('P0-Guard: non-finalize append turn buffer', () => {
  it('turn 未 finalize 时 appendTurnSegment 且 defer 翻译', async () => {
    const job = {
      job_id: 'append-1',
      session_id: 's-append',
      utterance_index: 0,
      src_lang: 'zh',
      turn_id: 'turn-a',
      is_manual_cut: false,
      is_timeout_triggered: false,
      pipeline: { use_asr: true, use_nmt: true },
    } as JobAssignMessage;

    const ctx = initJobContext(job);
    ctx.asrText = '片段一';
    ctx.rawAsrText = '片段一';
    ctx.repairedText = '片段一';
    ctx.segmentForJobResult = '片段一';

    const appendTurnSegment = jest.fn();
    const getLastCommittedText = jest.fn(() => null);

    await runAggregationStep(job, ctx, {
      taskRouter: {} as never,
      aggregatorManager: {
        appendTurnSegment,
        getAndClearTurnAccumulator: jest.fn(),
        getLastCommittedText,
      } as never,
    });

    expect(appendTurnSegment).toHaveBeenCalledWith('s-append', 'turn-a', '片段一');
    expect(ctx.shouldDeferTranslation).toBe(true);
    expect(ctx.segmentForJobResult).toBe('片段一');
  });
});
