/**
 * Phonetic correction (5016).
 *
 * FW mainline freeze:
 * - Default OFF (features.phoneticCorrection.enabled=false).
 * - Skipped when isSegmentWriteLocked (FW apply) — must not override segmentForJobResult.
 * - Optional enhancement after aggregation; not FW Lexicon recall/rerank.
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import logger from '../../logger';
import { getPhoneticCorrectionUrl, isPhoneticCorrectionEnabled } from '../../node-config';
import { withGpuLease } from '../../gpu-arbiter';
import { isSegmentWriteLocked } from '../post-asr-routing';
import {
  checkEnhancementService,
  ENHANCEMENT_SERVICE_IDS,
  markPhoneticCorrectionApplied,
  markPhoneticCorrectionSkipped,
} from '../enhancement-gate';

const REQUEST_TIMEOUT_MS = 10000;

export async function runPhoneticCorrectionStep(
  job: JobAssignMessage,
  ctx: JobContext,
  _services: ServicesBundle
): Promise<void> {
  const segment = (ctx.segmentForJobResult ?? '').trim();
  if (segment.length === 0) {
    return;
  }

  if (isSegmentWriteLocked(ctx)) {
    markPhoneticCorrectionSkipped(ctx, 'RECOVER_WRITE_LOCKED');
    logger.info(
      { jobId: job.job_id },
      'Phonetic correction skipped: Recover write lock'
    );
    return;
  }

  const gate = checkEnhancementService(
    ENHANCEMENT_SERVICE_IDS.PHONETIC,
    isPhoneticCorrectionEnabled(job) && ctx.shouldRunPhoneticCorrection === true
  );
  if (!gate.shouldRun) {
    markPhoneticCorrectionSkipped(ctx, gate.skipReason || 'DISABLED');
    logger.info(
      { jobId: job.job_id, skipReason: gate.skipReason },
      'Phonetic correction skipped (enhancement gate)'
    );
    return;
  }

  const srcLang = job.src_lang === 'auto' ? (ctx.detectedSourceLang ?? 'zh') : job.src_lang;
  const trace = {
    jobId: job.job_id,
    sessionId: job.session_id,
    utteranceIndex: job.utterance_index,
    stage: 'PHONETIC_CORRECTION' as const,
  };
  const stepStartMs = Date.now();

  try {
    await withGpuLease('PHONETIC_CORRECTION', async () => {
      const baseUrl = getPhoneticCorrectionUrl().replace(/\/$/, '');
      const url = `${baseUrl}/correct`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const httpStartMs = Date.now();

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text_in: segment, lang: srcLang }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const httpMs = Date.now() - httpStartMs;

      if (!response.ok) {
        throw new Error(`Phonetic correction failed: HTTP ${response.status}`);
      }

      const data = (await response.json()) as { text_out?: string; process_time_ms?: number };
      if (typeof data?.text_out !== 'string') {
        throw new Error('Phonetic correction invalid response: missing text_out');
      }
      ctx.segmentForJobResult = data.text_out;
      markPhoneticCorrectionApplied(ctx, Date.now() - stepStartMs, httpMs);
      logger.info(
        {
          job_id: job.job_id,
          lang: srcLang,
          changed: data.text_out !== segment,
          step_ms: ctx.phoneticCorrectionStepMs,
          http_ms: ctx.phoneticCorrectionHttpMs,
        },
        'Phonetic correction step done'
      );
    }, trace);
  } catch (error: any) {
    markPhoneticCorrectionSkipped(ctx, 'SERVICE_ERROR', { degraded: true });
    logger.warn(
      { jobId: job.job_id, error: error.message },
      'Phonetic correction unavailable, continuing with original segment'
    );
  }
}
