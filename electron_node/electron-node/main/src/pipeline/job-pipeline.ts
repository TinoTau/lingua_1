/**
 * JobPipeline - 唯一编排器
 * 所有逻辑"平铺"在一条直线上，不使用 Stage/Orchestrator/Coordinator
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobResult, PartialResultCallback } from '../inference/inference-service';
import { JobContext, initJobContext } from './context/job-context';
import logger from '../logger';
import { runAsrStep } from './steps/asr-step';
import { runAggregationStep } from './steps/aggregation-step';
import { runSemanticRepairStep } from './steps/semantic-repair-step';
import { runDedupStep } from './steps/dedup-step';
import { runTranslationStep } from './steps/translation-step';
import { runTtsStep } from './steps/tts-step';
import { runToneStep } from './steps/tone-step';
import { buildJobResult } from './result-builder';

export interface ServicesBundle {
  taskRouter: any;
  aggregatorManager?: any;
  servicesHandler?: any;
  deduplicationHandler?: any;
  sessionContextManager?: any;
  aggregatorMiddleware?: any;
  dedupStage?: any;  // 全局 DedupStage 实例（用于维护 job_id 去重状态）
}

export interface JobPipelineOptions {
  job: JobAssignMessage;
  partialCallback?: PartialResultCallback;
  asrCompletedCallback?: (done: boolean) => void;
  services: ServicesBundle;
  callbacks?: {
    onTaskStart?: () => void;
    onTaskEnd?: () => void;
    onTaskProcessed?: (serviceName: string) => void;
  };
}

/**
 * 运行 JobPipeline（唯一编排器）
 */
export async function runJobPipeline(options: JobPipelineOptions): Promise<JobResult> {
  const { job, partialCallback, asrCompletedCallback, services, callbacks } = options;

  const ctx = initJobContext(job);

  // 任务开始回调
  callbacks?.onTaskStart?.();

  try {
    // ASR 步骤
    if (job.pipeline?.use_asr !== false) {
      await runAsrStep(job, ctx, services, {
        partialCallback,
        asrCompletedCallback,
      });
      callbacks?.onTaskProcessed?.('ASR');
    }

    // 聚合步骤
    await runAggregationStep(job, ctx, services);
    callbacks?.onTaskProcessed?.('AGGREGATION');

    // 语义修复步骤
    await runSemanticRepairStep(job, ctx, services);
    callbacks?.onTaskProcessed?.('SEMANTIC_REPAIR');

    // 去重步骤
    await runDedupStep(job, ctx, services);

    // 翻译步骤
    if (job.pipeline?.use_nmt !== false) {
      await runTranslationStep(job, ctx, services);
      callbacks?.onTaskProcessed?.('NMT');
    }

    // TTS 步骤
    if (job.pipeline?.use_tts !== false) {
      await runTtsStep(job, ctx, services);
      callbacks?.onTaskProcessed?.('TTS');
    }

    // TONE 步骤
    if (job.pipeline?.use_tone === true) {
      await runToneStep(job, ctx, services);
      callbacks?.onTaskProcessed?.('TONE');
    }
  } finally {
    // 任务结束回调
    callbacks?.onTaskEnd?.();
  }

  return buildJobResult(job, ctx);
}
