/**
 * runSemanticRepairStep - 语义修复步骤（5015 热插拔：不可用则 skip，不阻断主链）
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import {
  isSegmentWriteLocked,
  markSemanticRepairHttpSuccess,
  markSemanticRepairSkipped,
} from '../post-asr-routing';
import {
  checkEnhancementService,
  ENHANCEMENT_SERVICE_IDS,
} from '../enhancement-gate';
import { isSemanticRepairEnabled } from '../../node-config';
import logger from '../../logger';

export async function runSemanticRepairStep(
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle
): Promise<void> {
  const textToRepair = (ctx.segmentForJobResult ?? '').trim();
  if (textToRepair.length === 0) {
    ctx.segmentForJobResult = '';
    return;
  }

  const gate = checkEnhancementService(
    ENHANCEMENT_SERVICE_IDS.SEMANTIC,
    isSemanticRepairEnabled(job) && ctx.shouldRunSemanticRepairHttp === true
  );
  if (!gate.shouldRun) {
    markSemanticRepairSkipped(ctx, gate.skipReason || 'SERVICE_NOT_RUNNING', {
      fallbackText: textToRepair,
    });
    logger.info(
      { jobId: job.job_id, skipReason: gate.skipReason },
      'runSemanticRepairStep: skipped (enhancement gate)'
    );
    return;
  }

  if (!services.semanticRepairInitializer) {
    markSemanticRepairSkipped(ctx, 'INITIALIZER_MISSING', { fallbackText: textToRepair });
    logger.warn({ jobId: job.job_id }, 'runSemanticRepairStep: initializer missing, skipped');
    return;
  }

  const semanticRepairInitializer = services.semanticRepairInitializer;

  if (!semanticRepairInitializer.isInitialized()) {
    try {
      await semanticRepairInitializer.initialize();
    } catch (error: any) {
      markSemanticRepairSkipped(ctx, 'INITIALIZE_FAILED', {
        degraded: true,
        fallbackText: textToRepair,
      });
      logger.warn(
        { error: error.message, jobId: job.job_id },
        'runSemanticRepairStep: initialize failed, skipped'
      );
      return;
    }
  }

  const semanticRepairStage = semanticRepairInitializer.getSemanticRepairStage();
  if (!semanticRepairStage) {
    markSemanticRepairSkipped(ctx, 'STAGE_NOT_AVAILABLE', { fallbackText: textToRepair });
    logger.warn({ jobId: job.job_id }, 'runSemanticRepairStep: stage not available, skipped');
    return;
  }

  let microContext: string | undefined;
  const lastCommittedText: string | null = ctx.lastCommittedText ?? null;
  if (lastCommittedText && lastCommittedText.trim().length > 0) {
    const trimmedContext = lastCommittedText.trim();
    microContext =
      trimmedContext.length > 150
        ? trimmedContext.substring(trimmedContext.length - 150)
        : trimmedContext;
  }

  let sourceLang = job.src_lang;
  if (job.src_lang === 'auto' && ctx.detectedSourceLang) {
    sourceLang = ctx.detectedSourceLang;
  }

  const jobWithDetectedLang = { ...job, src_lang: sourceLang };

  try {
    const repairResult = await semanticRepairStage.process(
      jobWithDetectedLang as any,
      textToRepair,
      ctx.qualityScore,
      {
        segments: ctx.asrSegments,
        language_probability: ctx.asrResult?.language_probability,
        micro_context: microContext,
      }
    );

    if (repairResult.skipped) {
      markSemanticRepairSkipped(ctx, repairResult.skipReason || 'SKIPPED', {
        degraded: repairResult.degraded,
        fallbackText: textToRepair,
      });
      return;
    }

    if (repairResult.decision === 'REPAIR' || repairResult.decision === 'PASS') {
      if (repairResult.semanticRepairHttpApplied) {
        markSemanticRepairHttpSuccess(ctx, repairResult.textOut, repairResult.confidence);
      } else if (!isSegmentWriteLocked(ctx)) {
        ctx.segmentForJobResult = repairResult.textOut;
        ctx.semanticRepairApplied = false;
        ctx.semanticRepairHttpApplied = false;
        ctx.semanticRepairHttpCalled = repairResult.semanticRepairHttpCalled === true;
        ctx.enNormalizeApplied = repairResult.enNormalizeApplied === true;
      } else {
        ctx.semanticRepairSkipped = true;
        ctx.semanticRepairSkipReason = 'SEGMENT_WRITE_LOCKED';
        ctx.semanticRepairHttpCalled = repairResult.semanticRepairHttpCalled === true;
        ctx.semanticRepairHttpApplied = false;
        ctx.semanticRepairApplied = false;
      }
      ctx.semanticDecision = repairResult.decision;

      const segmentAfterRepair = (ctx.segmentForJobResult ?? '').trim();
      if (services.aggregatorManager && segmentAfterRepair && !isSegmentWriteLocked(ctx)) {
        services.aggregatorManager.updateLastCommittedTextAfterRepair(
          job.session_id,
          job.utterance_index,
          textToRepair,
          segmentAfterRepair
        );
      }
    } else if (repairResult.decision === 'REJECT') {
      if (!isSegmentWriteLocked(ctx)) {
        ctx.segmentForJobResult = textToRepair;
      }
      ctx.semanticDecision = 'REJECT';
      ctx.semanticRepairApplied = false;
    }
  } catch (error: any) {
    markSemanticRepairSkipped(ctx, 'SERVICE_ERROR', {
      degraded: true,
      fallbackText: textToRepair,
    });
    logger.error(
      { error: error.message, jobId: job.job_id },
      'runSemanticRepairStep: semantic repair failed, skipped with fallback text'
    );
  }
}
