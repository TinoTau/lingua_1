/**
 * 端口管理工具单元测试
 * 
 * 测试功能：
 * - 端口可用性检查
 * - 端口进程查找（Windows/Unix）
 * - 端口释放验证
 * - 端口清理
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as net from 'net';
import {
  checkPortAvailable,
  verifyPortReleased,
  findPortProcess,
  logPortOccupier,
  cleanupPortProcesses,
} from '../../main/src/utils/port-manager';

describe('Port Manager', () => {
  let testServer: net.Server | null = null;
  let testPort: number;

  beforeEach(() => {
    // 使用随机端口进行测试
    testPort = Math.floor(Math.random() * 10000) + 20000;
  });

  afterEach((done) => {
    if (testServer) {
      testServer.close(() => {
        testServer = null;
        // 等待端口释放
        setTimeout(done, 100);
      });
    } else {
      done();
    }
  });

  describe('checkPortAvailable', () => {
    it('应该检测到可用端口', async () => {
      const available = await checkPortAvailable(testPort);
      expect(available).toBe(true);
    });

    it('应该检测到被占用的端口', async () => {
      // 创建一个测试服务器占用端口
      testServer = net.createServer();
      await new Promise<void>((resolve) => {
        testServer!.listen(testPort, '127.0.0.1', () => {
          resolve();
        });
      });

      const available = await checkPortAvailable(testPort);
      expect(available).toBe(false);
    });

    it('应该支持自定义主机', async () => {
      const available = await checkPortAvailable(testPort, 'localhost');
      expect(available).toBe(true);
    });
  });

  describe('verifyPortReleased', () => {
    it('应该验证端口已释放', async () => {
      const released = await verifyPortReleased(testPort, 'test-service');
      expect(released).toBe(true);
    });

    it('应该检测到端口仍被占用', async () => {
      // 创建一个测试服务器占用端口
      testServer = net.createServer();
      await new Promise<void>((resolve) => {
        testServer!.listen(testPort, '127.0.0.1', () => {
          resolve();
        });
      });

      const released = await verifyPortReleased(testPort, 'test-service', 1000);
      expect(released).toBe(false);
    });

    it('应该支持自定义超时时间', async () => {
      const startTime = Date.now();
      await verifyPortReleased(testPort, 'test-service', 500);
      const elapsed = Date.now() - startTime;
      // 应该很快完成（端口可用）
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('findPortProcess', () => {
    it('应该返回进程 PID 数组', async () => {
      const pids = await findPortProcess(testPort);
      expect(Array.isArray(pids)).toBe(true);
      // 如果端口未被占用，应该返回空数组
      // 如果被占用，应该返回 PID 数组
    });

    it('应该处理不存在的端口', async () => {
      // 使用一个不太可能被占用的端口
      const unlikelyPort = 99999;
      const pids = await findPortProcess(unlikelyPort);
      expect(Array.isArray(pids)).toBe(true);
    });
  });

  describe('logPortOccupier', () => {
    it('应该记录端口占用信息（不抛出错误）', async () => {
      await expect(logPortOccupier(testPort, 'test-service')).resolves.not.toThrow();
    });

    it('应该处理不存在的端口', async () => {
      const unlikelyPort = 99999;
      await expect(logPortOccupier(unlikelyPort, 'test-service')).resolves.not.toThrow();
    });
  });

  describe('cleanupPortProcesses', () => {
    it('应该清理占用端口的进程（不抛出错误）', async () => {
      await expect(cleanupPortProcesses(testPort, 'test-service')).resolves.not.toThrow();
    });

    it('应该处理没有进程占用的情况', async () => {
      const unlikelyPort = 99999;
      await expect(cleanupPortProcesses(unlikelyPort, 'test-service')).resolves.not.toThrow();
    });
  });

  describe('集成测试', () => {
    it('应该完整流程：检查 -> 占用 -> 验证 -> 清理', async () => {
      // 1. 检查端口可用
      const initiallyAvailable = await checkPortAvailable(testPort);
      expect(initiallyAvailable).toBe(true);

      // 2. 占用端口
      testServer = net.createServer();
      await new Promise<void>((resolve) => {
        testServer!.listen(testPort, '127.0.0.1', () => {
          resolve();
        });
      });

      // 3. 验证端口被占用
      const availableAfter = await checkPortAvailable(testPort);
      expect(availableAfter).toBe(false);

      // 4. 关闭服务器
      testServer.close();
      testServer = null;
      await new Promise(resolve => setTimeout(resolve, 200));

      // 5. 验证端口已释放
      const released = await verifyPortReleased(testPort, 'test-service', 1000);
      expect(released).toBe(true);
    });
  });
});

