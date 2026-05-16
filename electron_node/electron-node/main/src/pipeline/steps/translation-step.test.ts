/**
 * runTranslationStep 单元测试
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

  it('shouldDeferTranslation 为 true 时跳过翻译', async () => {
    const ctx: JobContext = {
      segmentForJobResult: '有内容',
      repairedText: '有内容',
      shouldDeferTranslation: true,
      shouldAllowTranslation: false,
    };
    await runTranslationStep(job, ctx, services);
    expect(ctx.translatedText).toBe('');
  });

  it('shouldAllowTranslation 且有文本时尝试翻译（无 mock stage 则失败置空）', async () => {
    const ctx: JobContext = {
      repairedText: '你好',
      shouldAllowTranslation: true,
      shouldDeferTranslation: false,
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
