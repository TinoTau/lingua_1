/**
 * 断句步骤（5017）：gate → GPU lease → HTTP；不可用则 skip
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import logger from '../../logger';
import { getPunctuationRestoreUrl, isPunctuationRestoreEnabled } from '../../node-config';
import { withGpuLease } from '../../gpu-arbiter';
import {
  checkEnhancementService,
  ENHANCEMENT_SERVICE_IDS,
  markPunctuationRestoreApplied,
  markPunctuationRestoreSkipped,
} from '../enhancement-gate';

const REQUEST_TIMEOUT_MS = 10000;

export async function runPunctuationRestoreStep(
  job: JobAssignMessage,
  ctx: JobContext,
  _services: ServicesBundle
): Promise<void> {
  const segment = (ctx.segmentForJobResult ?? '').trim();
  if (segment.length === 0) {
    return;
  }

  const gate = checkEnhancementService(
    ENHANCEMENT_SERVICE_IDS.PUNCTUATION,
    isPunctuationRestoreEnabled() && ctx.shouldRunPunctuationRestore === true
  );
  if (!gate.shouldRun) {
    markPunctuationRestoreSkipped(ctx, gate.skipReason || 'DISABLED');
    logger.info(
      { jobId: job.job_id, skipReason: gate.skipReason },
      'Punctuation restore skipped (enhancement gate)'
    );
    return;
  }

  const srcLang = job.src_lang === 'auto' ? (ctx.detectedSourceLang ?? 'zh') : job.src_lang;
  const trace = {
    jobId: job.job_id,
    sessionId: job.session_id,
    utteranceIndex: job.utterance_index,
    stage: 'PUNCTUATION_RESTORE' as const,
  };
  const stepStartMs = Date.now();

  try {
    await withGpuLease('PUNCTUATION_RESTORE', async () => {
      const baseUrl = getPunctuationRestoreUrl().replace(/\/$/, '');
      const url = `${baseUrl}/punc`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const httpStartMs = Date.now();

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: segment, lang: srcLang }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const httpMs = Date.now() - httpStartMs;

      if (!response.ok) {
        throw new Error(`Punctuation restore failed: HTTP ${response.status}`);
      }

      const data = (await response.json()) as { text?: string };
      if (typeof data?.text !== 'string') {
        throw new Error('Punctuation restore invalid response: missing text');
      }
      ctx.segmentForJobResult = data.text;
      markPunctuationRestoreApplied(ctx, Date.now() - stepStartMs, httpMs);
      logger.info(
        { job_id: job.job_id, lang: srcLang, step_ms: ctx.punctuationRestoreStepMs },
        'Punctuation restore step done'
      );
    }, trace);
  } catch (error: any) {
    markPunctuationRestoreSkipped(ctx, 'SERVICE_ERROR', { degraded: true });
    logger.warn(
      { jobId: job.job_id, error: error.message },
      'Punctuation restore unavailable, continuing with original segment'
    );
  }
}
