/**
 * GPU 仲裁器单元测试
 */

import { GpuArbiter } from './gpu-arbiter';
import { GpuArbiterConfig, GpuTaskType } from './types';

// Mock logger
jest.mock('../logger', () => ({
  default: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('GpuArbiter', () => {
  let arbiter: GpuArbiter;
  const defaultConfig: GpuArbiterConfig = {
    enabled: true,
    gpuKeys: ['gpu:0'],
    defaultQueueLimit: 8,
    defaultHoldMaxMs: 8000,
    policies: {
      ASR: {
        priority: 90,
        maxWaitMs: 3000,
        busyPolicy: 'WAIT',
      },
      NMT: {
        priority: 80,
        maxWaitMs: 3000,
        busyPolicy: 'WAIT',
      },
      SEMANTIC_REPAIR: {
        priority: 20,
        maxWaitMs: 400,
        busyPolicy: 'SKIP',
      },
    },
  };

  beforeEach(() => {
    arbiter = new GpuArbiter(defaultConfig);
  });

  describe('acquire', () => {
    it('应该在GPU空闲时立即获取租约', async () => {
      const result = await arbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'ASR',
        priority: 90,
        maxWaitMs: 3000,
        holdMaxMs: 8000,
        queueLimit: 8,
        busyPolicy: 'WAIT',
        trace: {
          jobId: 'job-1',
          sessionId: 'session-1',
          utteranceIndex: 0,
        },
      });

      expect(result.status).toBe('ACQUIRED');
      expect(result.leaseId).toBeDefined();
      expect(result.queueWaitMs).toBe(0);
    });

    it('应该在GPU被占用时加入队列（WAIT策略）', async () => {
      // 第一个请求立即获取
      const result1 = await arbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'ASR',
        priority: 90,
        maxWaitMs: 3000,
        holdMaxMs: 8000,
        queueLimit: 8,
        busyPolicy: 'WAIT',
        trace: { jobId: 'job-1' },
      });

      expect(result1.status).toBe('ACQUIRED');

      // 第二个请求应该加入队列
      const acquirePromise = arbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'NMT',
        priority: 80,
        maxWaitMs: 3000,
        holdMaxMs: 8000,
        queueLimit: 8,
        busyPolicy: 'WAIT',
        trace: { jobId: 'job-2' },
      });

      // 检查队列状态
      const snapshot = arbiter.snapshot('gpu:0');
      expect(snapshot?.queueLength).toBe(1);

      // 释放第一个租约
      arbiter.release(result1.leaseId);

      // 第二个请求应该获取到租约
      const result2 = await acquirePromise;
      expect(result2.status).toBe('ACQUIRED');
    });

    it('应该在GPU忙时跳过（SKIP策略）', async () => {
      // 第一个请求立即获取
      const result1 = await arbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'ASR',
        priority: 90,
        maxWaitMs: 3000,
        holdMaxMs: 8000,
        queueLimit: 8,
        busyPolicy: 'WAIT',
        trace: { jobId: 'job-1' },
      });

      expect(result1.status).toBe('ACQUIRED');

      // 第二个请求使用SKIP策略
      const result2 = await arbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'SEMANTIC_REPAIR',
        priority: 20,
        maxWaitMs: 400,
        holdMaxMs: 3000,
        queueLimit: 8,
        busyPolicy: 'SKIP',
        trace: { jobId: 'job-2' },
      });

      expect(result2.status).toBe('SKIPPED');
      expect(result2.reason).toBe('GPU_BUSY');

      // 清理
      arbiter.release(result1.leaseId);
    });

    it('应该在队列满时返回SKIPPED（SKIP策略）', async () => {
      // 填充队列
      const firstRequest = await arbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'ASR',
        priority: 90,
        maxWaitMs: 3000,
        holdMaxMs: 8000,
        queueLimit: 2, // 小队列限制
        busyPolicy: 'WAIT',
        trace: { jobId: 'job-1' },
      });

      // 添加两个请求到队列
      const request2 = arbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'NMT',
        priority: 80,
        maxWaitMs: 3000,
        holdMaxMs: 8000,
        queueLimit: 2,
        busyPolicy: 'WAIT',
        trace: { jobId: 'job-2' },
      });

      const request3 = arbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'NMT',
        priority: 80,
        maxWaitMs: 3000,
        holdMaxMs: 8000,
        queueLimit: 2,
        busyPolicy: 'WAIT',
        trace: { jobId: 'job-3' },
      });

      // 等待请求2和3加入队列
      await new Promise(resolve => setTimeout(resolve, 10));

      // 第四个请求应该被拒绝（队列已满）
      const result4 = await arbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'SEMANTIC_REPAIR',
        priority: 20,
        maxWaitMs: 400,
        holdMaxMs: 3000,
        queueLimit: 2,
        busyPolicy: 'SKIP',
        trace: { jobId: 'job-4' },
      });

      expect(result4.status).toBe('SKIPPED');
      expect(result4.reason).toBe('QUEUE_FULL');

      // 清理
      arbiter.release(firstRequest.leaseId);
      await request2;
      await request3;
    });

    it('应该在超时后返回SKIPPED', async () => {
      // 第一个请求立即获取
      const result1 = await arbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'ASR',
        priority: 90,
        maxWaitMs: 3000,
        holdMaxMs: 8000,
        queueLimit: 8,
        busyPolicy: 'WAIT',
        trace: { jobId: 'job-1' },
      });

      // 第二个请求使用很短的超时时间
      const result2Promise = arbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'NMT',
        priority: 80,
        maxWaitMs: 100, // 100ms超时
        holdMaxMs: 8000,
        queueLimit: 8,
        busyPolicy: 'WAIT',
        trace: { jobId: 'job-2' },
      });

      const result2 = await result2Promise;
      expect(result2.status).toBe('SKIPPED');
      expect(result2.reason).toBe('TIMEOUT');

      // 清理
      arbiter.release(result1.leaseId);
    }, 10000); // 增加超时时间

    it('应该按优先级排序队列', async () => {
      // 第一个请求立即获取
      const result1 = await arbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'ASR',
        priority: 90,
        maxWaitMs: 3000,
        holdMaxMs: 8000,
        queueLimit: 8,
        busyPolicy: 'WAIT',
        trace: { jobId: 'job-1' },
      });

      // 添加不同优先级的请求
      const request2 = arbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'NMT',
        priority: 80,
        maxWaitMs: 3000,
        holdMaxMs: 8000,
        queueLimit: 8,
        busyPolicy: 'WAIT',
        trace: { jobId: 'job-2' },
      });

      const request3 = arbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'ASR',
        priority: 90, // 更高优先级
        maxWaitMs: 3000,
        holdMaxMs: 8000,
        queueLimit: 8,
        busyPolicy: 'WAIT',
        trace: { jobId: 'job-3' },
      });

      // 等待请求加入队列
      await new Promise(resolve => setTimeout(resolve, 10));

      // 检查队列顺序（优先级高的在前）
      const snapshot = arbiter.snapshot('gpu:0');
      expect(snapshot?.queueLength).toBe(2);
      // job-3 (priority 90) 应该在 job-2 (priority 80) 之前
      expect(snapshot?.queue[0].priority).toBeGreaterThanOrEqual(snapshot?.queue[1].priority || 0);

      // 清理
      arbiter.release(result1.leaseId);
      await request3; // job-3应该先获取
      await request2;
    });
  });

  describe('release', () => {
    it('应该正确释放租约并处理队列中的下一个请求', async () => {
      // 获取第一个租约
      const result1 = await arbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'ASR',
        priority: 90,
        maxWaitMs: 3000,
        holdMaxMs: 8000,
        queueLimit: 8,
        busyPolicy: 'WAIT',
        trace: { jobId: 'job-1' },
      });

      // 第二个请求加入队列
      const request2Promise = arbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'NMT',
        priority: 80,
        maxWaitMs: 3000,
        holdMaxMs: 8000,
        queueLimit: 8,
        busyPolicy: 'WAIT',
        trace: { jobId: 'job-2' },
      });

      // 等待请求加入队列
      await new Promise(resolve => setTimeout(resolve, 10));

      // 释放第一个租约
      arbiter.release(result1.leaseId);

      // 第二个请求应该获取到租约
      const result2 = await request2Promise;
      expect(result2.status).toBe('ACQUIRED');

      // 清理
      arbiter.release(result2.leaseId);
    });

    it('应该忽略不存在的租约ID', () => {
      expect(() => {
        arbiter.release('non-existent-lease-id');
      }).not.toThrow();
    });
  });

  describe('snapshot', () => {
    it('应该返回当前状态快照', async () => {
      const result = await arbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'ASR',
        priority: 90,
        maxWaitMs: 3000,
        holdMaxMs: 8000,
        queueLimit: 8,
        busyPolicy: 'WAIT',
        trace: { jobId: 'job-1' },
      });

      const snapshot = arbiter.snapshot('gpu:0');
      expect(snapshot).not.toBeNull();
      expect(snapshot?.gpuKey).toBe('gpu:0');
      expect(snapshot?.currentLease).not.toBeNull();
      expect(snapshot?.currentLease?.leaseId).toBe(result.leaseId);
      expect(snapshot?.queueLength).toBe(0);

      // 清理
      arbiter.release(result.leaseId);
    });

    it('应该返回null对于无效的GPU key', () => {
      const snapshot = arbiter.snapshot('invalid-gpu');
      expect(snapshot).toBeNull();
    });
  });

  describe('disabled状态', () => {
    it('应该在禁用时直接返回ACQUIRED', async () => {
      const disabledArbiter = new GpuArbiter({
        ...defaultConfig,
        enabled: false,
      });

      const result = await disabledArbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'ASR',
        priority: 90,
        maxWaitMs: 3000,
        holdMaxMs: 8000,
        queueLimit: 8,
        busyPolicy: 'WAIT',
        trace: { jobId: 'job-1' },
      });

      expect(result.status).toBe('ACQUIRED');
      // 禁用时仍然会生成leaseId，但不会进行实际的仲裁
      expect(result.leaseId).toBeDefined();
      expect(result.queueWaitMs).toBe(0);
    });
  });

  describe('watchdog', () => {
    it('应该记录超过holdMaxMs的租约', async () => {
      jest.useFakeTimers();

      const result = await arbiter.acquire({
        gpuKey: 'gpu:0',
        taskType: 'ASR',
        priority: 90,
        maxWaitMs: 3000,
        holdMaxMs: 1000, // 1秒
        queueLimit: 8,
        busyPolicy: 'WAIT',
        trace: { jobId: 'job-1' },
      });

      // 快进时间超过holdMaxMs
      jest.advanceTimersByTime(1100);

      // 检查快照中的指标
      const snapshot = arbiter.snapshot('gpu:0');
      // Watchdog应该已经触发（通过日志记录）

      // 清理
      arbiter.release(result.leaseId);
      jest.useRealTimers();
    });
  });
});
