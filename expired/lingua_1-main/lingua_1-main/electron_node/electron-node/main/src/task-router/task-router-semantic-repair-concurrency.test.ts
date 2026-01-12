/**
 * Phase 3 测试：TaskRouterSemanticRepairConcurrencyManager
 * 验证语义修复服务并发限制功能
 */

import { SemanticRepairConcurrencyManager } from './task-router-semantic-repair-concurrency';

describe('SemanticRepairConcurrencyManager - Phase 3', () => {
  let manager: SemanticRepairConcurrencyManager;

  beforeEach(() => {
    manager = new SemanticRepairConcurrencyManager({
      maxConcurrency: 2,
    });
  });

  describe('acquire and release', () => {
    it('应该在未超过限制时立即获取许可', async () => {
      await manager.acquire('semantic-repair-zh', 'job_1', 1000);
      const stats = manager.getStats();
      expect(stats.activeRequests.get('semantic-repair-zh')).toBe(1);
    });

    it('应该在超过限制时等待', async () => {
      // 获取2个许可（达到限制）
      await manager.acquire('semantic-repair-zh', 'job_1', 1000);
      await manager.acquire('semantic-repair-zh', 'job_2', 1000);

      // 第3个请求应该等待
      const acquirePromise = manager.acquire('semantic-repair-zh', 'job_3', 1000);
      
      // 等待一小段时间，确认它确实在等待
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const stats = manager.getStats();
      expect(stats.activeRequests.get('semantic-repair-zh')).toBe(2);
      expect(stats.waitingQueue).toBe(1);

      // 释放一个许可，第3个请求应该能够获取
      manager.release('semantic-repair-zh', 'job_1');
      await acquirePromise;

      const statsAfter = manager.getStats();
      expect(statsAfter.activeRequests.get('semantic-repair-zh')).toBe(2);
      expect(statsAfter.waitingQueue).toBe(0);
    });

    it('应该在超时时拒绝请求', async () => {
      // 获取2个许可（达到限制）
      await manager.acquire('semantic-repair-zh', 'job_1', 1000);
      await manager.acquire('semantic-repair-zh', 'job_2', 1000);

      // 第3个请求应该超时
      await expect(
        manager.acquire('semantic-repair-zh', 'job_3', 100)
      ).rejects.toThrow('Semantic repair concurrency timeout');
    });

    it('应该支持不同服务的独立并发限制', async () => {
      // 为不同服务配置不同的并发限制
      const customManager = new SemanticRepairConcurrencyManager({
        maxConcurrency: 2,
        serviceMaxConcurrency: new Map([
          ['semantic-repair-zh', 1],
          ['semantic-repair-en', 3],
        ]),
      });

      // zh服务只能有1个并发
      await customManager.acquire('semantic-repair-zh', 'job_1', 1000);
      const acquirePromise = customManager.acquire('semantic-repair-zh', 'job_2', 1000);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const stats = customManager.getStats();
      expect(stats.activeRequests.get('semantic-repair-zh')).toBe(1);
      expect(stats.waitingQueue).toBe(1);

      // en服务可以有3个并发
      await customManager.acquire('semantic-repair-en', 'job_1', 1000);
      await customManager.acquire('semantic-repair-en', 'job_2', 1000);
      await customManager.acquire('semantic-repair-en', 'job_3', 1000);
      
      const statsEn = customManager.getStats();
      expect(statsEn.activeRequests.get('semantic-repair-en')).toBe(3);

      // 清理
      customManager.release('semantic-repair-zh', 'job_1');
      await acquirePromise;
      customManager.release('semantic-repair-zh', 'job_2');
      customManager.release('semantic-repair-en', 'job_1');
      customManager.release('semantic-repair-en', 'job_2');
      customManager.release('semantic-repair-en', 'job_3');
    });

    it('应该正确处理释放操作', async () => {
      await manager.acquire('semantic-repair-zh', 'job_1', 1000);
      await manager.acquire('semantic-repair-zh', 'job_2', 1000);

      manager.release('semantic-repair-zh', 'job_1');
      const stats = manager.getStats();
      expect(stats.activeRequests.get('semantic-repair-zh')).toBe(1);

      manager.release('semantic-repair-zh', 'job_2');
      const statsAfter = manager.getStats();
      expect(statsAfter.activeRequests.get('semantic-repair-zh')).toBeUndefined();
    });
  });

  describe('getStats', () => {
    it('应该正确返回统计信息', async () => {
      await manager.acquire('semantic-repair-zh', 'job_1', 1000);
      await manager.acquire('semantic-repair-en', 'job_1', 1000);

      const stats = manager.getStats();
      expect(stats.activeRequests.get('semantic-repair-zh')).toBe(1);
      expect(stats.activeRequests.get('semantic-repair-en')).toBe(1);
      expect(stats.waitingQueue).toBe(0);

      // 清理
      manager.release('semantic-repair-zh', 'job_1');
      manager.release('semantic-repair-en', 'job_1');
    });
  });
});
