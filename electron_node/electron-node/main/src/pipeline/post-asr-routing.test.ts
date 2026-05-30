import { applyPostAggregationRouting, getTextForTranslation, resolveBusinessAsrText } from './post-asr-routing';
import { initJobContext } from './context/job-context';
import { JobAssignMessage } from '@shared/protocols/messages';

describe('post-asr-routing', () => {
  const job = { job_id: 'j1', src_lang: 'zh' } as JobAssignMessage;

  it('defer 时保留 segmentForJobResult 且不允许翻译', () => {
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '你好';

    applyPostAggregationRouting(job, ctx, {
      segmentReady: true,
      wantsPostAsrPipeline: false,
      deferTranslation: true,
    });

    expect(ctx.segmentForJobResult).toBe('你好');
    expect(ctx.shouldDeferTranslation).toBe(true);
    expect(ctx.shouldAllowTranslation).toBe(false);
  });

  it('segmentReady 时允许翻译', () => {
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '你好';

    applyPostAggregationRouting(job, ctx, {
      segmentReady: true,
      wantsPostAsrPipeline: true,
    });

    expect(ctx.shouldAllowTranslation).toBe(true);
    expect(getTextForTranslation(ctx)).toBe('你好');
  });

  it('resolveBusinessAsrText 只读 segmentForJobResult', () => {
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '业务段';
    ctx.asrText = '诊断 asr';
    ctx.rawAsrText = 'raw';
    expect(resolveBusinessAsrText(ctx)).toBe('业务段');
    expect(getTextForTranslation(ctx)).toBe('业务段');
  });

  it('segment 为空时不 fallback asrText', () => {
    const ctx = initJobContext(job);
    ctx.asrText = '诊断 asr';
    ctx.rawAsrText = 'raw';
    expect(resolveBusinessAsrText(ctx)).toBe('');
    expect(getTextForTranslation(ctx)).toBe('');
  });

  it('segment 空时 segmentReady=false 不允许翻译', () => {
    const ctx = initJobContext(job);
    ctx.asrText = '仅有 diagnostics';

    applyPostAggregationRouting(job, ctx, {
      segmentReady: true,
      wantsPostAsrPipeline: true,
    });

    expect(ctx.shouldAllowTranslation).toBe(false);
  });
});
