/**
 * runDedupStep - 去重步骤
 * 基于 job_id 进行去重检查
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import { DedupStage } from '../../agent/postprocess/dedup-stage';
import logger from '../../logger';

export async function runDedupStep(
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle
): Promise<void> {
  // 获取最终文本（优先使用修复后的文本，然后是聚合后的文本，最后是 ASR 文本）
  const finalText = ctx.repairedText || ctx.aggregatedText || ctx.asrText || '';

  // 使用全局 DedupStage 实例（应该已经在 InferenceService 中初始化）
  if (!services.dedupStage) {
    const { DedupStage } = require('../../agent/postprocess/dedup-stage');
    services.dedupStage = new DedupStage();
  }

  // 执行去重检查
  const dedupResult = services.dedupStage.process(job, finalText, ctx.translatedText || '');

  // 更新 JobContext
  ctx.shouldSend = dedupResult.shouldSend;
  ctx.dedupReason = dedupResult.reason;

  logger.info(
    {
      jobId: job.job_id,
      sessionId: job.session_id,
      utteranceIndex: job.utterance_index,
      shouldSend: ctx.shouldSend,
      dedupReason: ctx.dedupReason,
    },
    'runDedupStep: Deduplication check completed'
  );
}
