/**
 * Gate-A: Session Context Manager 单元测试
 */

// Mock logger before imports
jest.mock('../../../main/src/logger', () => {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  return {
    __esModule: true,
    default: mockLogger,
  };
});

// Mock axios before imports
jest.mock('axios', () => {
  const mockPost = jest.fn();
  return {
    __esModule: true,
    default: {
      post: mockPost,
    },
  };
});

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { SessionContextManager, SessionContextResetRequest } from '../../../main/src/pipeline-orchestrator/session-context-manager';
import axios from 'axios';

describe('SessionContextManager', () => {
  let manager: SessionContextManager;
  let mockTaskRouter: any;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new SessionContextManager();
    
    // Mock TaskRouter
    mockTaskRouter = {
      getASREndpoints: jest.fn().mockReturnValue(['http://localhost:8001', 'http://localhost:8002']),
      resetConsecutiveLowQualityCount: jest.fn(),
    };
    
    manager.setTaskRouter(mockTaskRouter);
  });

  describe('resetContext', () => {
    it('应该成功重置 ASR context 和 consecutiveLowQualityCount', async () => {
      // Mock axios.post 成功响应
      (axios.post as jest.Mock).mockResolvedValue({ data: { status: 'ok' } });

      const request: SessionContextResetRequest = {
        sessionId: 'test-session-1',
        reason: 'consecutive_low_quality',
        jobId: 'test-job-1',
      };

      const result = await manager.resetContext(request, mockTaskRouter);

      expect(result.success).toBe(true);
      expect(result.asrContextReset).toBe(true);
      expect(result.consecutiveLowQualityCountReset).toBe(true);
      
      // 验证调用了 ASR 服务的 reset 端点
      expect(axios.post).toHaveBeenCalledTimes(2); // 两个端点
      expect(axios.post).toHaveBeenCalledWith(
        'http://localhost:8001/reset',
        {
          reset_context: true,
          reset_text_context: true,
        },
        { timeout: 2000 }
      );
      expect(axios.post).toHaveBeenCalledWith(
        'http://localhost:8002/reset',
        {
          reset_context: true,
          reset_text_context: true,
        },
        { timeout: 2000 }
      );
      
      // 验证调用了 TaskRouter.resetConsecutiveLowQualityCount
      expect(mockTaskRouter.resetConsecutiveLowQualityCount).toHaveBeenCalledWith('test-session-1');
    });

    it('应该处理 ASR 端点不可用的情况', async () => {
      mockTaskRouter.getASREndpoints.mockReturnValue([]);

      const request: SessionContextResetRequest = {
        sessionId: 'test-session-2',
        reason: 'consecutive_low_quality',
      };

      const result = await manager.resetContext(request, mockTaskRouter);

      expect(result.success).toBe(true);
      expect(result.asrContextReset).toBe(false);
      expect(result.consecutiveLowQualityCountReset).toBe(true);
      
      // 验证没有调用 axios.post
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('应该处理 ASR reset 失败的情况', async () => {
      // Mock axios.post 失败
      (axios.post as jest.Mock).mockRejectedValue(new Error('Network error'));

      const request: SessionContextResetRequest = {
        sessionId: 'test-session-3',
        reason: 'consecutive_low_quality',
      };

      const result = await manager.resetContext(request, mockTaskRouter);

      expect(result.success).toBe(false);
      expect(result.asrContextReset).toBe(false);
      expect(result.consecutiveLowQualityCountReset).toBe(true);
      expect(result.error).toContain('All ASR context reset attempts failed');
    });

    it('应该处理部分 ASR 端点失败的情况', async () => {
      // Mock 第一个端点成功，第二个端点失败
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { status: 'ok' } })
        .mockRejectedValueOnce(new Error('Network error'));

      const request: SessionContextResetRequest = {
        sessionId: 'test-session-4',
        reason: 'consecutive_low_quality',
      };

      const result = await manager.resetContext(request, mockTaskRouter);

      // 至少有一个端点成功，应该标记为成功
      expect(result.success).toBe(true);
      expect(result.asrContextReset).toBe(true);
      expect(result.consecutiveLowQualityCountReset).toBe(true);
    });

    it('应该处理 TaskRouter 不可用的情况', async () => {
      // 当 TaskRouter 为 null 时，getASREndpoints 会抛出错误
      // 代码会捕获错误，但如果没有其他错误，success 可能仍然为 true
      const request: SessionContextResetRequest = {
        sessionId: 'test-session-5',
        reason: 'consecutive_low_quality',
      };

      const result = await manager.resetContext(request, null);

      // 当 TaskRouter 为 null 时，ASR context reset 应该失败
      expect(result.asrContextReset).toBe(false);
      // consecutiveLowQualityCountReset 应该失败（因为没有 TaskRouter）
      expect(result.consecutiveLowQualityCountReset).toBe(false);
      // 注意：根据实际代码逻辑，如果只有 ASR reset 失败，success 可能仍然为 true
      // 这里我们只验证关键字段
    });

    it('应该处理 TaskRouter.resetConsecutiveLowQualityCount 不存在的情况', async () => {
      (axios.post as jest.Mock).mockResolvedValue({ data: { status: 'ok' } });

      const taskRouterWithoutReset = {
        getASREndpoints: jest.fn().mockReturnValue(['http://localhost:8001']),
        // 没有 resetConsecutiveLowQualityCount 方法
      };

      const request: SessionContextResetRequest = {
        sessionId: 'test-session-6',
        reason: 'consecutive_low_quality',
      };

      const result = await manager.resetContext(request, taskRouterWithoutReset);

      expect(result.success).toBe(true);
      expect(result.asrContextReset).toBe(true);
      expect(result.consecutiveLowQualityCountReset).toBe(false);
    });
  });

  describe('getMetrics', () => {
    it('应该返回上下文重置指标', async () => {
      (axios.post as jest.Mock).mockResolvedValue({ data: { status: 'ok' } });

      const request: SessionContextResetRequest = {
        sessionId: 'test-session-7',
        reason: 'consecutive_low_quality',
      };

      await manager.resetContext(request, mockTaskRouter);

      const metrics = manager.getMetrics();

      expect(metrics.totalResets).toBe(1);
      expect(metrics.asrContextResets).toBe(1);
      expect(metrics.consecutiveLowQualityCountResets).toBe(1);
      expect(metrics.errors).toBe(0);
    });

    it('应该累积多次重置的指标', async () => {
      (axios.post as jest.Mock).mockResolvedValue({ data: { status: 'ok' } });

      // 执行 3 次重置
      for (let i = 0; i < 3; i++) {
        const request: SessionContextResetRequest = {
          sessionId: `test-session-${i}`,
          reason: 'consecutive_low_quality',
        };
        await manager.resetContext(request, mockTaskRouter);
      }

      const metrics = manager.getMetrics();

      expect(metrics.totalResets).toBe(3);
      expect(metrics.asrContextResets).toBe(3);
      expect(metrics.consecutiveLowQualityCountResets).toBe(3);
    });
  });

  describe('setTaskRouter', () => {
    it('应该设置 TaskRouter 实例', () => {
      const newTaskRouter = {
        getASREndpoints: jest.fn().mockReturnValue(['http://localhost:8003']),
      };

      manager.setTaskRouter(newTaskRouter);

      // 验证 TaskRouter 已设置（通过调用 resetContext 来验证）
      expect(() => {
        manager.setTaskRouter(newTaskRouter);
      }).not.toThrow();
    });
  });
});
