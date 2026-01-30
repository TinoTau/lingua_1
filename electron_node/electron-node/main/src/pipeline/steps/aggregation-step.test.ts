/**
 * aggregation-step 单元测试
 * 验证无 aggregatorManager 时仍设置 shouldSendToSemanticRepair，保证 SEMANTIC_REPAIR 步骤被执行
 */

import { runAggregationStep } from './aggregation-step';
import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext, initJobContext } from '../context/job-context';
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
    it('应设置 ctx.shouldSendToSemanticRepair = true，以便 SEMANTIC_REPAIR 步骤执行', async () => {
      const job = createJob();
      const ctx = initJobContext(job);
      ctx.asrText = '超市日治关节云'; // 模拟 ASR 原文

      const services: ServicesBundle = {
        taskRouter: {},
        // aggregatorManager 未提供
      } as any;

      await runAggregationStep(job, ctx, services);

      expect(ctx.segmentForJobResult).toBe('超市日治关节云');
      expect(ctx.aggregationChanged).toBe(false);
      expect(ctx.shouldSendToSemanticRepair).toBe(true);
    });

    it('ASR 文本为空时应设置 segmentForJobResult、repairedText 均为空', async () => {
      const job = createJob();
      const ctx = initJobContext(job);
      ctx.asrText = '';

      const services: ServicesBundle = {
        taskRouter: {},
      } as any;

      await runAggregationStep(job, ctx, services);

      expect(ctx.segmentForJobResult).toBe('');
      expect(ctx.repairedText).toBe('');
      expect(ctx.shouldSendToSemanticRepair).toBeUndefined();
    });
  });
});
