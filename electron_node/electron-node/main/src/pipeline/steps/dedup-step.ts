/**
 * runDedupStep - 去重步骤
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
  const finalText = (ctx.segmentForJobResult ?? '').trim();
  if (!finalText) {
    logger.warn(
      { jobId: job.job_id, sessionId: job.session_id },
      'runDedupStep: ctx.segmentForJobResult empty'
    );
  }

  if (!services.dedupStage) {
    services.dedupStage = new DedupStage();
  }

  const dedupResult = services.dedupStage.process(job, finalText, ctx.translatedText ?? '');

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
