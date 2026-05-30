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
import { getLexiconRecallSkipReason } from '../node-config';
import { stampRecoverPipelineSkip } from '../legacy/recover/recover-contract';
import { executeStep, PipelineStepType } from './pipeline-step-registry';
import { buildBufferKey } from '../pipeline-orchestrator/audio-aggregator-buffer-key';
import { finalizeSessionTurn, beginSessionTurnProfile } from '../session-runtime/session-finalize';
import { collectReplayPatchProposal } from '../lexicon/replay-patch/patch-collector';

export interface ServicesBundle {
  taskRouter: any;
  nodeId?: string;
  aggregatorManager?: any;
  servicesHandler?: any;
  deduplicationHandler?: any;
  sessionContextManager?: any;
  aggregatorMiddleware?: any;
  dedupStage?: any;  // 全局 DedupStage 实例（用于维护 job_id 去重状态）
  resultSender?: any;  // ResultSender 实例（用于发送原始job的结果）
  audioAggregator?: any;  // AudioAggregator 实例（用于在job之间共享音频缓冲区）
  semanticRepairInitializer?: any;  // SemanticRepairInitializer 实例（复用，避免重复创建）
  /** LID v1：二选一引擎（ORT 内嵌），进程启动时加载 */
  lidEngine?: any;
  /** LID Router：RoomStateStore + selectSrcLang */
  lidRouter?: { store: any; select: any };
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

  if (job.session_id?.trim()) {
    const intentSchedulingEnabled = (job as { lexicon_v2_intent_enabled?: boolean }).lexicon_v2_intent_enabled !== false;
    beginSessionTurnProfile(job, ctx, services.nodeId ?? '', { intentSchedulingEnabled });
  }

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
        if (step === 'LEXICON_RECALL' || step === 'SENTENCE_REPAIR') {
          const reason = getLexiconRecallSkipReason(job, ctx) ?? 'condition_not_met';
          stampRecoverPipelineSkip(job, ctx, reason);
          logger.info(
            { jobId: job.job_id, step, reason },
            `[${step}] skipped reason=${reason}`
          );
        } else {
          logger.debug(
            { jobId: job.job_id, step, modeName: mode.name },
            `Skipping step ${step} (condition not met)`
          );
        }
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

        // 仅 ASR 为固定基础能力（fail-closed）；增强步骤在 step 内 skip，不 abort 主链
        if (step === 'ASR') {
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

  finalizeSessionTurn(job, ctx, services.nodeId ?? '');
  collectReplayPatchProposal(job, ctx);

  return buildJobResult(job, ctx);
}
