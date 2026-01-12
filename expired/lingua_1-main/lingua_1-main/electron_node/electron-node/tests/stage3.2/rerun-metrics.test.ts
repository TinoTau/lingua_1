/**
 * Gate-B: Rerun Metrics 单元测试
 */

// Mock logger before imports
jest.mock('../../../main/src/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { TaskRouter } from '../../../main/src/task-router/task-router';
import { PipelineOrchestrator } from '../../../main/src/pipeline-orchestrator/pipeline-orchestrator';
// Note: InferenceService test requires more complex setup, so we'll test it separately
// import { InferenceService } from '../../../main/src/inference/inference-service';

describe('Gate-B: Rerun Metrics', () => {
  describe('TaskRouter.getRerunMetrics', () => {
    let taskRouter: TaskRouter;
    let mockPythonServiceManager: any;
    let mockRustServiceManager: any;
    let mockServiceRegistryManager: any;

    beforeEach(() => {
      jest.clearAllMocks();
      
      mockPythonServiceManager = {
        getServiceStatus: jest.fn().mockResolvedValue({ running: true }),
      };
      
      mockRustServiceManager = {
        getStatus: jest.fn().mockResolvedValue({ running: true }),
      };
      
      mockServiceRegistryManager = {
        loadRegistry: jest.fn().mockResolvedValue(undefined),
        listInstalled: jest.fn().mockReturnValue([]),
      };

      taskRouter = new TaskRouter(
        mockPythonServiceManager,
        mockRustServiceManager,
        mockServiceRegistryManager
      );
    });

    it('应该返回初始的 rerun 指标', () => {
      const metrics = taskRouter.getRerunMetrics();

      expect(metrics).toEqual({
        totalReruns: 0,
        successfulReruns: 0,
        failedReruns: 0,
        timeoutReruns: 0,
        qualityImprovements: 0,
      });
    });

    it('应该返回指标的副本（不是引用）', () => {
      const metrics1 = taskRouter.getRerunMetrics();
      const metrics2 = taskRouter.getRerunMetrics();

      expect(metrics1).not.toBe(metrics2);
      expect(metrics1).toEqual(metrics2);
    });
  });

  describe('PipelineOrchestrator.getTaskRouter', () => {
    let pipelineOrchestrator: PipelineOrchestrator;
    let mockTaskRouter: any;

    beforeEach(() => {
      jest.clearAllMocks();
      
      mockTaskRouter = {
        getRerunMetrics: jest.fn().mockReturnValue({
          totalReruns: 5,
          successfulReruns: 3,
          failedReruns: 1,
          timeoutReruns: 1,
          qualityImprovements: 2,
        }),
      };

      pipelineOrchestrator = new PipelineOrchestrator(mockTaskRouter);
    });

    it('应该返回 TaskRouter 实例', () => {
      const taskRouter = pipelineOrchestrator.getTaskRouter();

      expect(taskRouter).toBe(mockTaskRouter);
    });

    it('应该能够通过 TaskRouter 获取 rerun 指标', () => {
      const taskRouter = pipelineOrchestrator.getTaskRouter();
      const metrics = taskRouter.getRerunMetrics();

      expect(metrics).toEqual({
        totalReruns: 5,
        successfulReruns: 3,
        failedReruns: 1,
        timeoutReruns: 1,
        qualityImprovements: 2,
      });
    });
  });

  // Note: InferenceService.getRerunMetrics 测试需要更复杂的设置
  // 将在单独的集成测试中覆盖
});

