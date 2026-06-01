import {
  isSegmentWriteLocked,
  markSemanticRepairHttpSuccess,
  markSemanticRepairSkipped,
} from './post-asr-routing';
import type { JobContext } from './context/job-context';

describe('segment write lock', () => {
  it('5015 成功时不覆盖 asrRepairApplied 的 segmentForJobResult', () => {
    const ctx = {
      segmentForJobResult: 'recover-picked',
      asrRepairApplied: true,
    } as JobContext;
    expect(isSegmentWriteLocked(ctx)).toBe(true);
    markSemanticRepairHttpSuccess(ctx, 'other');
    expect(ctx.segmentForJobResult).toBe('recover-picked');
  });

  it('skip 时不覆盖 segmentForJobResult', () => {
    const ctx = {
      segmentForJobResult: 'recover-picked',
      asrRepairApplied: true,
    } as JobContext;
    markSemanticRepairSkipped(ctx, 'LOCKED');
    expect(ctx.segmentForJobResult).toBe('recover-picked');
  });
});
