/**
 * Pipeline Job 流程单元测试
 * 使用模拟文本（跳过 ASR）验证：
 * 1. Job 在业务流程中能跑通
 * 2. 各步骤只读约定字段，无重复/错误的字段或方法调用
 */

import { runJobPipeline, ServicesBundle } from './job-pipeline';
import { buildJobResult } from './result-builder';
import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext, initJobContext } from './context/job-context';
import { NMTResult } from '../task-router/types';
import { DedupStage } from '../agent/postprocess/dedup-stage';

jest.mock('../gpu-arbiter', () => ({
  withGpuLease: jest.fn((_serviceType: string, fn: () => Promise<any>) => fn()),
}));

jest.mock('./steps/phonetic-correction-step', () => ({
  runPhoneticCorrectionStep: jest.fn().mockResolvedValue(undefined),
}));

function createJob(overrides?: Partial<JobAssignMessage>): JobAssignMessage {
  return {
    job_id: 'job-flow-1',
    session_id: 'session-1',
    utterance_index: 0,
    src_lang: 'zh',
    tgt_lang: 'en',
    lang_a: 'zh',
    lang_b: 'en',
    pipeline: { use_asr: true, use_nmt: true, use_tts: false },
    ...overrides,
  } as JobAssignMessage;
}

describe('Pipeline Job 流程', () => {
  let mockTaskRouter: { routeNMTTask: jest.Mock };
  let mockSemanticRepairStage: { process: jest.Mock };
  let mockSemanticRepairInitializer: { getSemanticRepairStage: jest.Mock; isInitialized: jest.Mock; initialize: jest.Mock };
  let services: ServicesBundle;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTaskRouter = {
      routeNMTTask: jest.fn().mockResolvedValue({ text: 'translated segment' } as NMTResult),
    };
    mockSemanticRepairStage = {
      process: jest.fn().mockResolvedValue({
        decision: 'PASS',
        textOut: '修复后原文',
        confidence: 0.9,
        reasonCodes: [],
        semanticRepairApplied: false,
      }),
    };
    mockSemanticRepairInitializer = {
      isInitialized: jest.fn().mockReturnValue(true),
      initialize: jest.fn().mockResolvedValue(undefined),
      getSemanticRepairStage: jest.fn().mockReturnValue(mockSemanticRepairStage),
    };
    services = {
      taskRouter: mockTaskRouter as any,
      aggregatorManager: undefined,
      servicesHandler: {},
      semanticRepairInitializer: mockSemanticRepairInitializer as any,
      dedupStage: new DedupStage(), // 每个测试新建实例，避免 job_id 去重导致跳过翻译
    };
  });

  describe('全流程跑通（无聚合器，模拟文本跳过 ASR）', () => {
    it('应完成 Aggregation → SemanticRepair → Dedup → Translation，result 使用 repairedText（本段）作 text_asr', async () => {
      const job = createJob({ job_id: 'job-flow-1' });
      const ctx = initJobContext(job);
      ctx.asrText = '本段原文';

      const result = await runJobPipeline({ job, services, ctx });

      expect(result.text_asr).toBe('修复后原文');
      expect(result.text_translated).toBe('translated segment');
      expect(result.should_send).toBe(true);
      expect(mockTaskRouter.routeNMTTask).toHaveBeenCalledTimes(1);
      const nmtTask = (mockTaskRouter.routeNMTTask as jest.Mock).mock.calls[0][0];
      expect(nmtTask.text).toBe('修复后原文');
    });

    it('语义修复步骤只读 ctx.segmentForJobResult（无聚合器时=asrText）', async () => {
      const job = createJob({ job_id: 'job-flow-2' });
      const ctx = initJobContext(job);
      ctx.asrText = '本段原文';

      await runJobPipeline({ job, services, ctx });

      expect(mockSemanticRepairStage.process).toHaveBeenCalledTimes(1);
      const textToRepair = (mockSemanticRepairStage.process as jest.Mock).mock.calls[0][1];
      expect(textToRepair).toBe('本段原文');
    });

    it('去重步骤应只读 ctx.repairedText', async () => {
      const job = createJob({ job_id: 'job-flow-3' });
      const ctx = initJobContext(job);
      ctx.asrText = '本段原文';

      const processSpy = jest.spyOn(services.dedupStage!, 'process');
      await runJobPipeline({ job, services, ctx });

      expect(processSpy).toHaveBeenCalledTimes(1);
      const finalText = (processSpy.mock.calls[0] as any)[1];
      expect(finalText).toBe('修复后原文');
      processSpy.mockRestore();
    });

  });

  describe('空 ASR 时流程仍跑通且字段一致', () => {
    it('应设置空字符串且不送语义修复，result.text_asr 与 text_translated 为空', async () => {
      const job = createJob();
      const ctx = initJobContext(job);
      ctx.asrText = '';

      const result = await runJobPipeline({ job, services, ctx });

      expect(result.text_asr).toBe('');
      expect(result.text_translated).toBe('');
      expect(mockSemanticRepairStage.process).not.toHaveBeenCalled();
      expect(mockTaskRouter.routeNMTTask).not.toHaveBeenCalled();
    });
  });

  describe('result 只带本段（repairedText）', () => {
    it('翻译与 result 应只带本段（repairedText=修复后本段）', async () => {
      const job = createJob({ session_id: 'session-segment-only', job_id: 'job-segment-only' });
      const ctx = initJobContext(job);
      ctx.segmentForJobResult = '本段Only';
      ctx.shouldSendToSemanticRepair = true;
      ctx.repairedText = '修复后本段'; // 语义修复产出仅本段（由 segmentForJobResult 修得）
      ctx.shouldSend = true;

      mockTaskRouter.routeNMTTask.mockResolvedValueOnce({ text: 'translated segment only' } as NMTResult);

      const { runTranslationStep } = await import('./steps/translation-step');
      const { buildJobResult } = await import('./result-builder');

      await runTranslationStep(job, ctx, services);
      const result = buildJobResult(job, ctx);

      expect(mockTaskRouter.routeNMTTask).toHaveBeenCalledTimes(1);
      const nmtTask = (mockTaskRouter.routeNMTTask as jest.Mock).mock.calls[0][0];
      // 翻译与 result 只用 repairedText（本段），不能是整段 merged
      expect(nmtTask.text).toBe('修复后本段');
      expect(result.text_asr).toBe('修复后本段');
      expect(result.text_translated).toBe('translated segment only');
      // 确保不是整段 session 合并文
      expect(result.text_asr).not.toContain('上一句加本段合并长句');
      expect(result.text_asr?.length).toBeLessThanOrEqual('修复后本段'.length);
    });
  });

  describe('每个 jobResult 仅含本段（语义修复修本段 → result 仅本段）', () => {
    it('有 segmentForJobResult 时语义修复修本段，result 与 NMT 仅含本段', async () => {
      const job = createJob({ job_id: 'job-own-text-1', utterance_index: 1 });
      const ctx = initJobContext(job);
      ctx.segmentForJobResult = '本段这一句。';
      ctx.shouldSendToSemanticRepair = true;
      ctx.lastCommittedText = '上一句内容。';

      mockSemanticRepairStage.process.mockResolvedValueOnce({
        decision: 'REPAIR',
        textOut: '本段这一句。',
        confidence: 0.95,
        reasonCodes: [],
        semanticRepairApplied: true,
      });

      const { runSemanticRepairStep } = await import('./steps/semantic-repair-step');
      const { runTranslationStep } = await import('./steps/translation-step');

      await runSemanticRepairStep(job, ctx, services);
      expect(mockSemanticRepairStage.process).toHaveBeenCalledTimes(1);
      const textToRepair = (mockSemanticRepairStage.process as jest.Mock).mock.calls[0][1];
      expect(textToRepair).toBe('本段这一句。');

      ctx.shouldSend = true;
      mockTaskRouter.routeNMTTask.mockResolvedValueOnce({ text: 'This segment only.' } as NMTResult);
      await runTranslationStep(job, ctx, services);
      const result = buildJobResult(job, ctx);

      expect(result.text_asr).toBe('本段这一句。');
      expect(result.text_translated).toBe('This segment only.');
      expect(result.text_asr).not.toContain('上一句内容');
      const nmtText = (mockTaskRouter.routeNMTTask as jest.Mock).mock.calls[0][0].text;
      expect(nmtText).toBe('本段这一句。');
    });

    it('多个 job 模拟：每个 result 仅含各自本段', () => {
      const segments = ['第一句。', '第二句。', '第三句。'];
      segments.forEach((segment, i) => {
        const job = createJob({ job_id: `job-${i}`, utterance_index: i });
        const ctx = initJobContext(job);
        ctx.repairedText = segment;
        ctx.translatedText = `Sentence ${i + 1}.`;
        const result = buildJobResult(job, ctx);
        expect(result.text_asr).toBe(segment);
        expect(result.text_translated).toBe(`Sentence ${i + 1}.`);
        expect(result.text_asr).not.toContain(segments[i === 0 ? 1 : 0]);
      });
    });
  });
});
