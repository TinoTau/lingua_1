/**
 * SEMANTIC_REPAIR 步骤门控：use_semantic / 拆分 flag
 */

import {
  shouldExecuteStep,
  inferPipelineMode,
  PipelineStepType,
} from './pipeline-mode-config';
import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from './context/job-context';

describe('SEMANTIC_REPAIR step execution (shouldExecuteStep)', () => {
  const baseJob: JobAssignMessage = {
    job_id: 'job-test-1',
    session_id: 's-test',
    utterance_index: 0,
    src_lang: 'zh',
    tgt_lang: 'en',
    pipeline: {
      use_asr: true,
      use_nmt: true,
      use_tts: true,
      use_tone: false,
    },
  } as JobAssignMessage;

  const mode = inferPipelineMode(baseJob);

  it('use_semantic=false 时不执行 SEMANTIC_REPAIR', () => {
    const job = {
      ...baseJob,
      pipeline: { ...baseJob.pipeline, use_semantic: false },
    } as JobAssignMessage;
    const ctx: JobContext = {
      shouldRunSemanticRepairHttp: true,
    };
    expect(
      shouldExecuteStep('SEMANTIC_REPAIR' as PipelineStepType, mode, job, ctx)
    ).toBe(false);
  });

  it('shouldRunSemanticRepairHttp=false 时跳过 SEMANTIC_REPAIR', () => {
    const ctx: JobContext = { shouldRunSemanticRepairHttp: false };
    expect(
      shouldExecuteStep('SEMANTIC_REPAIR' as PipelineStepType, mode, baseJob, ctx)
    ).toBe(false);
  });

  it('use_semantic 缺省为 false，未显式开启时不执行', () => {
    const ctx: JobContext = { shouldRunSemanticRepairHttp: true };
    expect(
      shouldExecuteStep('SEMANTIC_REPAIR' as PipelineStepType, mode, baseJob, ctx)
    ).toBe(false);
  });

  it('use_semantic=true 且节点 feature 开启且 shouldRunSemanticRepairHttp=true 时执行', () => {
    const job = {
      ...baseJob,
      pipeline: { ...baseJob.pipeline, use_semantic: true },
    } as JobAssignMessage;
    const ctx: JobContext = { shouldRunSemanticRepairHttp: true };
    // 节点 feature 在单测环境缺省 false，此处仅验证 job 层关闭时行为；feature 见 node-config 单测
    expect(
      shouldExecuteStep('SEMANTIC_REPAIR' as PipelineStepType, mode, job, ctx)
    ).toBe(false);
  });

  it('shouldDeferTranslation=true 时不执行 TRANSLATION', () => {
    const ctx: JobContext = {
      shouldAllowTranslation: false,
      shouldDeferTranslation: true,
    };
    expect(
      shouldExecuteStep('TRANSLATION' as PipelineStepType, mode, baseJob, ctx)
    ).toBe(false);
  });

  it('shouldAllowTranslation=true 时执行 TRANSLATION', () => {
    const ctx: JobContext = {
      shouldAllowTranslation: true,
      shouldDeferTranslation: false,
    };
    expect(
      shouldExecuteStep('TRANSLATION' as PipelineStepType, mode, baseJob, ctx)
    ).toBe(true);
  });
});
