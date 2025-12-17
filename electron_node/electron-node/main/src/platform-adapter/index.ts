/**
 * PlatformAdapter - 平台适配层
 * 
 * 所有平台差异逻辑只允许出现在 PlatformAdapter 内
 * 禁止散落到各个 manager
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import logger from '../logger';

export type Platform = 'windows-x64' | 'linux-x64' | 'darwin-x64' | 'darwin-arm64';

/**
 * 平台适配器接口
 */
export interface IPlatformAdapter {
  /**
   * 获取当前平台 ID
   */
  getPlatformId(): Platform;

  /**
   * 启动进程（使用 argv 方式，避免 shell 差异）
   */
  spawn(
    program: string,
    args: string[],
    options: SpawnOptions
  ): ChildProcess;

  /**
   * 使文件可执行（Linux/macOS）
   */
  makeExecutable(filePath: string): Promise<void>;

  /**
   * 获取文件锁（跨平台）
   */
  acquireLock(key: string): Promise<void>;

  /**
   * 路径拼接（可选，使用 path.join 或 path.posix.join）
   */
  pathJoin(...paths: string[]): string;
}

/**
 * Windows 平台适配器实现
 */
class WindowsPlatformAdapter implements IPlatformAdapter {
  getPlatformId(): Platform {
    return 'windows-x64';
  }

  spawn(
    program: string,
    args: string[],
    options: SpawnOptions
  ): ChildProcess {
    return spawn(program, args, {
      ...options,
      shell: false, // 使用 argv 方式，避免 shell 差异
      stdio: options.stdio || 'pipe',
    });
  }

  async makeExecutable(filePath: string): Promise<void> {
    // Windows 不需要 chmod，文件权限由文件系统管理
    logger.debug({ filePath }, 'Windows: makeExecutable is no-op');
  }

  async acquireLock(key: string): Promise<void> {
    // Windows 文件锁实现
    // TODO: 实现基于文件锁的机制
    // 可以使用 proper-lockfile 或自定义实现
    logger.debug({ key }, 'Windows: acquireLock placeholder');
  }

  pathJoin(...paths: string[]): string {
    return path.win32.join(...paths);
  }
}

/**
 * Linux 平台适配器实现（预留）
 */
class LinuxPlatformAdapter implements IPlatformAdapter {
  getPlatformId(): Platform {
    return 'linux-x64';
  }

  spawn(
    program: string,
    args: string[],
    options: SpawnOptions
  ): ChildProcess {
    return spawn(program, args, {
      ...options,
      shell: false,
      stdio: options.stdio || 'pipe',
    });
  }

  async makeExecutable(filePath: string): Promise<void> {
    // Linux 需要 chmod +x
    try {
      await fs.chmod(filePath, 0o755);
      logger.debug({ filePath }, 'Linux: made file executable');
    } catch (error) {
      logger.error({ error, filePath }, 'Failed to make file executable');
      throw error;
    }
  }

  async acquireLock(key: string): Promise<void> {
    // Linux 文件锁实现
    // TODO: 实现基于文件锁的机制
    logger.debug({ key }, 'Linux: acquireLock placeholder');
  }

  pathJoin(...paths: string[]): string {
    return path.posix.join(...paths);
  }
}

/**
 * 创建平台适配器实例（根据当前平台）
 */
export function createPlatformAdapter(): IPlatformAdapter {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === 'win32' && arch === 'x64') {
    return new WindowsPlatformAdapter();
  } else if (platform === 'linux' && arch === 'x64') {
    return new LinuxPlatformAdapter();
  } else if (platform === 'darwin') {
    if (arch === 'arm64') {
      // TODO: 实现 darwin-arm64 适配器
      throw new Error('darwin-arm64 platform adapter not yet implemented');
    } else if (arch === 'x64') {
      // TODO: 实现 darwin-x64 适配器
      throw new Error('darwin-x64 platform adapter not yet implemented');
    }
  }

  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

/**
 * 全局平台适配器实例
 */
let platformAdapterInstance: IPlatformAdapter | null = null;

/**
 * 获取全局平台适配器实例（单例）
 */
export function getPlatformAdapter(): IPlatformAdapter {
  if (!platformAdapterInstance) {
    platformAdapterInstance = createPlatformAdapter();
  }
  return platformAdapterInstance;
}

