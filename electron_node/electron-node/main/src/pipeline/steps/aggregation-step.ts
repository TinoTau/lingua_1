/**
 * runAggregationStep - 聚合步骤
 * 调用 AggregationStage 进行文本聚合
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import { AggregationStage } from '../../agent/postprocess/aggregation-stage';
import { JobResult } from '../../inference/inference-service';
import { applyPostAggregationRouting } from '../post-asr-routing';
import logger from '../../logger';

export async function runAggregationStep(
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle
): Promise<void> {
  if (!ctx.asrText || ctx.asrText.trim().length === 0) {
    ctx.segmentForJobResult = '';
    ctx.repairedText = '';
    applyPostAggregationRouting(job, ctx, {
      segmentReady: false,
      wantsPostAsrPipeline: false,
      deferTranslation: true,
    });
    return;
  }

  if (!services.aggregatorManager) {
    ctx.segmentForJobResult = ctx.asrText;
    ctx.aggregationChanged = false;
    applyPostAggregationRouting(job, ctx, {
      segmentReady: true,
      wantsPostAsrPipeline: true,
    });
    return;
  }

  const turnId = (job as any).turn_id as string | undefined;
  const isTurnFinalize = !!(job as any).is_manual_cut || (job as any).is_timeout_triggered;

  if (turnId && !isTurnFinalize) {
    services.aggregatorManager.appendTurnSegment(job.session_id, turnId, ctx.asrText || '');
    ctx.segmentForJobResult = ctx.asrText || '';
    ctx.lastCommittedText = null;
    applyPostAggregationRouting(job, ctx, {
      segmentReady: true,
      wantsPostAsrPipeline: false,
      deferTranslation: true,
    });
    logger.info(
      { jobId: job.job_id, sessionId: job.session_id, turnId },
      'runAggregationStep: Turn segment accumulated, waiting for finalize'
    );
    return;
  }

  const tempResult: JobResult = {
    text_asr: ctx.asrText || '',
    text_translated: '',
    tts_audio: '',
    extra: {
      language_probability: ctx.asrResult?.language_probability || null,
      language_probabilities: ctx.languageProbabilities || null,
    },
    quality_score: ctx.qualityScore,
    segments: ctx.asrSegments,
  };

  let sourceLang = job.src_lang;
  if (job.src_lang === 'auto' && ctx.detectedSourceLang) {
    sourceLang = ctx.detectedSourceLang;
    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        originalSrcLang: job.src_lang,
        detectedSrcLang: ctx.detectedSourceLang,
      },
      'runAggregationStep: Two-way mode - using detected source language'
    );
  } else if (job.src_lang === 'auto' && job.lang_a) {
    sourceLang = job.lang_a;
  }

  const jobWithDetectedLang = { ...job, src_lang: sourceLang };

  let lastCommittedText: string | null = null;
  if (services.aggregatorManager) {
    lastCommittedText = services.aggregatorManager.getLastCommittedText(
      job.session_id,
      job.utterance_index
    ) || null;
  }
  ctx.lastCommittedText = lastCommittedText ?? null;

  const aggregationStage = new AggregationStage(
    services.aggregatorManager,
    services.deduplicationHandler || null
  );

  const aggregationResult = aggregationStage.process(jobWithDetectedLang as any, tempResult, lastCommittedText);

  ctx.aggregationAction = aggregationResult.action;
  ctx.aggregationChanged = aggregationResult.aggregationChanged;
  ctx.isLastInMergedGroup = aggregationResult.isLastInMergedGroup;
  ctx.aggregationMetrics = aggregationResult.metrics;

  if (turnId && isTurnFinalize) {
    const accumulated = services.aggregatorManager.getAndClearTurnAccumulator(job.session_id, turnId);
    const fullTurnText = accumulated
      ? `${accumulated} ${(aggregationResult.segmentForJobResult || ctx.asrText || '').trim()}`.trim()
      : (aggregationResult.segmentForJobResult || ctx.asrText || '').trim();
    ctx.segmentForJobResult = fullTurnText;
    applyPostAggregationRouting(job, ctx, {
      segmentReady: fullTurnText.length > 0,
      wantsPostAsrPipeline: aggregationResult.shouldSendToSemanticRepair === true,
    });
  } else {
    ctx.segmentForJobResult = aggregationResult.segmentForJobResult;
    applyPostAggregationRouting(job, ctx, {
      segmentReady: (aggregationResult.segmentForJobResult ?? '').trim().length > 0,
      wantsPostAsrPipeline: aggregationResult.shouldSendToSemanticRepair === true,
    });
  }

  logger.info(
    {
      jobId: job.job_id,
      sessionId: job.session_id,
      utteranceIndex: job.utterance_index,
      segmentLength: (ctx.segmentForJobResult || '').length,
      shouldDeferTranslation: ctx.shouldDeferTranslation,
      shouldAllowTranslation: ctx.shouldAllowTranslation,
      shouldRunSemanticRepairHttp: ctx.shouldRunSemanticRepairHttp,
      action: ctx.aggregationAction,
    },
    'runAggregationStep: Aggregation completed'
  );
}
