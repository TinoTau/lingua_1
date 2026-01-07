/**
 * ESBuild 清理工具
 * 用于在程序退出时自动清理所有 ESBuild 进程
 */

import { exec } from 'child_process';
import * as os from 'os';
import logger from '../logger';

/**
 * 清理所有 ESBuild 进程
 */
export function cleanupEsbuild(): void {
  const platform = os.platform();
  
  try {
    if (platform === 'win32') {
      // Windows: 使用 taskkill 终止 esbuild 进程
      exec('taskkill /F /IM esbuild.exe 2>nul', { timeout: 5000 }, (error) => {
        if (error) {
          // code 128 表示进程不存在，这是正常的
          if (error.code !== 128 && !error.message.includes('not found')) {
            logger.warn({ error: error.message }, '清理 ESBuild 进程时出错');
          }
        } else {
          logger.debug({}, '已清理 ESBuild 进程');
        }
      });
    } else {
      // Linux/Mac: 使用 pkill 终止 esbuild 进程
      exec('pkill -f esbuild 2>/dev/null', { timeout: 5000 }, (error) => {
        if (error) {
          // code 1 表示没有找到进程，这是正常的
          if (error.code !== 1) {
            logger.warn({ error: error.message }, '清理 ESBuild 进程时出错');
          }
        } else {
          logger.debug({}, '已清理 ESBuild 进程');
        }
      });
    }
  } catch (err) {
    // 忽略清理错误，避免阻塞退出
    logger.warn({ error: err }, '清理 ESBuild 进程时发生异常');
  }
}
