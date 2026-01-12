/**
 * Phase 0-1 测试：SemanticRepairHealthChecker
 * 验证语义修复服务健康检查功能
 */

import { SemanticRepairHealthChecker, SemanticRepairServiceStatus } from './task-router-semantic-repair-health';

// Mock fetch
global.fetch = jest.fn();

describe('SemanticRepairHealthChecker - P0-1', () => {
  let checker: SemanticRepairHealthChecker;

  beforeEach(() => {
    checker = new SemanticRepairHealthChecker();
    (global.fetch as jest.Mock).mockClear();
  });

  describe('checkServiceHealth', () => {
    it('应该在进程未运行时返回INSTALLED状态', async () => {
      const result = await checker.checkServiceHealth(
        'semantic-repair-zh',
        'http://localhost:5010',
        false  // 进程未运行
      );

      expect(result.status).toBe(SemanticRepairServiceStatus.INSTALLED);
      expect(result.isAvailable).toBe(false);
      expect(result.reason).toBe('Process not running');
    });

    it('应该在HTTP接口不可访问时返回RUNNING状态', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const result = await checker.checkServiceHealth(
        'semantic-repair-zh',
        'http://localhost:5010',
        true  // 进程运行中
      );

      expect(result.status).toBe(SemanticRepairServiceStatus.RUNNING);
      expect(result.isAvailable).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('应该在HTTP接口返回非健康状态时返回RUNNING状态', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'starting' }),
      });

      const result = await checker.checkServiceHealth(
        'semantic-repair-zh',
        'http://localhost:5010',
        true
      );

      expect(result.status).toBe(SemanticRepairServiceStatus.RUNNING);
      expect(result.isAvailable).toBe(false);
    });

    it('应该在HTTP接口健康但模型未warm时返回HEALTHY状态', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'healthy' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'healthy', warmed: false }),
        });

      const result = await checker.checkServiceHealth(
        'semantic-repair-zh',
        'http://localhost:5010',
        true
      );

      expect(result.status).toBe(SemanticRepairServiceStatus.HEALTHY);
      expect(result.isAvailable).toBe(false);
      expect(result.reason).toContain('Model not warmed');
    });

    it('应该在服务完全可用时返回WARMED状态', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'healthy' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'healthy', warmed: true }),
        });

      const result = await checker.checkServiceHealth(
        'semantic-repair-zh',
        'http://localhost:5010',
        true
      );

      expect(result.status).toBe(SemanticRepairServiceStatus.WARMED);
      expect(result.isAvailable).toBe(true);
      expect(result.reason).toBe('Service ready');
    });

    it('应该使用缓存结果（在检查间隔内且状态为WARMED）', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'healthy' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'healthy', warmed: true }),
        });

      // 第一次检查
      const result1 = await checker.checkServiceHealth(
        'semantic-repair-zh',
        'http://localhost:5010',
        true
      );

      expect(result1.status).toBe(SemanticRepairServiceStatus.WARMED);

      // 重置fetch调用计数
      (global.fetch as jest.Mock).mockClear();

      // 第二次检查（应该使用缓存，因为状态为WARMED）
      const result2 = await checker.checkServiceHealth(
        'semantic-repair-zh',
        'http://localhost:5010',
        true
      );

      expect(result2.status).toBe(SemanticRepairServiceStatus.WARMED);
      // fetch不应该被调用（使用缓存）
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('应该处理超时情况', async () => {
      (global.fetch as jest.Mock).mockImplementation(() => {
        const error = new Error('AbortError');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      const result = await checker.checkServiceHealth(
        'semantic-repair-zh',
        'http://localhost:5010',
        true
      );

      expect(result.status).toBe(SemanticRepairServiceStatus.RUNNING);
      expect(result.isAvailable).toBe(false);
      expect(result.reason).toBeDefined();
    });
  });

  describe('clearCache', () => {
    it('应该能够清除特定服务的缓存', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'healthy' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'healthy', warmed: true }),
        });

      await checker.checkServiceHealth('semantic-repair-zh', 'http://localhost:5010', true);
      
      checker.clearCache('semantic-repair-zh', 'http://localhost:5010');
      
      const cached = checker.getCachedStatus('semantic-repair-zh', 'http://localhost:5010');
      expect(cached).toBeNull();
    });

    it('应该能够清除所有缓存', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValue({
          ok: true,
          json: async () => ({ status: 'healthy', warmed: true }),
        });

      await checker.checkServiceHealth('semantic-repair-zh', 'http://localhost:5010', true);
      await checker.checkServiceHealth('semantic-repair-en', 'http://localhost:5011', true);
      
      checker.clearCache();
      
      expect(checker.getCachedStatus('semantic-repair-zh', 'http://localhost:5010')).toBeNull();
      expect(checker.getCachedStatus('semantic-repair-en', 'http://localhost:5011')).toBeNull();
    });
  });
});
