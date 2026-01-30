/**
 * runTranslationStep 单元测试
 * 验证：未走语义修复时跳过 NMT（ctx.translatedText = '' 并 return）
 */

import { runTranslationStep } from './translation-step';
import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';

describe('runTranslationStep', () => {
  const job: JobAssignMessage = {
    job_id: 'job-1',
    session_id: 's1',
    utterance_index: 0,
    src_lang: 'zh',
    tgt_lang: 'en',
  } as JobAssignMessage;

  const services: ServicesBundle = { taskRouter: {} } as ServicesBundle;

  it('shouldSendToSemanticRepair 为 false 时跳过翻译，ctx.translatedText 置空', async () => {
    const ctx: JobContext = {
      segmentForJobResult: '有内容',
      shouldSendToSemanticRepair: false,
    };
    await runTranslationStep(job, ctx, services);
    expect(ctx.translatedText).toBe('');
  });

  it('shouldSend 为 false 时直接 return', async () => {
    const ctx: JobContext = { shouldSend: false };
    await runTranslationStep(job, ctx, services);
    expect(ctx.shouldSend).toBe(false);
  });
});
