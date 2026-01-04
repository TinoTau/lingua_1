/**
 * Phase 2 测试：SemanticRepairStageEN
 * 验证英文语义修复Stage功能
 */

import { SemanticRepairStageEN } from './semantic-repair-stage-en';
import { JobAssignMessage } from '@shared/protocols/messages';
import { TaskRouter } from '../../task-router/task-router';
import { SemanticRepairResult } from '../../task-router/types';

// Mock TaskRouter
jest.mock('../../task-router/task-router');

describe('SemanticRepairStageEN - Phase 2', () => {
  let stage: SemanticRepairStageEN;
  let mockTaskRouter: jest.Mocked<TaskRouter>;

  beforeEach(() => {
    mockTaskRouter = {
      routeSemanticRepairTask: jest.fn(),
    } as any;

    stage = new SemanticRepairStageEN(mockTaskRouter, {
      repairEnabled: true,
      qualityThreshold: 0.70,
    });
  });

  const createJob = (): JobAssignMessage => ({
    job_id: 'job_123',
    session_id: 'session_456',
    utterance_index: 0,
    src_lang: 'en',
    tgt_lang: 'zh',
    trace_id: 'trace_789',
  } as JobAssignMessage);

  describe('process', () => {
    it('应该在文本为空时返回PASS', async () => {
      const job = createJob();
      const result = await stage.process(job, '', 0.8);

      expect(result.textOut).toBe('');
      expect(result.decision).toBe('PASS');
      expect(result.reasonCodes).toContain('EMPTY_TEXT');
    });

    it('应该在质量分高于阈值时返回PASS', async () => {
      const job = createJob();
      // 使用较长的文本，避免触发结构异常检测
      const result = await stage.process(job, 'This is a longer test sentence that should pass the quality threshold check without triggering structural issues detection', 0.80);

      expect(result.decision).toBe('PASS');
      expect(result.textOut).toBe('This is a longer test sentence that should pass the quality threshold check without triggering structural issues detection');
      expect(mockTaskRouter.routeSemanticRepairTask).not.toHaveBeenCalled();
    });

    it('应该在质量分低于阈值时触发修复', async () => {
      const job = createJob();
      const repairResult: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: 'Repaired text',
        confidence: 0.90,
        reason_codes: ['LOW_QUALITY_SCORE'],
      };

      mockTaskRouter.routeSemanticRepairTask.mockResolvedValue(repairResult);

      const result = await stage.process(job, 'Hello world', 0.65);

      expect(result.decision).toBe('REPAIR');
      expect(result.textOut).toBe('Repaired text');
      expect(result.confidence).toBe(0.90);
      expect(mockTaskRouter.routeSemanticRepairTask).toHaveBeenCalled();
    });

    it('应该在片段化文本时触发修复', async () => {
      const job = createJob();
      const repairResult: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: 'Repaired fragmented text',
        confidence: 0.85,
        reason_codes: ['FRAGMENTED_TEXT'],
      };

      mockTaskRouter.routeSemanticRepairTask.mockResolvedValue(repairResult);

      // 片段化文本（大量短词）
      const result = await stage.process(job, 'a b c d e f g h i j', 0.75);

      expect(result.decision).toBe('REPAIR');
      expect(mockTaskRouter.routeSemanticRepairTask).toHaveBeenCalled();
    });

    it('应该在服务错误时返回PASS', async () => {
      const job = createJob();
      mockTaskRouter.routeSemanticRepairTask.mockRejectedValue(new Error('Service error'));

      const result = await stage.process(job, 'Hello world', 0.65);

      expect(result.decision).toBe('PASS');
      expect(result.textOut).toBe('Hello world');
      expect(result.reasonCodes).toContain('SERVICE_ERROR');
    });
  });
});
