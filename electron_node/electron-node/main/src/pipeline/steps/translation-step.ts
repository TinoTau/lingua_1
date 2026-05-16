/**
 * runTranslationStep - 翻译步骤
 * 调用 TranslationStage 进行翻译
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import { TranslationStage } from '../../agent/postprocess/translation-stage';
import { getTextForTranslation } from '../post-asr-routing';
import logger from '../../logger';

export async function runTranslationStep(
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle
): Promise<void> {
  if (ctx.shouldSend === false) {
    return;
  }

  if (ctx.shouldDeferTranslation === true || ctx.shouldAllowTranslation !== true) {
    ctx.translatedText = '';
    return;
  }

  const textToTranslate = getTextForTranslation(ctx);
  if (textToTranslate.length === 0) {
    ctx.translatedText = '';
    return;
  }

  if (!services.taskRouter) {
    logger.error({ jobId: job.job_id }, 'runTranslationStep: TaskRouter not available');
    ctx.translatedText = '';
    return;
  }

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

  const jobWithDetectedLang = {
    ...job,
    src_lang: sourceLang,
    tgt_lang: targetLang,
  };

  const translationStage = new TranslationStage(
    services.taskRouter,
    services.aggregatorManager || null,
    {}
  );

  try {
    const translationResult = await translationStage.process(
      jobWithDetectedLang as any,
      textToTranslate,
      ctx.qualityScore,
      0,
      {
        semanticRepairApplied: ctx.semanticRepairHttpApplied === true,
        semanticRepairConfidence: ctx.semanticRepairConfidence,
      }
    );

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
      { error: error.message, jobId: job.job_id },
      'runTranslationStep: Translation failed'
    );
    ctx.translatedText = '';
  }
}
