/**
 * 同音纠错步骤：确认仅中文调用服务，结果写回 ctx.segmentForJobResult（语义修复读同一字段）；失败即抛错。
 */

jest.mock('../../gpu-arbiter', () => ({ withGpuLease: (_: string, fn: () => Promise<void>) => fn() }));

import { runPhoneticCorrectionStep } from './phonetic-correction-step';
import { JobAssignMessage } from '@shared/protocols/messages';
import { initJobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';

const createJob = (srcLang: string = 'zh'): JobAssignMessage =>
  ({ job_id: 'job-1', session_id: 's1', utterance_index: 0, src_lang: srcLang, tgt_lang: 'en' } as JobAssignMessage);

describe('runPhoneticCorrectionStep', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('中文且 segment 非空时调用 /correct 并将 text_out 写回 ctx.segmentForJobResult', async () => {
    const job = createJob('zh');
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '你号世界';

    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text_out: '你好世界' }),
    });

    await runPhoneticCorrectionStep(job, ctx, {} as ServicesBundle);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/correct'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text_in: '你号世界', lang: 'zh' }),
      })
    );
    expect(ctx.segmentForJobResult).toBe('你好世界');
  });

  it('segment 为空时不请求、不修改 ctx', async () => {
    const job = createJob('zh');
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '';

    (globalThis as any).fetch = jest.fn();

    await runPhoneticCorrectionStep(job, ctx, {} as ServicesBundle);

    expect(fetch).not.toHaveBeenCalled();
    expect(ctx.segmentForJobResult).toBe('');
  });

  it('英文时调用服务、服务返回原文（直通）', async () => {
    const job = createJob('en');
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = 'hello world';

    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text_out: 'hello world' }),
    });

    await runPhoneticCorrectionStep(job, ctx, {} as ServicesBundle);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/correct'),
      expect.objectContaining({
        body: JSON.stringify({ text_in: 'hello world', lang: 'en' }),
      })
    );
    expect(ctx.segmentForJobResult).toBe('hello world');
  });

  it('服务返回非 OK 时抛错', async () => {
    const job = createJob('zh');
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '原文';

    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

    await expect(runPhoneticCorrectionStep(job, ctx, {} as ServicesBundle)).rejects.toThrow(
      /Phonetic correction failed: HTTP 503/
    );
  });

  it('响应缺少 text_out 时抛错', async () => {
    const job = createJob('zh');
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '原文';

    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await expect(runPhoneticCorrectionStep(job, ctx, {} as ServicesBundle)).rejects.toThrow(
      /missing text_out/
    );
  });

  it('请求异常时抛错向上冒泡', async () => {
    const job = createJob('zh');
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '原文';

    (globalThis as any).fetch = jest.fn().mockRejectedValue(new Error('network error'));

    await expect(runPhoneticCorrectionStep(job, ctx, {} as ServicesBundle)).rejects.toThrow('network error');
  });
});
