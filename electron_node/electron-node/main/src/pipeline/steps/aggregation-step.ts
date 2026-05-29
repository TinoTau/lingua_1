/**
 * runAggregationStep - 聚合步骤
 * 调用 AggregationStage 进行文本聚合
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import { AggregationStage } from '../../agent/postprocess/aggregation-stage';
import { JobResult } from '../../inference/inference-service';
import { completeAggregation } from '../complete-aggregation';
import { isFwDetectorEngineEnabled } from '../../fw-detector/fw-mode';
import logger from '../../logger';

function postDetectorSegment(ctx: JobContext): string {
  if (!isFwDetectorEngineEnabled()) {
    return (ctx.asrText ?? '').trim();
  }
  return (
    ctx.repairedText ??
    ctx.segmentForJobResult ??
    ctx.rawAsrText ??
    ctx.asrText ??
    ''
  ).trim();
}

export async function runAggregationStep(
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle
): Promise<void> {
  const detectorSegment = postDetectorSegment(ctx);
  if (!ctx.asrText?.trim() && !detectorSegment) {
    ctx.segmentForJobResult = '';
    ctx.repairedText = '';
    completeAggregation(job, ctx, {
      segmentReady: false,
      wantsPostAsrPipeline: false,
      deferTranslation: true,
    });
    return;
  }

  if (!services.aggregatorManager) {
    ctx.segmentForJobResult = detectorSegment || ctx.asrText || '';
    ctx.aggregationChanged = false;
    completeAggregation(job, ctx, {
      segmentReady: true,
      wantsPostAsrPipeline: true,
    });
    return;
  }

  const turnId = (job as any).turn_id as string | undefined;
  const isTurnFinalize = !!(job as any).is_manual_cut || (job as any).is_timeout_triggered;

  if (turnId && !isTurnFinalize) {
    const turnSegment = detectorSegment || ctx.asrText || '';
    services.aggregatorManager.appendTurnSegment(job.session_id, turnId, turnSegment);
    ctx.segmentForJobResult = turnSegment;
    ctx.lastCommittedText = null;
    completeAggregation(job, ctx, {
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
    text_asr: detectorSegment || ctx.asrText || '',
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
    const segmentPart = (
      aggregationResult.segmentForJobResult || detectorSegment || ctx.asrText || ''
    ).trim();
    const fullTurnText = accumulated
      ? `${accumulated} ${segmentPart}`.trim()
      : segmentPart;
    ctx.segmentForJobResult = fullTurnText;
    completeAggregation(job, ctx, {
      segmentReady: fullTurnText.length > 0,
      wantsPostAsrPipeline: aggregationResult.shouldSendToSemanticRepair === true,
    });
  } else {
    ctx.segmentForJobResult = aggregationResult.segmentForJobResult;
    completeAggregation(job, ctx, {
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
