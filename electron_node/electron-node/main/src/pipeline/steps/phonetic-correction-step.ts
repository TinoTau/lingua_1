/**
 * 同音/近音后处理步骤：在 AGGREGATION 之后、SEMANTIC_REPAIR 之前，
 * 用混淆集对 ctx.segmentForJobResult 做同音字纠错，写回同一字段供语义修复使用。
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import { correct } from '../../phonetic-correction';
import logger from '../../logger';

export async function runPhoneticCorrectionStep(
  job: JobAssignMessage,
  ctx: JobContext,
  _services: ServicesBundle
): Promise<void> {
  const segment = ctx.segmentForJobResult ?? '';
  if (segment.trim().length === 0) return;

  const corrected = correct(segment);
  if (corrected !== segment) {
    logger.info(
      { jobId: job.job_id, sessionId: job.session_id, before: segment.slice(0, 80), after: corrected.slice(0, 80) },
      'Phonetic correction applied'
    );
  }
  ctx.segmentForJobResult = corrected;
}
