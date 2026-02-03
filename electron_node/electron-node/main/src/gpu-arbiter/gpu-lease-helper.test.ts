/**
 * GPU 租约辅助函数单元测试
 */

import { withGpuLease, tryAcquireGpuLease } from './gpu-lease-helper';
import { GpuArbiter } from './gpu-arbiter';
import { GpuArbiterConfig } from './types';

// Mock logger
jest.mock('../logger', () => ({
  default: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock gpu-arbiter-factory（提供 getGpuArbiter 与 loadGpuArbiterConfig，避免未 mock 导致 is not a function）
jest.mock('./gpu-arbiter-factory', () => ({
  getGpuArbiter: jest.fn(),
  loadGpuArbiterConfig: jest.fn(() => ({
    enabled: true,
    gpuKeys: ['gpu:0'],
    defaultQueueLimit: 8,
    defaultHoldMaxMs: 8000,
    policies: {
      ASR: { priority: 90, maxWaitMs: 3000, busyPolicy: 'WAIT' },
      NMT: { priority: 80, maxWaitMs: 8000, busyPolicy: 'WAIT' },
      TTS: { priority: 70, maxWaitMs: 13000, busyPolicy: 'WAIT' },
      SEMANTIC_REPAIR: { priority: 20, maxWaitMs: 8000, busyPolicy: 'WAIT' },
      PHONETIC_CORRECTION: { priority: 60, maxWaitMs: 8000, busyPolicy: 'WAIT' },
    },
  })),
}));

// Mock node-config
jest.mock('../node-config', () => ({
  loadNodeConfig: jest.fn(() => ({
    gpuArbiter: {
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
      },
    },
  })),
}));

describe('GPU租约辅助函数', () => {
  let mockArbiter: GpuArbiter;
  const { getGpuArbiter } = require('./gpu-arbiter-factory');

  beforeEach(() => {
    const config: GpuArbiterConfig = {
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
      },
    };
    mockArbiter = new GpuArbiter(config);
    getGpuArbiter.mockReturnValue(mockArbiter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('withGpuLease', () => {
    it('应该在获取租约后执行函数并自动释放', async () => {
      const fn = jest.fn(async (lease) => {
        expect(lease).toBeDefined();
        expect(lease.leaseId).toBeDefined();
        return 'result';
      });

      const result = await withGpuLease('ASR', fn, {
        jobId: 'job-1',
        sessionId: 'session-1',
        utteranceIndex: 0,
      });

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);

      // 检查租约已释放（队列应该为空）
      const snapshot = mockArbiter.snapshot('gpu:0');
      expect(snapshot?.currentLease).toBeNull();
    });

    it('应该在函数抛出异常时也释放租约', async () => {
      const fn = jest.fn(async () => {
        throw new Error('Test error');
      });

      await expect(
        withGpuLease('ASR', fn, {
          jobId: 'job-1',
        })
      ).rejects.toThrow('Test error');

      // 检查租约已释放
      const snapshot = mockArbiter.snapshot('gpu:0');
      expect(snapshot?.currentLease).toBeNull();
    });

    it('应该在GPU仲裁器未启用时直接执行函数', async () => {
      getGpuArbiter.mockReturnValue(null);

      const fn = jest.fn(async (lease) => {
        expect(lease.leaseId).toBe('no-arbiter');
        return 'result';
      });

      const result = await withGpuLease('ASR', fn, {
        jobId: 'job-1',
      });

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('tryAcquireGpuLease', () => {
    it('应该成功获取租约', async () => {
      const lease = await tryAcquireGpuLease('ASR', {
        jobId: 'job-1',
        sessionId: 'session-1',
        utteranceIndex: 0,
      });

      expect(lease).not.toBeNull();
      expect(lease?.leaseId).toBeDefined();
      expect(lease?.taskType).toBe('ASR');

      // 清理
      lease?.release();
    });

    it('应该在GPU仲裁器未启用时返回虚拟租约', async () => {
      getGpuArbiter.mockReturnValue(null);

      const lease = await tryAcquireGpuLease('ASR', {
        jobId: 'job-1',
      });

      expect(lease).not.toBeNull();
      expect(lease?.leaseId).toBe('no-arbiter');
    });
  });
});
