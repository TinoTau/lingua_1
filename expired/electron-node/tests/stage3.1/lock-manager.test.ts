/**
 * LockManager 单元测试
 * 
 * 测试锁管理器的核心功能：
 * - 任务锁获取和释放
 * - 孤儿锁清理
 * - 锁超时处理
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LockManager } from '../../main/src/model-manager/lock-manager';

describe('LockManager', () => {
  let lockManager: LockManager;
  let testLockDir: string;

  beforeEach(async () => {
    // 创建临时测试目录
    testLockDir = path.join(os.tmpdir(), `lingua-lock-test-${Date.now()}`);
    await fs.mkdir(testLockDir, { recursive: true });
    
    lockManager = new LockManager(testLockDir, 30 * 60 * 1000); // 30 分钟超时
  });

  afterEach(async () => {
    // 清理测试目录
    try {
      await fs.rm(testLockDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  describe('任务锁', () => {
    it('应该能够获取和释放任务锁', async () => {
      const lockAcquired = await lockManager.acquireTaskLock('test-model', '1.0.0');
      expect(lockAcquired).toBe(true);
      
      // 尝试再次获取应该失败
      const lockAcquired2 = await lockManager.acquireTaskLock('test-model', '1.0.0');
      expect(lockAcquired2).toBe(false);
      
      // 释放锁
      await lockManager.releaseTaskLock('test-model', '1.0.0');
      
      // 现在应该可以再次获取
      const lockAcquired3 = await lockManager.acquireTaskLock('test-model', '1.0.0');
      expect(lockAcquired3).toBe(true);
    });

    it('应该清理超时的锁', async () => {
      const lockPath = path.join(testLockDir, 'test-model_1.0.0.lock');
      const oldLock = {
        pid: 99999, // 不存在的进程
        timestamp: Date.now() - 2 * 60 * 60 * 1000, // 2 小时前
        modelId: 'test-model',
        version: '1.0.0',
        timeout: 30 * 60 * 1000,
      };
      
      await fs.writeFile(lockPath, JSON.stringify(oldLock), 'utf-8');
      
      // 清理孤儿锁
      await lockManager.cleanupOrphanLocks();
      
      // 锁应该被清理
      await expect(fs.access(lockPath)).rejects.toThrow();
    });
  });
});

