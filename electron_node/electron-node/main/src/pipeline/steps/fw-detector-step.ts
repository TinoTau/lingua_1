import type { JobAssignMessage } from '@shared/protocols/messages';
import type { JobContext } from '../context/job-context';
import { applyFwDetectorJobOverrides } from '../../fw-detector/fw-job-overrides';
import { runFwDetectorOrchestrator } from '../../fw-detector/fw-detector-orchestrator';
import {
  getFwDetectorFeatureEnabled,
  isFwDetectorPipelineActive,
} from '../../fw-detector/fw-mode';
import logger from '../../logger';

function syncBaselineFromRaw(ctx: JobContext): void {
  ctx.segmentForJobResult = (ctx.rawAsrText ?? ctx.asrText ?? '').trim();
}

export async function runFwDetectorStep(
  job: JobAssignMessage,
  ctx: JobContext
): Promise<void> {
  if (!getFwDetectorFeatureEnabled()) {
    syncBaselineFromRaw(ctx);
    ctx.fwDetectorResult = {
      enabled: false,
      triggered: false,
      reason: 'disabled',
      configSnapshot: {},
      spans: [],
    };
    return;
  }

  if (!isFwDetectorPipelineActive(job, ctx)) {
    syncBaselineFromRaw(ctx);
    ctx.fwDetectorResult = {
      enabled: true,
      triggered: false,
      reason: 'language_not_supported',
      configSnapshot: {},
      spans: [],
    };
    logger.info({ jobId: job.job_id }, '[FW_SPAN_DETECTOR] skipped language');
    return;
  }

  applyFwDetectorJobOverrides(job, ctx);
  const result = await runFwDetectorOrchestrator(ctx);
  logger.info(
    {
      jobId: job.job_id,
      triggered: result.triggered,
      spanCount: result.spans.length,
      appliedCount: result.spans.filter((s) => s.applied).length,
      reason: result.reason,
    },
    '[FW_SPAN_DETECTOR] completed'
  );
}
