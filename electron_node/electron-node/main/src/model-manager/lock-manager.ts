// ===== 锁管理 =====

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LockFile } from './types';
import { fileExists } from './utils';

/**
 * 锁管理器
 */
export class LockManager {
  constructor(
    private lockDir: string,
    private taskLockTimeout: number = 30 * 60 * 1000 // 30 分钟
  ) {}

  /**
   * 获取任务锁路径
   */
  private getTaskLockPath(modelId: string, version: string): string {
    return path.join(this.lockDir, `${modelId}_${version}.lock`);
  }

  /**
   * 获取文件锁路径
   */
  getFileLockPath(tempDir: string, modelId: string, version: string, fileName: string): string {
    return path.join(tempDir, `${modelId}_${version}.${fileName}.part.lock`);
  }

  /**
   * 获取任务锁
   */
  async acquireTaskLock(modelId: string, version: string): Promise<boolean> {
    const lockPath = this.getTaskLockPath(modelId, version);
    
    // 检查锁是否存在且有效
    if (await fileExists(lockPath)) {
      try {
        const lockContent = JSON.parse(await fs.readFile(lockPath, 'utf-8')) as LockFile;
        
        // 检查是否超时
        if (Date.now() - lockContent.timestamp > lockContent.timeout) {
          // 锁已超时，删除
          await fs.unlink(lockPath);
        } else {
          // 检查进程是否还在运行
          if (await this.isProcessAlive(lockContent.pid)) {
            return false; // 锁有效，任务正在运行
          } else {
            // 进程不存在，删除孤儿锁
            await fs.unlink(lockPath);
          }
        }
      } catch {
        // 锁文件损坏，删除
        await fs.unlink(lockPath).catch(() => {});
      }
    }
    
    // 创建新锁
    const lock: LockFile = {
      pid: process.pid,
      timestamp: Date.now(),
      modelId,
      version,
      timeout: this.taskLockTimeout,
    };
    
    await fs.writeFile(lockPath, JSON.stringify(lock, null, 2));
    return true;
  }

  /**
   * 释放任务锁
   */
  async releaseTaskLock(modelId: string, version: string): Promise<void> {
    const lockPath = this.getTaskLockPath(modelId, version);
    await fs.unlink(lockPath).catch(() => {});
  }

  /**
   * 检查进程是否存活
   */
  private async isProcessAlive(pid: number): Promise<boolean> {
    try {
      // Windows 使用 tasklist，Linux/Mac 使用 kill -0
      if (os.platform() === 'win32') {
        const { exec } = require('child_process');
        return new Promise((resolve) => {
          exec(`tasklist /FI "PID eq ${pid}"`, (error: any, stdout: string) => {
            resolve(stdout.includes(String(pid)));
          });
        });
      } else {
        process.kill(pid, 0);
        return true;
      }
    } catch {
      return false;
    }
  }

  /**
   * 清理孤儿锁
   */
  async cleanupOrphanLocks(): Promise<void> {
    try {
      const locks = await fs.readdir(this.lockDir);
      const now = Date.now();
      
      for (const lockFile of locks) {
        const lockPath = path.join(this.lockDir, lockFile);
        try {
          const lockContent = JSON.parse(await fs.readFile(lockPath, 'utf-8')) as LockFile;
          
          // 检查是否超时（超过 1 小时）
          if (now - lockContent.timestamp > 60 * 60 * 1000) {
            await fs.unlink(lockPath);
            continue;
          }
          
          // 检查进程是否还在运行
          if (!(await this.isProcessAlive(lockContent.pid))) {
            await fs.unlink(lockPath);
          }
        } catch {
          // 锁文件损坏，删除
          await fs.unlink(lockPath).catch(() => {});
        }
      }
    } catch (error) {
      // 使用动态导入避免循环依赖
      const logger = (await import('../logger')).default;
      logger.error({ error }, 'Failed to cleanup orphan locks');
    }
  }
}

