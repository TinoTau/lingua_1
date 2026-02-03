/**
 * 同音纠错步骤：对本段调用同音纠错服务（中文纠错、英文直通），结果写回 ctx.segmentForJobResult。
 * 经 GPU 仲裁器串行化，与 ASR/NMT/语义修复等步骤统一排队执行。
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import logger from '../../logger';
import { getPhoneticCorrectionUrl } from '../../node-config';
import { withGpuLease } from '../../gpu-arbiter';

const REQUEST_TIMEOUT_MS = 10000;

export async function runPhoneticCorrectionStep(
  job: JobAssignMessage,
  ctx: JobContext,
  _services: ServicesBundle
): Promise<void> {
  const segment = (ctx.segmentForJobResult ?? '').trim();
  if (segment.length === 0) return;

  const srcLang = job.src_lang === 'auto' ? (ctx.detectedSourceLang ?? 'zh') : job.src_lang;
  const trace = { jobId: job.job_id, sessionId: job.session_id, utteranceIndex: job.utterance_index, stage: 'PHONETIC_CORRECTION' };

  await withGpuLease('PHONETIC_CORRECTION', async () => {
    const baseUrl = getPhoneticCorrectionUrl().replace(/\/$/, '');
    const url = `${baseUrl}/correct`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const stepStartMs = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text_in: segment, lang: srcLang }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Phonetic correction failed: HTTP ${response.status}`);
    }

    const data = await response.json() as { text_out?: string; process_time_ms?: number };
    if (typeof data?.text_out !== 'string') {
      throw new Error('Phonetic correction invalid response: missing text_out');
    }
    ctx.segmentForJobResult = data.text_out;
    const stepDurationMs = Date.now() - stepStartMs;
    const inPreview = segment.length > 80 ? `${segment.slice(0, 80)}…` : segment;
    const outPreview = data.text_out.length > 80 ? `${data.text_out.slice(0, 80)}…` : data.text_out;
    logger.info(
      {
        job_id: job.job_id,
        lang: srcLang,
        text_in_preview: inPreview,
        text_out_preview: outPreview,
        changed: data.text_out !== segment,
        step_duration_ms: stepDurationMs,
        service_process_time_ms: data.process_time_ms,
      },
      'Phonetic correction step done'
    );
  }, trace);
}
