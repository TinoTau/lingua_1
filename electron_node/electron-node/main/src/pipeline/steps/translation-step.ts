/**
 * runTranslationStep - 翻译步骤
 * 调用 TranslationStage 进行翻译
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import { TranslationStage } from '../../agent/postprocess/translation-stage';
import logger from '../../logger';

export async function runTranslationStep(
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle
): Promise<void> {
  // 如果去重检查失败，跳过翻译
  if (ctx.shouldSend === false) {
    return;
  }

  // 获取要翻译的文本（优先使用修复后的文本，然后是聚合后的文本）
  const textToTranslate = ctx.repairedText || ctx.aggregatedText || ctx.asrText || '';

  // 如果文本为空，跳过翻译
  if (!textToTranslate || textToTranslate.trim().length === 0) {
    ctx.translatedText = '';
    return;
  }

  // 检查是否需要翻译
  if (job.pipeline?.use_nmt === false) {
    ctx.translatedText = '';
    return;
  }

  // 如果没有 TaskRouter，跳过翻译
  if (!services.taskRouter) {
    logger.error(
      { jobId: job.job_id },
      'runTranslationStep: TaskRouter not available'
    );
    ctx.translatedText = '';
    return;
  }

  // 创建 TranslationStage
  const translationStage = new TranslationStage(
    services.taskRouter,
    services.aggregatorManager || null,
    {}
  );

  // 执行翻译
  try {
    const translationResult = await translationStage.process(
      job,
      textToTranslate,
      ctx.qualityScore,
      0, // dedupCharsRemoved
      {
        semanticRepairApplied: ctx.semanticRepairApplied || false,
        semanticRepairConfidence: ctx.semanticRepairConfidence,
      }
    );

    // 更新 JobContext
    ctx.translatedText = translationResult.translatedText;

    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        translatedTextLength: ctx.translatedText.length,
        fromCache: translationResult.fromCache,
      },
      'runTranslationStep: Translation completed'
    );
  } catch (error: any) {
    logger.error(
      {
        error: error.message,
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
      },
      'runTranslationStep: Translation failed'
    );
    ctx.translatedText = '';
  }
}
