import { applyPostAggregationRouting, getTextForTranslation } from './post-asr-routing';
import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from './context/job-context';

describe('post-asr-routing', () => {
  const job = {
    job_id: 'j1',
    src_lang: 'zh',
    pipeline: { use_semantic: false },
  } as JobAssignMessage;

  it('defer 时清空 repairedText 且不允许翻译', () => {
    const ctx: JobContext = { segmentForJobResult: '片段' };
    applyPostAggregationRouting(job, ctx, {
      segmentReady: true,
      wantsPostAsrPipeline: false,
      deferTranslation: true,
    });
    expect(ctx.shouldDeferTranslation).toBe(true);
    expect(ctx.shouldAllowTranslation).toBe(false);
    expect(ctx.repairedText).toBe('');
  });

  it('语义关闭但允许翻译时保留 baseline 文本', () => {
    const ctx: JobContext = { segmentForJobResult: '你好' };
    applyPostAggregationRouting(job, ctx, {
      segmentReady: true,
      wantsPostAsrPipeline: true,
    });
    expect(ctx.shouldRunSemanticRepairHttp).toBe(false);
    expect(ctx.shouldAllowTranslation).toBe(true);
    expect(ctx.repairedText).toBe('你好');
    expect(getTextForTranslation(ctx)).toBe('你好');
  });
});
