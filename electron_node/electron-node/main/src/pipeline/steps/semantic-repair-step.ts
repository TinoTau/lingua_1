/**
 * runSemanticRepairStep - 语义修复步骤
 * 调用 SemanticRepairStage 进行语义修复。
 *
 * 设计契约（强制语义修复，失败即失败）：
 * - 本步骤为必经且必须成功；不可用/超时/异常由 stage/router throw，pipeline 将错误视为 job 失败并回传调度。
 * - 成功时 decision 为 REPAIR 或 PASS（服务端返回无修改时为 PASS），均写回 ctx；REJECT 保留原文。
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import { SemanticRepairInitializer } from '../../agent/postprocess/postprocess-semantic-repair-initializer';
import logger from '../../logger';

export async function runSemanticRepairStep(
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle
): Promise<void> {
  // 语义修复只读本 job 的本段（聚合步骤必填）；修完即为此 job 的 text_asr / NMT 输入
  const textToRepair = (ctx.segmentForJobResult ?? '').trim();
  if (textToRepair.length === 0) {
    ctx.repairedText = '';
    return;
  }

  // 设计：所有需发送的 ASR 结果必须经语义修复服务处理；不可用时不得透传原文，不发送该结果
  if (!services.servicesHandler || !services.semanticRepairInitializer) {
    logger.error(
      { jobId: job.job_id, hasServicesHandler: !!services.servicesHandler, hasSemanticRepairInitializer: !!services.semanticRepairInitializer },
      'runSemanticRepairStep: semantic repair required but initializer missing, not sending result'
    );
    ctx.repairedText = '';
    ctx.shouldSend = false;
    return;
  }

  const semanticRepairInitializer = services.semanticRepairInitializer;

  if (!semanticRepairInitializer.isInitialized()) {
    try {
      await semanticRepairInitializer.initialize();
    } catch (error: any) {
      logger.error(
        { error: error.message, jobId: job.job_id },
        'runSemanticRepairStep: semantic repair required but initialization failed, not sending result'
      );
      ctx.repairedText = '';
      ctx.shouldSend = false;
      return;
    }
  }

  const semanticRepairStage = semanticRepairInitializer.getSemanticRepairStage();
  if (!semanticRepairStage) {
    logger.error(
      { jobId: job.job_id },
      'runSemanticRepairStep: semantic repair required but stage not available, not sending result'
    );
    ctx.repairedText = '';
    ctx.shouldSend = false;
    return;
  }

  // 获取微上下文（上一句尾部）
  // 直接使用ctx.lastCommittedText（aggregation-step.ts总是设置值，即使是null）
  // null表示没有上一个已提交的文本，这是有效的状态
  let microContext: string | undefined = undefined;
  const lastCommittedText: string | null = ctx.lastCommittedText ?? null;
  if (lastCommittedText && lastCommittedText.trim().length > 0) {
    const trimmedContext = lastCommittedText.trim();
    microContext =
      trimmedContext.length > 150
        ? trimmedContext.substring(trimmedContext.length - 150)
        : trimmedContext;
  }

  // 双向模式：使用动态确定的源语言
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
      'runSemanticRepairStep: Two-way mode - using detected source language'
    );
  }

  const jobWithDetectedLang = {
    ...job,
    src_lang: sourceLang,
  };

  // 执行语义修复
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

    if (repairResult.decision === 'REPAIR' || repairResult.decision === 'PASS') {
      ctx.repairedText = repairResult.textOut;
      ctx.semanticDecision = repairResult.decision;
      ctx.semanticRepairApplied = repairResult.semanticRepairApplied || false;
      ctx.semanticRepairConfidence = repairResult.confidence;

      // committedText 的最终权威写点：仅语义修复阶段允许写回；聚合阶段 lastCommittedText 仅作输入快照。
      // 禁止在其它 step 再写 committedText，除非设计变更。
      if (services.aggregatorManager) {
        services.aggregatorManager.updateLastCommittedTextAfterRepair(
          job.session_id,
          job.utterance_index,
          textToRepair,
          ctx.repairedText
        );
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            decision: repairResult.decision,
            originalTextLength: textToRepair.length,
            repairedTextLength: ctx.repairedText?.length || 0,
            textChanged: ctx.repairedText !== textToRepair,
            note: 'Updated recentCommittedText after semantic repair (PASS or REPAIR)',
          },
          'runSemanticRepairStep: Updated recentCommittedText with repaired text'
        );
      }

      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          decision: repairResult.decision,
          confidence: repairResult.confidence,
          originalText: textToRepair.substring(0, 100),
          repairedText: ctx.repairedText?.substring(0, 100) || '',
          textChanged: ctx.repairedText !== textToRepair,
        },
        'runSemanticRepairStep: Semantic repair completed'
      );
    } else if (repairResult.decision === 'REJECT') {
      logger.warn(
        { jobId: job.job_id, reasonCodes: repairResult.reasonCodes },
        'runSemanticRepairStep: Semantic repair rejected text'
      );
      ctx.repairedText = textToRepair;
      ctx.semanticDecision = 'REJECT';
    } else {
      ctx.repairedText = textToRepair;
    }
  } catch (error: any) {
    logger.error(
      {
        error: error.message,
        stack: error.stack,
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
      },
      'runSemanticRepairStep: Semantic repair failed, using original text'
    );
    ctx.repairedText = textToRepair;
  }
}
