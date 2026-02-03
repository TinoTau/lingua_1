/**
 * semantic-repair-step 单元测试
 * 验证优化后的lastCommittedText处理
 */

jest.mock('../../gpu-arbiter', () => ({ withGpuLease: (_: string, fn: () => Promise<any>) => fn() }));

import { runSemanticRepairStep } from './semantic-repair-step';
import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext, initJobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';

describe('semantic-repair-step 优化验证', () => {
  let mockServices: ServicesBundle;
  let mockSemanticRepairInitializer: any;
  let mockSemanticRepairStage: any;
  let mockAggregatorManager: any;

  const createJob = (): JobAssignMessage => ({
    job_id: 'job-1',
    session_id: 'session-1',
    utterance_index: 0,
    src_lang: 'en',
    tgt_lang: 'zh',
  } as any);

  beforeEach(() => {
    mockSemanticRepairStage = {
      process: jest.fn().mockResolvedValue({
        textOut: 'repaired text',
        decision: 'PASS',
        confidence: 1.0,
        reasonCodes: [],
      }),
    };

    mockSemanticRepairInitializer = {
      isInitialized: jest.fn().mockReturnValue(true),
      initialize: jest.fn(),
      getSemanticRepairStage: jest.fn().mockReturnValue(mockSemanticRepairStage),
    };

    mockAggregatorManager = {
      updateLastCommittedTextAfterRepair: jest.fn(),
      getLastCommittedText: jest.fn(), // 用于验证不应该被调用
    };

    mockServices = {
      servicesHandler: {},
      semanticRepairInitializer: mockSemanticRepairInitializer,
      aggregatorManager: mockAggregatorManager,
    } as any;
  });

  it('只读 segmentForJobResult，修后写入 repairedText', async () => {
    const job = createJob();
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = 'test text';
    ctx.lastCommittedText = 'previous text';

    await runSemanticRepairStep(job, ctx, mockServices);

    expect(mockAggregatorManager.getLastCommittedText).not.toHaveBeenCalled();
    expect(mockSemanticRepairStage.process).toHaveBeenCalledTimes(1);
    expect(mockSemanticRepairStage.process.mock.calls[0][1]).toBe('test text');
    expect(ctx.repairedText).toBe('repaired text');
  });

  it('应正确处理 null 的 lastCommittedText', async () => {
    const job = createJob();
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = 'test text';
    ctx.lastCommittedText = null;

    await runSemanticRepairStep(job, ctx, mockServices);

    expect(ctx.repairedText).toBe('repaired text');
  });

  it('segmentForJobResult 为空时跳过修复', async () => {
    const job = createJob();
    const ctx = initJobContext(job);
    ctx.segmentForJobResult = '';

    await runSemanticRepairStep(job, ctx, mockServices);

    expect(mockSemanticRepairStage.process).not.toHaveBeenCalled();
    expect(ctx.repairedText).toBe('');
  });

  describe('语义修复不可用时不得透传原文（设计：所有 ASR 必须经语义修复）', () => {
    it('无 initializer 时 repairedText 为空且 shouldSend 为 false', async () => {
      const job = createJob();
      const ctx = initJobContext(job);
      ctx.segmentForJobResult = 'asr text';
      const servicesNoInit = { ...mockServices, semanticRepairInitializer: null };

      await runSemanticRepairStep(job, ctx, servicesNoInit);

      expect(ctx.repairedText).toBe('');
      expect(ctx.shouldSend).toBe(false);
      expect(mockSemanticRepairStage.process).not.toHaveBeenCalled();
    });

    it('无 servicesHandler 时 repairedText 为空且 shouldSend 为 false', async () => {
      const job = createJob();
      const ctx = initJobContext(job);
      ctx.segmentForJobResult = 'asr text';
      const servicesNoHandler = { ...mockServices, servicesHandler: null };

      await runSemanticRepairStep(job, ctx, servicesNoHandler);

      expect(ctx.repairedText).toBe('');
      expect(ctx.shouldSend).toBe(false);
      expect(mockSemanticRepairStage.process).not.toHaveBeenCalled();
    });

    it('initialize 失败时 repairedText 为空且 shouldSend 为 false', async () => {
      const job = createJob();
      const ctx = initJobContext(job);
      ctx.segmentForJobResult = 'asr text';
      (mockSemanticRepairInitializer.isInitialized as jest.Mock).mockReturnValue(false);
      (mockSemanticRepairInitializer.initialize as jest.Mock).mockRejectedValue(new Error('init failed'));

      await runSemanticRepairStep(job, ctx, mockServices);

      expect(ctx.repairedText).toBe('');
      expect(ctx.shouldSend).toBe(false);
      expect(mockSemanticRepairStage.process).not.toHaveBeenCalled();
    });

    it('getSemanticRepairStage 返回 null 时 repairedText 为空且 shouldSend 为 false', async () => {
      const job = createJob();
      const ctx = initJobContext(job);
      ctx.segmentForJobResult = 'asr text';
      (mockSemanticRepairInitializer.getSemanticRepairStage as jest.Mock).mockReturnValue(null);

      await runSemanticRepairStep(job, ctx, mockServices);

      expect(ctx.repairedText).toBe('');
      expect(ctx.shouldSend).toBe(false);
      expect(mockSemanticRepairStage.process).not.toHaveBeenCalled();
    });
  });
});
