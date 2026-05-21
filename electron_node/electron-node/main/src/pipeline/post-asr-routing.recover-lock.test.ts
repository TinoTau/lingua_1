import { describe, expect, it } from '@jest/globals';
import type { JobContext } from './context/job-context';
import {
  isRecoverWriteLocked,
  markSemanticRepairHttpSuccess,
  markSemanticRepairSkipped,
} from './post-asr-routing';

describe('Recover write lock', () => {
  it('5015 成功时不覆盖 asrRepairApplied 的 repairedText', () => {
    const ctx: JobContext = {
      repairedText: 'recover-picked',
      asrRepairApplied: true,
      segmentForJobResult: 'segment',
    };
    expect(isRecoverWriteLocked(ctx)).toBe(true);
    markSemanticRepairHttpSuccess(ctx, 'semantic-overwrite');
    expect(ctx.repairedText).toBe('recover-picked');
    expect(ctx.semanticRepairSkipReason).toBe('RECOVER_WRITE_LOCKED');
  });

  it('skip 时不覆盖 repairedText', () => {
    const ctx: JobContext = {
      repairedText: 'recover-picked',
      asrRepairApplied: true,
      segmentForJobResult: 'segment',
    };
    markSemanticRepairSkipped(ctx, 'TEST', { fallbackText: 'segment' });
    expect(ctx.repairedText).toBe('recover-picked');
  });
});
