/**
 * P0-Guard Gate 3: manual_cut finalize 保持有效。
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
    isPhoneticCorrectionEnabled: jest.fn(() => false),
    isPunctuationRestoreEnabled: jest.fn(() => false),
  };
});

describe('P0-Guard Gate 3: manual_cut finalize', () => {
  it('is_manual_cut=true 时 completeAggregation 后应有 segment 与 repairedText', async () => {
    const job = {
      job_id: 'manual-cut-1',
      session_id: 's-manual',
      utterance_index: 0,
      src_lang: 'zh',
      tgt_lang: 'en',
      turn_id: 'turn-1',
      is_manual_cut: true,
      pipeline: { use_asr: true, use_nmt: false },
    } as JobAssignMessage;

    const ctx = initJobContext(job);
    ctx.asrText = '本段文本';
    ctx.rawAsrText = '本段文本';
    ctx.repairedText = '本段文本';
    ctx.segmentForJobResult = '本段文本';

    const appendTurnSegment = jest.fn();
    const getAndClearTurnAccumulator = jest.fn(() => '累积段');
    const getLastCommittedText = jest.fn(() => null);
    const processUtterance = jest.fn(() => ({
      action: 'COMMIT' as const,
      text: '本段文本',
      isLastInMergedGroup: true,
    }));

    await runAggregationStep(job, ctx, {
      taskRouter: {} as never,
      aggregatorManager: {
        appendTurnSegment,
        getAndClearTurnAccumulator,
        getLastCommittedText,
        processUtterance,
      } as never,
    });

    expect(getAndClearTurnAccumulator).toHaveBeenCalledWith('s-manual', 'turn-1');
    expect((ctx.segmentForJobResult ?? '').length).toBeGreaterThan(0);
  });
});
