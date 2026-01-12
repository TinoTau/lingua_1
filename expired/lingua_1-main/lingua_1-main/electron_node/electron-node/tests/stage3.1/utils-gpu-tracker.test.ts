/**
 * GPU 跟踪工具单元测试
 * 
 * 测试功能：
 * - GPU 使用率获取
 * - GPU 使用时间跟踪
 * - 跟踪器状态管理
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { GpuUsageTracker, getGpuUsage } from '../../main/src/utils/gpu-tracker';

describe('GPU Tracker', () => {
  let tracker: GpuUsageTracker;

  beforeEach(() => {
    tracker = new GpuUsageTracker();
  });

  afterEach(() => {
    tracker.stopTracking();
    tracker.reset();
  });

  describe('GpuUsageTracker', () => {
    it('应该正确初始化', () => {
      expect(tracker.getGpuUsageMs()).toBe(0);
    });

    it('应该开始和停止跟踪', () => {
      tracker.startTracking();
      expect(tracker.getGpuUsageMs()).toBeGreaterThanOrEqual(0);
      
      // 等待一小段时间
      const startMs = tracker.getGpuUsageMs();
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          tracker.stopTracking();
          const endMs = tracker.getGpuUsageMs();
          // 停止后应该累计了一些时间（或至少不为负）
          expect(endMs).toBeGreaterThanOrEqual(startMs);
          resolve();
        }, 100);
      });
    });

    it('应该防止重复启动跟踪', () => {
      tracker.startTracking();
      const firstInterval = (tracker as any).gpuCheckInterval;
      
      tracker.startTracking(); // 再次启动应该被忽略
      const secondInterval = (tracker as any).gpuCheckInterval;
      
      expect(firstInterval).toBe(secondInterval);
      tracker.stopTracking();
    });

    it('应该正确重置累计时间', () => {
      tracker.startTracking();
      
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const beforeReset = tracker.getGpuUsageMs();
          expect(beforeReset).toBeGreaterThanOrEqual(0);
          
          tracker.reset();
          const afterReset = tracker.getGpuUsageMs();
          expect(afterReset).toBe(0);
          
          tracker.stopTracking();
          resolve();
        }, 100);
      });
    });

    it('应该正确获取累计使用时间', () => {
      tracker.startTracking();
      
      const usage1 = tracker.getGpuUsageMs();
      expect(usage1).toBeGreaterThanOrEqual(0);
      
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const usage2 = tracker.getGpuUsageMs();
          // 时间应该增加或保持不变
          expect(usage2).toBeGreaterThanOrEqual(usage1);
          
          tracker.stopTracking();
          const usage3 = tracker.getGpuUsageMs();
          // 停止后应该累计最后一次使用时间
          expect(usage3).toBeGreaterThanOrEqual(usage2);
          
          resolve();
        }, 100);
      });
    });

    it('应该处理多次启动和停止', () => {
      tracker.startTracking();
      
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          tracker.stopTracking();
          const usage1 = tracker.getGpuUsageMs();
          
          tracker.startTracking();
          setTimeout(() => {
            tracker.stopTracking();
            const usage2 = tracker.getGpuUsageMs();
            
            // 第二次应该累计更多时间
            expect(usage2).toBeGreaterThanOrEqual(usage1);
            resolve();
          }, 100);
        }, 100);
      });
    });
  });

  describe('getGpuUsage', () => {
    it('应该返回 GPU 使用率信息或 null', async () => {
      const gpuInfo = await getGpuUsage();
      
      // 如果没有 GPU 或 pynvml 不可用，应该返回 null
      // 如果有 GPU，应该返回包含 usage 和 memory 的对象
      if (gpuInfo !== null) {
        expect(gpuInfo).toHaveProperty('usage');
        expect(gpuInfo).toHaveProperty('memory');
        expect(typeof gpuInfo.usage).toBe('number');
        expect(typeof gpuInfo.memory).toBe('number');
        expect(gpuInfo.usage).toBeGreaterThanOrEqual(0);
        expect(gpuInfo.usage).toBeLessThanOrEqual(100);
        expect(gpuInfo.memory).toBeGreaterThanOrEqual(0);
        expect(gpuInfo.memory).toBeLessThanOrEqual(100);
      }
    });

    it('应该处理 Python 不可用的情况', async () => {
      // 这个测试主要确保函数不会抛出错误
      // 即使 Python 或 pynvml 不可用，也应该返回 null 而不是抛出异常
      const gpuInfo = await getGpuUsage();
      expect(gpuInfo === null || typeof gpuInfo === 'object').toBe(true);
    });
  });
});

