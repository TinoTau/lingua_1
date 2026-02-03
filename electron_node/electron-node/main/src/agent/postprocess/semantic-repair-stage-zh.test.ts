/**
 * Phase 2 测试：SemanticRepairStageZH
 * 验证中文语义修复Stage功能
 * 设计：对每句话都进行修复，始终调用服务
 */

import { SemanticRepairStageZH } from './semantic-repair-stage-zh';
import { JobAssignMessage } from '@shared/protocols/messages';
import { TaskRouter } from '../../task-router/task-router';
import { SemanticRepairResult } from '../../task-router/types';

jest.mock('../../task-router/task-router');
jest.mock('../../sequential-executor/sequential-executor-factory', () => ({
  getSequentialExecutor: () => ({
    execute: (_: string, __: number, ___: string, fn: () => Promise<unknown>) => fn(),
  }),
  resetSequentialExecutor: () => { },
}));
jest.mock('../../gpu-arbiter', () => ({
  withGpuLease: (_: string, fn: () => Promise<unknown>) => fn(),
}));

describe('SemanticRepairStageZH - Phase 2', () => {
  let stage: SemanticRepairStageZH;
  let mockTaskRouter: jest.Mocked<TaskRouter>;

  beforeEach(() => {
    mockTaskRouter = {
      routeSemanticRepairTask: jest.fn(),
    } as any;

    stage = new SemanticRepairStageZH(mockTaskRouter, {
      enabled: true,
      qualityThreshold: 0.70,
      forceForShortSentence: false,
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

  describe('process', () => {
    it('应该在文本为空时返回PASS', async () => {
      const job = createJob();
      const result = await stage.process(job, '', 0.8);

      expect(result.textOut).toBe('');
      expect(result.decision).toBe('PASS');
      expect(result.reasonCodes).toContain('EMPTY_TEXT');
      expect(mockTaskRouter.routeSemanticRepairTask).not.toHaveBeenCalled();
    });

    it('应该在质量分高于阈值时仍调用服务并返回PASS（对每句话都修复）', async () => {
      const job = createJob();
      const inputText = '这是一个较长的测试文本，用于验证质量分高于阈值时的行为';
      mockTaskRouter.routeSemanticRepairTask.mockResolvedValue({
        decision: 'PASS',
        text_out: inputText,
        confidence: 1.0,
        reason_codes: [],
      });

      const result = await stage.process(job, inputText, 0.80);

      expect(mockTaskRouter.routeSemanticRepairTask).toHaveBeenCalled();
      expect(result.decision).toBe('PASS');
      expect(result.textOut).toBe(inputText);
    });

    it('应该在质量分低于阈值时调用服务并返回修复结果', async () => {
      const job = createJob();
      const repairResult: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: '修复后的文本',
        confidence: 0.85,
        reason_codes: ['LOW_QUALITY_SCORE'],
      };
      mockTaskRouter.routeSemanticRepairTask.mockResolvedValue(repairResult);

      const result = await stage.process(job, '短文本测试', 0.20, {
        language_probability: 0.3,
      });

      expect(mockTaskRouter.routeSemanticRepairTask).toHaveBeenCalled();
      expect(result.decision).toBe('REPAIR');
      expect(result.textOut).toBe('修复后的文本');
      expect(result.confidence).toBe(0.85);
    });

    it('应该在短句且异常词形时调用服务并返回修复结果', async () => {
      const job = createJob();
      const inputText = '短句异常词形测试';  // 7 字
      const repairedText = '短句修复后测试';   // 6 字，长度变化 < 20% 以通过 validator
      const repairResult: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: repairedText,
        confidence: 0.80,
        reason_codes: ['HIGH_NON_CHINESE_RATIO'],
      };
      mockTaskRouter.routeSemanticRepairTask.mockResolvedValue(repairResult);

      const result = await stage.process(job, inputText, 0.50);

      expect(mockTaskRouter.routeSemanticRepairTask).toHaveBeenCalled();
      expect(result.decision).toBe('REPAIR');
      expect(result.textOut).toBe(repairedText);
    });

    it('应该在服务错误时抛出错误（不兜底）', async () => {
      const job = createJob();
      mockTaskRouter.routeSemanticRepairTask.mockRejectedValue(new Error('Service error'));

      await expect(
        stage.process(job, '短文本测试', 0.50, { language_probability: 0.5 })
      ).rejects.toThrow('Service error');
      expect(mockTaskRouter.routeSemanticRepairTask).toHaveBeenCalled();
    });

    it('应该在TaskRouter不可用时返回PASS', async () => {
      const stageWithoutRouter = new SemanticRepairStageZH(null, {
        enabled: true,
        qualityThreshold: 0.70,
      });

      const job = createJob();
      // 使用较长的文本，质量分很低
      // 但由于TaskRouter为null，应该在打分器判断之前就返回PASS
      const result = await stageWithoutRouter.process(job, '这是一个较长的测试文本，用于验证TaskRouter不可用时的处理', 0.50);

      expect(result.decision).toBe('PASS');
      expect(result.reasonCodes).toContain('TASK_ROUTER_NOT_AVAILABLE');
    });
  });

  // P1-1: 已移除shouldTriggerRepair测试，使用SemanticRepairScorer替代
});
