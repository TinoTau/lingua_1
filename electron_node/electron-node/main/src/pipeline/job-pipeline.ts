/**
 * JobPipeline - 唯一编排器
 * 使用配置驱动的方式，根据 Pipeline 模式动态执行步骤，避免硬编码 if/else
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobResult, PartialResultCallback } from '../inference/inference-service';
import { JobContext, initJobContext } from './context/job-context';
import logger from '../logger';
import { buildJobResult } from './result-builder';
import { inferPipelineMode, shouldExecuteStep, PipelineMode } from './pipeline-mode-config';
import { executeStep, PipelineStepType } from './pipeline-step-registry';

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
 * 使用配置驱动的方式，根据 Pipeline 模式动态执行步骤
 */
export async function runJobPipeline(options: JobPipelineOptions): Promise<JobResult> {
  const { job, partialCallback, asrCompletedCallback, services, callbacks } = options;

  const ctx = initJobContext(job);

  // 任务开始回调
  callbacks?.onTaskStart?.();

  try {
    // 1. 根据 job.pipeline 配置推断 Pipeline 模式
    const mode = inferPipelineMode(job);

    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        modeName: mode.name,
        steps: mode.steps,
        pipeline: job.pipeline,
      },
      `Pipeline mode inferred: ${mode.name}`
    );

    // 2. 按模式配置的步骤序列执行
    for (const step of mode.steps) {
      // 检查步骤是否应该执行（支持动态条件判断）
      if (!shouldExecuteStep(step, mode, job)) {
        logger.debug(
          {
            jobId: job.job_id,
            step,
            modeName: mode.name,
          },
          `Skipping step ${step} (condition not met)`
        );
        continue;
      }

      try {
        // 准备步骤特定的选项
        const stepOptions = step === 'ASR' ? {
          partialCallback,
          asrCompletedCallback,
        } : undefined;

        // 执行步骤
        await executeStep(step, job, ctx, services, stepOptions);

        // 触发步骤完成回调
        callbacks?.onTaskProcessed?.(step);

        logger.debug(
          {
            jobId: job.job_id,
            step,
            modeName: mode.name,
          },
          `Step ${step} completed`
        );
      } catch (error) {
        logger.error(
          {
            error,
            jobId: job.job_id,
            step,
            modeName: mode.name,
          },
          `Step ${step} failed`
        );

        // 根据步骤的重要性决定是否继续
        if (step === 'ASR' || step === 'TRANSLATION') {
          // 关键步骤失败，抛出错误
          throw error;
        } else {
          // 非关键步骤失败，记录错误但继续执行
          logger.warn(
            {
              jobId: job.job_id,
              step,
            },
            `Step ${step} failed, continuing with next step`
          );
        }
      }
    }
  } finally {
    // 任务结束回调
    callbacks?.onTaskEnd?.();
  }

  return buildJobResult(job, ctx);
}
