import { runDedupStep } from './dedup-step';
import { JobAssignMessage } from '@shared/protocols/messages';
import { initJobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import { buildCoreResultExtra } from '../result-builder-core';

describe('runDedupStep duplicate sanitize', () => {
  const job = {
    job_id: 'job-dedup-1',
    session_id: 'session-dedup-1',
    utterance_index: 0,
    src_lang: 'zh',
    tgt_lang: 'en',
  } as JobAssignMessage;

  it('writes sanitized segment, trace, and extra.duplicate_sanitize', async () => {
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '谢谢谢谢谢谢';

    const services = { dedupStage: { process: jest.fn().mockReturnValue({ shouldSend: true }) } } as unknown as ServicesBundle;

    await runDedupStep(job, ctx, services);

    expect(ctx.segmentForJobResult).toBe('谢谢');
    expect(ctx.duplicateSanitizeApplied).toBe(true);
    expect(ctx.duplicateSanitizeTrace?.rule).toBe('prefix_repeat');
    expect(services.dedupStage!.process).toHaveBeenCalledWith(job, '谢谢', '');

    const extra = buildCoreResultExtra(job, ctx);
    expect(extra.duplicate_sanitize).toMatchObject({
      applied: true,
      rule: 'prefix_repeat',
    });
  });

  it('writes none trace when sanitize does not apply', async () => {
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '谢谢谢谢';

    const services = { dedupStage: { process: jest.fn().mockReturnValue({ shouldSend: true }) } } as unknown as ServicesBundle;

    await runDedupStep(job, ctx, services);

    expect(ctx.segmentForJobResult).toBe('谢谢谢谢');
    expect(ctx.duplicateSanitizeApplied).toBe(false);
    expect(ctx.duplicateSanitizeTrace).toMatchObject({
      applied: false,
      rule: 'none',
      beforeLength: 4,
      afterLength: 4,
    });
  });
});
