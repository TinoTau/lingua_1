jest.mock('../../gpu-arbiter', () => ({ withGpuLease: (_: string, fn: () => Promise<void>) => fn() }));
jest.mock('../enhancement-gate', () => {
  const actual = jest.requireActual('../enhancement-gate');
  return {
    ...actual,
    checkEnhancementService: jest.fn(() => ({ shouldRun: true })),
  };
});

import { runPhoneticCorrectionStep } from './phonetic-correction-step';
import { JobAssignMessage } from '@shared/protocols/messages';
import { initJobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import { checkEnhancementService } from '../enhancement-gate';

const createJob = (srcLang: string = 'zh'): JobAssignMessage =>
  ({
    job_id: 'job-1',
    session_id: 's1',
    utterance_index: 0,
    src_lang: srcLang,
    tgt_lang: 'en',
    pipeline: { use_phonetic: true },
  } as JobAssignMessage);

describe('runPhoneticCorrectionStep', () => {
  let originalFetch: typeof globalThis.fetch;
  const mockGate = checkEnhancementService as jest.MockedFunction<typeof checkEnhancementService>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockGate.mockReturnValue({ shouldRun: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mockGate.mockReset();
  });

  it('gate 未通过时不 fetch', async () => {
    mockGate.mockReturnValue({ shouldRun: false, skipReason: 'NOT_RUNNING' });
    const job = createJob('zh');
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '你号世界';
    ctx.shouldRunPhoneticCorrection = true;

    (globalThis as any).fetch = jest.fn();

    await runPhoneticCorrectionStep(job, ctx, {} as ServicesBundle);

    expect(fetch).not.toHaveBeenCalled();
    expect(ctx.phoneticCorrectionSkipped).toBe(true);
    expect(ctx.phoneticCorrectionSkipReason).toBe('NOT_RUNNING');
  });

  it('中文且 segment 非空时调用 /correct 并写回 segment', async () => {
    const job = createJob('zh');
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '你号世界';
    ctx.shouldRunPhoneticCorrection = true;

    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text_out: '你好世界' }),
    });

    await runPhoneticCorrectionStep(job, ctx, {} as ServicesBundle);

    expect(fetch).toHaveBeenCalled();
    expect(ctx.segmentForJobResult).toBe('你好世界');
    expect(ctx.phoneticCorrectionApplied).toBe(true);
  });

  it('segment 为空时不请求', async () => {
    const job = createJob('zh');
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '';

    (globalThis as any).fetch = jest.fn();

    await runPhoneticCorrectionStep(job, ctx, {} as ServicesBundle);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('HTTP 失败时 skip 且保留原文', async () => {
    const job = createJob('zh');
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '原文';
    ctx.shouldRunPhoneticCorrection = true;

    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

    await runPhoneticCorrectionStep(job, ctx, {} as ServicesBundle);

    expect(ctx.segmentForJobResult).toBe('原文');
    expect(ctx.phoneticCorrectionSkipped).toBe(true);
    expect(ctx.phoneticCorrectionDegraded).toBe(true);
  });
});
