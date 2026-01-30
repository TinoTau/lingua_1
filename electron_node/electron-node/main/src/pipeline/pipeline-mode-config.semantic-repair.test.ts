/**
 * 单元测试：SEMANTIC_REPAIR 步骤是否执行 - 复现语义修复未调用问题
 * 模拟 AGGREGATION 之后 ctx.shouldSendToSemanticRepair 的设置与 shouldExecuteStep 的判定
 */

import {
  shouldExecuteStep,
  inferPipelineMode,
  PIPELINE_MODES,
  PipelineStepType,
} from './pipeline-mode-config';
import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from './context/job-context';

describe('SEMANTIC_REPAIR step execution (shouldExecuteStep)', () => {
  const job: JobAssignMessage = {
    job_id: 'job-test-1',
    session_id: 's-test',
    utterance_index: 0,
    src_lang: 'auto',
    tgt_lang: 'en',
    pipeline: {
      use_asr: true,
      use_nmt: true,
      use_tts: true,
      use_semantic: false,
      use_tone: false,
    },
  } as JobAssignMessage;

  const mode = inferPipelineMode(job);

  it('mode 应包含 SEMANTIC_REPAIR 步骤', () => {
    expect(mode.steps).toContain('SEMANTIC_REPAIR');
  });

  it('当 ctx.shouldSendToSemanticRepair === true 时，应执行 SEMANTIC_REPAIR', () => {
    const ctx: JobContext = {
      asrText: 'test',
      segmentForJobResult: 'test',
      shouldSendToSemanticRepair: true,
    };
    const result = shouldExecuteStep(
      'SEMANTIC_REPAIR' as PipelineStepType,
      mode,
      job,
      ctx
    );
    expect(result).toBe(true);
  });

  it('当 ctx.shouldSendToSemanticRepair === undefined 时，应跳过 SEMANTIC_REPAIR', () => {
    const ctx: JobContext = {
      asrText: 'test',
      segmentForJobResult: 'test',
    };
    const result = shouldExecuteStep(
      'SEMANTIC_REPAIR' as PipelineStepType,
      mode,
      job,
      ctx
    );
    expect(result).toBe(false);
  });

  it('当 ctx 为 undefined 时，应跳过 SEMANTIC_REPAIR', () => {
    const result = shouldExecuteStep(
      'SEMANTIC_REPAIR' as PipelineStepType,
      mode,
      job,
      undefined
    );
    expect(result).toBe(false);
  });

  it('当 ctx.shouldSendToSemanticRepair === false 时，应跳过 SEMANTIC_REPAIR', () => {
    const ctx: JobContext = {
      asrText: 'test',
      segmentForJobResult: 'test',
      shouldSendToSemanticRepair: false,
    };
    const result = shouldExecuteStep(
      'SEMANTIC_REPAIR' as PipelineStepType,
      mode,
      job,
      ctx
    );
    expect(result).toBe(false);
  });

  /**
   * 模拟真实流程：AGGREGATION 步骤执行后设置 ctx.shouldSendToSemanticRepair，
   * 然后对同一 ctx 调用 shouldExecuteStep('SEMANTIC_REPAIR', ...)。
   * 若此处失败，说明逻辑或引用有问题。
   */
  it('模拟 AGGREGATION 之后对同一 ctx 检查 SEMANTIC_REPAIR 应执行', () => {
    const ctx: JobContext = {
      asrText: '我们开始进行一次语音识别稳定性测试',
      segmentForJobResult: '我们开始进行一次语音识别稳定性测试',
    };
    // 模拟 aggregation-step 写入
    (ctx as any).shouldSendToSemanticRepair = true;

    const result = shouldExecuteStep(
      'SEMANTIC_REPAIR' as PipelineStepType,
      mode,
      job,
      ctx
    );
    expect(result).toBe(true);
  });
});
