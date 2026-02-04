/**
 * 断句步骤：对本段调用断句服务，结果写回 ctx.segmentForJobResult。
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import logger from '../../logger';
import { getPunctuationRestoreUrl } from '../../node-config';
import { withGpuLease } from '../../gpu-arbiter';

const REQUEST_TIMEOUT_MS = 10000;

export async function runPunctuationRestoreStep(
  job: JobAssignMessage,
  ctx: JobContext,
  _services: ServicesBundle
): Promise<void> {
  const segment = (ctx.segmentForJobResult ?? '').trim();
  if (segment.length === 0) return;

  const srcLang = job.src_lang === 'auto' ? (ctx.detectedSourceLang ?? 'zh') : job.src_lang;
  const trace = {
    jobId: job.job_id,
    sessionId: job.session_id,
    utteranceIndex: job.utterance_index,
    stage: 'PUNCTUATION_RESTORE',
  };

  await withGpuLease('PUNCTUATION_RESTORE', async () => {
    const baseUrl = getPunctuationRestoreUrl().replace(/\/$/, '');
    const url = `${baseUrl}/punc`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: segment, lang: srcLang }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Punctuation restore failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as { text?: string };
    if (typeof data?.text !== 'string') {
      throw new Error('Punctuation restore invalid response: missing text');
    }
    ctx.segmentForJobResult = data.text;
    logger.info(
      {
        job_id: job.job_id,
        lang: srcLang,
        text_preview: data.text.length > 80 ? `${data.text.slice(0, 80)}…` : data.text,
      },
      'Punctuation restore step done'
    );
  }, trace);
}
