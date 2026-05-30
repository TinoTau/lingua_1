/**
 * JobPipeline - ?????
 * ???????????? Pipeline ?????????????? if/else
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobResult, PartialResultCallback } from '../inference/inference-service';
import { JobContext, initJobContext } from './context/job-context';
import logger from '../logger';
import { buildJobResult } from './result-builder';
import { inferPipelineMode, shouldExecuteStep } from './pipeline-mode-config';
import { getLexiconRecallSkipReason } from '../node-config';
import { stampRecoverPipelineSkip } from '../legacy/recover/legacy-recover-contract';
import { executeStep } from './pipeline-step-registry';
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
  dedupStage?: any;
  resultSender?: any;
  audioAggregator?: any;
  semanticRepairInitializer?: any;
  /** LID v1 */
  lidEngine?: any;
  /** LID Router: RoomStateStore + selectSrcLang */
  lidRouter?: { store: any; select: any };
}

export interface JobPipelineOptions {
  job: JobAssignMessage;
  partialCallback?: PartialResultCallback;
  asrCompletedCallback?: (done: boolean) => void;
  services: ServicesBundle;
  ctx?: JobContext;
  callbacks?: {
    onTaskStart?: () => void;
    onTaskEnd?: () => void;
    onTaskProcessed?: (serviceName: string) => void;
  };
}

/**
 * ?? JobPipeline???????
 */
export async function runJobPipeline(options: JobPipelineOptions): Promise<JobResult> {
  const { job, partialCallback, asrCompletedCallback, services, ctx: providedCtx, callbacks } = options;

  const ctx = providedCtx || initJobContext(job);

  if (job.session_id?.trim()) {
    const intentSchedulingEnabled = (job as { lexicon_v2_intent_enabled?: boolean }).lexicon_v2_intent_enabled !== false;
    beginSessionTurnProfile(job, ctx, services.nodeId ?? '', { intentSchedulingEnabled });
  }

  callbacks?.onTaskStart?.();

  try {
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

    const skipASR = providedCtx !== undefined && providedCtx.asrText !== undefined;

    for (const step of mode.steps) {
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
        const stepOptions = step === 'ASR' ? {
          partialCallback,
          asrCompletedCallback,
        } : undefined;

        await executeStep(step, job, ctx, services, stepOptions);

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

        if (step === 'ASR') {
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
    callbacks?.onTaskEnd?.();
  }

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
