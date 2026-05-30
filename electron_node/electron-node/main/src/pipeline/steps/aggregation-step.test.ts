/**
 * aggregation-step 单元测试
 * 无 aggregatorManager 时写入 segment 与翻译门控；语义修复默认关闭（需显式开启 job+节点配置）
 */

import { runAggregationStep } from './aggregation-step';
import { JobAssignMessage } from '@shared/protocols/messages';
import { initJobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';

describe('aggregation-step', () => {
  const createJob = (): JobAssignMessage =>
  ({
    job_id: 'job-1',
    session_id: 'session-1',
    utterance_index: 0,
    src_lang: 'zh',
    tgt_lang: 'en',
  } as any);

  describe('无 aggregatorManager 时', () => {
    it('应设置 segment 与 shouldAllowTranslation，语义修复默认不开启', async () => {
      const job = createJob();
      const ctx = initJobContext(job);
      ctx.segmentForJobResult = '超市日治关节云';

      const services: ServicesBundle = {
        taskRouter: {},
      } as any;

      await runAggregationStep(job, ctx, services);

      expect(ctx.segmentForJobResult).toBe('超市日治关节云');
      expect(ctx.aggregationChanged).toBe(false);
      expect(ctx.shouldRunSemanticRepairHttp).toBe(false);
      expect(ctx.shouldAllowTranslation).toBe(true);
    });

    it('segment 为空时应设置 segmentForJobResult 为空并 defer', async () => {
      const job = createJob();
      const ctx = initJobContext(job);
      ctx.segmentForJobResult = '';

      const services: ServicesBundle = {
        taskRouter: {},
      } as any;

      await runAggregationStep(job, ctx, services);

      expect(ctx.segmentForJobResult).toBe('');
      expect(ctx.shouldDeferTranslation).toBe(true);
      expect(ctx.shouldRunSemanticRepairHttp).toBe(false);
    });

    it('segment 为空时不应 fallback 到 asrText', async () => {
      const job = createJob();
      const ctx = initJobContext(job);
      ctx.asrText = '仅 diagnostics 有值';
      ctx.segmentForJobResult = undefined;

      const services: ServicesBundle = {
        taskRouter: {},
      } as any;

      await runAggregationStep(job, ctx, services);

      expect(ctx.segmentForJobResult).toBe('');
      expect(ctx.shouldDeferTranslation).toBe(true);
      expect(ctx.shouldAllowTranslation).toBe(false);
    });
  });

  describe('CTC 兼容：单次 final 与 utterance 聚合', () => {
    it('单段 segment 走聚合步骤与多段路径一致', async () => {
      const job = createJob();
      const ctx = initJobContext(job);
      ctx.segmentForJobResult = 'CTC 单次识别结果文本';

      const services: ServicesBundle = {
        taskRouter: {},
      } as any;

      await runAggregationStep(job, ctx, services);

      expect(ctx.segmentForJobResult).toBe('CTC 单次识别结果文本');
      expect(ctx.shouldRunSemanticRepairHttp).toBe(false);
      expect(ctx.shouldAllowTranslation).toBe(true);
    });
  });
});
