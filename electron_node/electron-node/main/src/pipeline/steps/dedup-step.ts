/**
 * runDedupStep - 去重步骤
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import { DedupStage } from '../../agent/postprocess/dedup-stage';
import { sanitizeSegmentForOutput } from '../../aggregator/dedup';
import logger from '../../logger';

export async function runDedupStep(
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle
): Promise<void> {
  const beforeText = ctx.segmentForJobResult ?? '';
  const { text: sanitizedText, trace } = sanitizeSegmentForOutput(beforeText);

  ctx.segmentForJobResult = sanitizedText;
  ctx.duplicateSanitizeApplied = trace.applied;
  ctx.duplicateSanitizeTrace = trace;

  if (!sanitizedText) {
    logger.warn(
      { jobId: job.job_id, sessionId: job.session_id, duplicateSanitize: trace },
      'runDedupStep: ctx.segmentForJobResult empty after duplicate sanitize'
    );
  }

  if (!services.dedupStage) {
    services.dedupStage = new DedupStage();
  }

  const dedupResult = services.dedupStage.process(job, sanitizedText, ctx.translatedText ?? '');

  ctx.shouldSend = dedupResult.shouldSend;
  ctx.dedupReason = dedupResult.reason;

  logger.info(
    {
      jobId: job.job_id,
      sessionId: job.session_id,
      utteranceIndex: job.utterance_index,
      shouldSend: ctx.shouldSend,
      dedupReason: ctx.dedupReason,
      duplicateSanitizeApplied: trace.applied,
      duplicateSanitizeRule: trace.rule,
    },
    trace.applied
      ? 'runDedupStep: duplicate sanitize applied, deduplication check completed'
      : 'runDedupStep: Deduplication check completed'
  );
}
