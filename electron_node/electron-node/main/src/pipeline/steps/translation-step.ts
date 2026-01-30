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

  // 未走语义修复（HOLD 等）的 job 不调用 NMT/TTS，保证只有「合并长句」才进入翻译
  if (ctx.shouldSendToSemanticRepair === false) {
    ctx.translatedText = '';
    return;
  }

  // 翻译只用语义修复/聚合产出的 repairedText（不兼容回退；未送语义修复时由 aggregation-step 写入 repairedText）
  const textToTranslate = (ctx.repairedText ?? '').trim();
  if (!textToTranslate && (ctx.segmentForJobResult ?? '').trim().length > 0) {
    logger.warn(
      { jobId: job.job_id, sessionId: job.session_id },
      'runTranslationStep: ctx.repairedText empty but segmentForJobResult set, aggregation/semantic-repair should set repairedText'
    );
  }
  if (textToTranslate.trim().length === 0) {
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

  // 双向模式：使用动态确定的源语言和目标语言（如果已确定）
  // NMT（M2M100）只支持 ISO 639-1 语言代码（如 zh、en），不支持 "auto"，必须在此处落定具体语言
  let sourceLang = job.src_lang;
  if (job.src_lang === 'auto' && ctx.detectedSourceLang) {
    sourceLang = ctx.detectedSourceLang;
  } else if (job.src_lang === 'auto' && job.lang_a) {
    sourceLang = job.lang_a;
  }

  let targetLang = ctx.detectedTargetLang || job.tgt_lang;
  if (targetLang === 'auto' && job.lang_b) {
    targetLang = job.lang_b;
  }

  if (ctx.detectedSourceLang || ctx.detectedTargetLang) {
    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        originalSrcLang: job.src_lang,
        originalTgtLang: job.tgt_lang,
        detectedSrcLang: ctx.detectedSourceLang,
        detectedTgtLang: ctx.detectedTargetLang,
        finalSrcLang: sourceLang,
        finalTgtLang: targetLang,
      },
      'runTranslationStep: Two-way mode - using detected source and target language'
    );
  }

  // 创建修改后的 job 对象（使用动态源语言和目标语言）
  const jobWithDetectedLang = {
    ...job,
    src_lang: sourceLang,
    tgt_lang: targetLang,
  };

  // 创建 TranslationStage
  const translationStage = new TranslationStage(
    services.taskRouter,
    services.aggregatorManager || null,
    {}
  );

  // 执行翻译
  try {
    const translationResult = await translationStage.process(
      jobWithDetectedLang as any,
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
