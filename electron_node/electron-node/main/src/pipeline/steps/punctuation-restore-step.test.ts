/**
 * 断句步骤：确认中英文调用 /punc，结果写回 ctx.segmentForJobResult。
 */

jest.mock('../../gpu-arbiter', () => ({ withGpuLease: (_: string, fn: () => Promise<void>) => fn() }));

import { runPunctuationRestoreStep } from './punctuation-restore-step';
import { JobAssignMessage } from '@shared/protocols/messages';
import { initJobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';

const createJob = (srcLang: string = 'zh'): JobAssignMessage =>
  ({ job_id: 'job-1', session_id: 's1', utterance_index: 0, src_lang: srcLang, tgt_lang: 'en' } as JobAssignMessage);

describe('runPunctuationRestoreStep', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('中文且 segment 非空时调用 /punc 并将 text 写回 ctx.segmentForJobResult', async () => {
    const job = createJob('zh');
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '你好世界今天天气不错';

    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: '你好世界，今天天气不错。' }),
    });

    await runPunctuationRestoreStep(job, ctx, {} as ServicesBundle);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/punc'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: '你好世界今天天气不错', lang: 'zh' }),
      })
    );
    expect(ctx.segmentForJobResult).toBe('你好世界，今天天气不错。');
  });

  it('segment 为空时不请求、不修改 ctx', async () => {
    const job = createJob('zh');
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '';

    (globalThis as any).fetch = jest.fn();

    await runPunctuationRestoreStep(job, ctx, {} as ServicesBundle);

    expect(fetch).not.toHaveBeenCalled();
    expect(ctx.segmentForJobResult).toBe('');
  });

  it('英文时调用 /punc', async () => {
    const job = createJob('en');
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = 'hello world how are you';

    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'Hello world, how are you?' }),
    });

    await runPunctuationRestoreStep(job, ctx, {} as ServicesBundle);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/punc'),
      expect.objectContaining({
        body: JSON.stringify({ text: 'hello world how are you', lang: 'en' }),
      })
    );
    expect(ctx.segmentForJobResult).toBe('Hello world, how are you?');
  });

  it('服务返回非 OK 时抛错', async () => {
    const job = createJob('zh');
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '原文';

    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

    await expect(runPunctuationRestoreStep(job, ctx, {} as ServicesBundle)).rejects.toThrow(
      /Punctuation restore failed: HTTP 503/
    );
  });

  it('响应缺少 text 时抛错', async () => {
    const job = createJob('zh');
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '原文';

    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await expect(runPunctuationRestoreStep(job, ctx, {} as ServicesBundle)).rejects.toThrow(
      /missing text/
    );
  });
});
