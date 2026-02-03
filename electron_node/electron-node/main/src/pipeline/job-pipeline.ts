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
import { buildBufferKey } from '../pipeline-orchestrator/audio-aggregator-buffer-key';

export interface ServicesBundle {
  taskRouter: any;
  aggregatorManager?: any;
  servicesHandler?: any;
  deduplicationHandler?: any;
  sessionContextManager?: any;
  aggregatorMiddleware?: any;
  dedupStage?: any;  // 全局 DedupStage 实例（用于维护 job_id 去重状态）
  resultSender?: any;  // ResultSender 实例（用于发送原始job的结果）
  audioAggregator?: any;  // AudioAggregator 实例（用于在job之间共享音频缓冲区）
  semanticRepairInitializer?: any;  // SemanticRepairInitializer 实例（复用，避免重复创建）
}

export interface JobPipelineOptions {
  job: JobAssignMessage;
  partialCallback?: PartialResultCallback;
  asrCompletedCallback?: (done: boolean) => void;
  services: ServicesBundle;
  ctx?: JobContext; // 可选的预初始化的 JobContext（用于跳过 ASR 步骤）
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
  const { job, partialCallback, asrCompletedCallback, services, ctx: providedCtx, callbacks } = options;

  // 如果提供了预初始化的 JobContext，使用它；否则创建新的
  const ctx = providedCtx || initJobContext(job);

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
    // 如果 ctx 已经包含 ASR 结果（providedCtx），则跳过 ASR 步骤
    const skipASR = providedCtx !== undefined && providedCtx.asrText !== undefined;
    
    for (const step of mode.steps) {
      // 如果已经提供了 ASR 结果，跳过 ASR 步骤
      if (skipASR && step === 'ASR') {
        logger.debug(
          {
            jobId: job.job_id,
            step,
            note: 'ASR result already provided, skipping ASR step',
          },
          `Skipping step ${step} (ASR result already provided)`
        );
        continue;
      }
      
      // 检查步骤是否应该执行（支持动态条件判断，如 SEMANTIC_REPAIR 依赖 ctx.shouldSendToSemanticRepair）
      if (!shouldExecuteStep(step, mode, job, ctx)) {
        logger.debug(
          { jobId: job.job_id, step, modeName: mode.name },
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
      } catch (error: any) {
        logger.error(
          {
            error: error?.message || error || 'Unknown error',
            stack: error?.stack,
            errorType: error?.constructor?.name,
            jobId: job.job_id,
            step,
            modeName: mode.name,
          },
          `Step ${step} failed`
        );

        // 根据步骤的重要性决定是否继续（ASR/同音纠错/翻译/语义修复为必经且必须成功，失败即 job 失败）
        if (step === 'ASR' || step === 'PHONETIC_CORRECTION' || step === 'TRANSLATION' || step === 'SEMANTIC_REPAIR') {
          // turn 内任一 segment 失败 → 清理该 turn 的合并 buffer（技术方案 6.1）
          if ((job as any).turn_id && services.audioAggregator) {
            const bufferKey = buildBufferKey(job);
            services.audioAggregator.clearBufferByKey(bufferKey);
            logger.info(
              { jobId: job.job_id, bufferKey, step },
              'JobPipeline: Turn segment failed, cleared merge buffer'
            );
          }
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

  // turn 的最后一个 job 结果返回后，直接清理该 turn 的 audioBuffer（唯一清理路径，不做 session 清理和定时清理）
  const isTurnEnd = (job as any).is_manual_cut || (job as any).is_timeout_triggered;
  if (isTurnEnd && (job as any).turn_id && services.audioAggregator) {
    const bufferKey = buildBufferKey(job);
    services.audioAggregator.clearBufferByKey(bufferKey);
    logger.debug({ jobId: job.job_id, bufferKey }, 'JobPipeline: Turn ended, cleared audio buffer');
  }

  return buildJobResult(job, ctx);
}
