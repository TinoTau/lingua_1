/**
 * runAggregationStep - 聚合步骤
 * 调用 AggregationStage 进行文本聚合
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import { AggregationStage } from '../../agent/postprocess/aggregation-stage';
import { JobResult } from '../../inference/inference-service';
import logger from '../../logger';

export async function runAggregationStep(
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle
): Promise<void> {
  // 如果 ASR 文本为空，跳过聚合
  if (!ctx.asrText || ctx.asrText.trim().length === 0) {
    ctx.aggregatedText = '';
    return;
  }

  // 如果没有 AggregatorManager，直接使用 ASR 文本
  if (!services.aggregatorManager) {
    ctx.aggregatedText = ctx.asrText;
    ctx.aggregationChanged = false;
    return;
  }

  // 创建临时 JobResult 用于聚合
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

  // 创建 AggregationStage
  const aggregationStage = new AggregationStage(
    services.aggregatorManager,
    services.aggregatorMiddleware || null,
    services.deduplicationHandler || null
  );

  // 执行聚合
  const aggregationResult = aggregationStage.process(job, tempResult);

  // 更新 JobContext
  ctx.aggregatedText = aggregationResult.aggregatedText;
  ctx.aggregationAction = aggregationResult.action;
  ctx.aggregationChanged = aggregationResult.aggregationChanged;
  ctx.isLastInMergedGroup = aggregationResult.isLastInMergedGroup;
  ctx.aggregationMetrics = aggregationResult.metrics;

  logger.info(
    {
      jobId: job.job_id,
      sessionId: job.session_id,
      utteranceIndex: job.utterance_index,
      aggregatedTextLength: ctx.aggregatedText.length,
      originalTextLength: ctx.asrText?.length || 0,
      action: ctx.aggregationAction,
      aggregationChanged: ctx.aggregationChanged,
    },
    'runAggregationStep: Aggregation completed'
  );
}
