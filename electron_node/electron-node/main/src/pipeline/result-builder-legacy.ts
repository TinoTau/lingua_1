/**
 * Non-FW engine result builder — legacy ASR repair observability in extra.
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobResult } from '../inference/inference-service';
import { JobContext } from './context/job-context';
import { buildLegacyAsrRepairResultExtra } from '../legacy/asr-repair/legacy-asr-repair-result-extra';
import { assembleJobResult, buildCoreResultExtra } from './result-builder-core';

export function buildLegacyJobResult(job: JobAssignMessage, ctx: JobContext): JobResult {
  const coreExtra = buildCoreResultExtra(job, ctx);
  const extra = buildLegacyAsrRepairResultExtra(job, ctx, coreExtra);
  return assembleJobResult(job, ctx, extra);
}
