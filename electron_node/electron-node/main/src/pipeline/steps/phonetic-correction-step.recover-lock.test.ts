import { describe, expect, it, jest } from '@jest/globals';
import { JobContext } from '../context/job-context';
import { runPhoneticCorrectionStep } from './phonetic-correction-step';

jest.mock('../../node-config', () => ({
  getPhoneticCorrectionUrl: () => 'http://127.0.0.1:5016',
  isPhoneticCorrectionEnabled: () => true,
}));

jest.mock('../enhancement-gate', () => {
  const actual = jest.requireActual('../enhancement-gate') as object;
  return {
    ...actual,
    checkEnhancementService: () => ({ shouldRun: true }),
  };
});

jest.mock('../../gpu-arbiter', () => ({
  withGpuLease: async (_name: string, fn: () => Promise<void>) => fn(),
}));

describe('phonetic recover write lock', () => {
  it('does not overwrite segment when asrRepairApplied', async () => {
    const ctx: JobContext = {
      segmentForJobResult: 'recover-final',
      asrRepairApplied: true,
      shouldRunPhoneticCorrection: true,
    };
    const job = {
      job_id: 'j1',
      src_lang: 'zh',
      session_id: 's1',
      utterance_index: 0,
    } as any;

    await runPhoneticCorrectionStep(job, ctx, {} as any);

    expect(ctx.segmentForJobResult).toBe('recover-final');
    expect(ctx.phoneticCorrectionSkipReason).toBe('SEGMENT_WRITE_LOCKED');
  });
});
