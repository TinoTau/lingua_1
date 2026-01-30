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
  // 如果 ASR 文本为空，跳过聚合；仍写出本段与修复文本为空，供下游单一数据源
  if (!ctx.asrText || ctx.asrText.trim().length === 0) {
    ctx.segmentForJobResult = '';
    ctx.repairedText = '';
    return;
  }

  // 无聚合器：ASR 文本即本段，直接送语义修复
  if (!services.aggregatorManager) {
    ctx.segmentForJobResult = ctx.asrText;
    ctx.aggregationChanged = false;
    ctx.shouldSendToSemanticRepair = true;
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

  // 双向模式：使用动态确定的源语言
  // 创建修改后的 job 对象（使用检测到的源语言）
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
    // 如果还没有检测到源语言，使用 lang_a 作为默认值
    sourceLang = job.lang_a;
  }

  const jobWithDetectedLang = {
    ...job,
    src_lang: sourceLang,
  };

  // lastCommittedText 在此处为输入快照（只读），非最终写回点；最终权威写回在语义修复后 updateLastCommittedTextAfterRepair。
  let lastCommittedText: string | null = null;
  if (services.aggregatorManager) {
    lastCommittedText = services.aggregatorManager.getLastCommittedText(
      job.session_id,
      job.utterance_index
    ) || null;
  }
  ctx.lastCommittedText = lastCommittedText ?? null;

  // 创建 AggregationStage
  const aggregationStage = new AggregationStage(
    services.aggregatorManager,
    services.deduplicationHandler || null
  );

  // 执行聚合（传递缓存的 lastCommittedText，避免重复获取）
  const aggregationResult = aggregationStage.process(jobWithDetectedLang as any, tempResult, lastCommittedText);

  // 更新 JobContext
  ctx.segmentForJobResult = aggregationResult.segmentForJobResult;
  ctx.aggregationAction = aggregationResult.action;
  ctx.aggregationChanged = aggregationResult.aggregationChanged;
  ctx.isLastInMergedGroup = aggregationResult.isLastInMergedGroup;
  ctx.shouldSendToSemanticRepair = aggregationResult.shouldSendToSemanticRepair;
  ctx.aggregationMetrics = aggregationResult.metrics;
  if (aggregationResult.shouldSendToSemanticRepair === false) {
    ctx.repairedText = '';
  }

  logger.info(
    {
      jobId: job.job_id,
      sessionId: job.session_id,
      utteranceIndex: job.utterance_index,
      segmentLength: aggregationResult.aggregatedText.length,
      originalTextLength: ctx.asrText?.length || 0,
      action: ctx.aggregationAction,
      aggregationChanged: ctx.aggregationChanged,
    },
    'runAggregationStep: Aggregation completed'
  );
}
