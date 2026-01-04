/**
 * Phase 2 测试：TranslationStage 与 NMT Repair 协调机制
 * 验证语义修复与NMT Repair的自动协调
 */

import { TranslationStage } from './translation-stage';
import { JobAssignMessage } from '@shared/protocols/messages';
import { TaskRouter } from '../../task-router/task-router';
import { AggregatorManager } from '../../aggregator/aggregator-manager';
import { NMTResult } from '../../task-router/types';

// Mock TaskRouter
jest.mock('../../task-router/task-router');

describe('TranslationStage - NMT Repair Coordination (Phase 2)', () => {
  let stage: TranslationStage;
  let mockTaskRouter: jest.Mocked<TaskRouter>;
  let mockAggregatorManager: AggregatorManager | null;

  beforeEach(() => {
    mockTaskRouter = {
      routeNMTTask: jest.fn(),
    } as any;

    mockAggregatorManager = null;

    stage = new TranslationStage(mockTaskRouter, mockAggregatorManager, {
      nmtRepairEnabled: true,
      nmtRepairNumCandidates: 5,
      nmtRepairThreshold: 0.7,
    });
  });

  const createJob = (): JobAssignMessage => ({
    job_id: 'job_123',
    session_id: 'session_456',
    utterance_index: 0,
    src_lang: 'zh',
    tgt_lang: 'en',
    trace_id: 'trace_789',
  } as JobAssignMessage);

  describe('与语义修复的协调', () => {
    it('应该在语义修复已应用且置信度高时跳过NMT Repair', async () => {
      const job = createJob();
      const nmtResult: NMTResult = {
        text: 'Translated text',
      };

      mockTaskRouter.routeNMTTask.mockResolvedValue(nmtResult);

      const result = await stage.process(
        job,
        '测试文本',
        0.65,
        0,
        {
          semanticRepairApplied: true,
          semanticRepairConfidence: 0.85,  // 高于阈值0.7
        }
      );

      expect(result.translatedText).toBe('Translated text');
      expect(result.nmtRepairApplied).toBeUndefined();  // 应该跳过NMT Repair
      // 验证只调用了一次NMT（没有生成多个候选）
      expect(mockTaskRouter.routeNMTTask).toHaveBeenCalledTimes(1);
    });

    it('应该在语义修复已应用但置信度低时启用NMT Repair', async () => {
      const job = createJob();
      const nmtResult: NMTResult = {
        text: 'Translated text',
        candidates: ['Candidate 1', 'Candidate 2', 'Candidate 3'],
      };

      mockTaskRouter.routeNMTTask.mockResolvedValue(nmtResult);

      const result = await stage.process(
        job,
        '测试文本',
        0.65,
        0,
        {
          semanticRepairApplied: true,
          semanticRepairConfidence: 0.60,  // 低于阈值0.7
        }
      );

      // 应该触发NMT Repair
      expect(mockTaskRouter.routeNMTTask).toHaveBeenCalled();
      const callArgs = (mockTaskRouter.routeNMTTask as jest.Mock).mock.calls[0][0];
      expect(callArgs.num_candidates).toBeDefined();
    });

    it('应该在语义修复未应用时启用NMT Repair', async () => {
      const job = createJob();
      const nmtResult: NMTResult = {
        text: 'Translated text',
        candidates: ['Candidate 1', 'Candidate 2', 'Candidate 3', 'Candidate 4', 'Candidate 5'],
      };

      mockTaskRouter.routeNMTTask.mockResolvedValue(nmtResult);

      const result = await stage.process(
        job,
        '测试文本',
        0.65,
        0,
        {
          semanticRepairApplied: false,
          semanticRepairConfidence: 1.0,
        }
      );

      // 应该触发NMT Repair，候选数为5（默认值）
      expect(mockTaskRouter.routeNMTTask).toHaveBeenCalled();
      const callArgs = (mockTaskRouter.routeNMTTask as jest.Mock).mock.calls[0][0];
      expect(callArgs.num_candidates).toBe(5);
    });

    it('应该在语义修复已应用时减少NMT Repair候选数', async () => {
      const job = createJob();
      const nmtResult: NMTResult = {
        text: 'Translated text',
        candidates: ['Candidate 1', 'Candidate 2', 'Candidate 3'],
      };

      mockTaskRouter.routeNMTTask.mockResolvedValue(nmtResult);

      // 语义修复已应用但置信度低，应该触发NMT Repair但候选数减少
      await stage.process(
        job,
        '测试文本',
        0.65,
        0,
        {
          semanticRepairApplied: true,
          semanticRepairConfidence: 0.60,
        }
      );

      const callArgs = (mockTaskRouter.routeNMTTask as jest.Mock).mock.calls[0][0];
      // 当语义修复服务可用时，候选数应该从5降到3
      expect(callArgs.num_candidates).toBe(3);
    });
  });
});
